/**
 * #614 — One-off migration: convert legacy name-form `lo_mastery` keys on
 * `CallerAttribute` to canonical slug-form.
 *
 * Pre-#611 the AGGREGATE-stage writer accepted whatever `moduleId` the AI
 * echoed back — typically the module's display title with spaces and
 * mixed case (e.g. `lo_mastery:Part 1: Familiar Topics:OUT-01`). #611
 * Fix A added the canonical resolver so new writes always use the slug
 * (`lo_mastery:part1:OUT-01`). This script drains the historical rows
 * that pre-date Fix A.
 *
 * Strategy (per row):
 *   1. Parse the key as `curriculum:<specSlug>:lo_mastery:<moduleToken>:<loRef>`.
 *      `moduleToken` may itself contain colons (display names like
 *      "Part 1: Familiar Topics"), so we split on the LAST colon —
 *      `loRef` is always one segment, `moduleToken` is everything in
 *      between.
 *   2. Look up `Curriculum` by `slug = specSlug` (Curriculum.slug is
 *      globally `@unique`, see schema.prisma:2287).
 *   3. Resolve `moduleToken` to its canonical slug via
 *      `resolveModuleSlug(curriculumId, moduleToken)` — the same helper
 *      #611 uses on the write path.
 *   4. Build the canonical key.
 *   5. If a canonical row already exists for this `(callerId, key, scope)`,
 *      merge: keep `MAX(numberValue)` and soft-delete the legacy row.
 *      Otherwise insert a new canonical row with the legacy `numberValue`
 *      and soft-delete the legacy row.
 *   6. "Soft-delete" = set `validUntil = NOW()` so the audit query
 *      (`validUntil IS NULL OR validUntil > NOW()`) stops counting it.
 *      Preserves the historical row for forensics.
 *
 * Idempotent — re-running drops to 0 candidates because every legacy row
 * gets `validUntil = NOW()` on the first apply pass.
 *
 * Run:
 *   npx tsx apps/admin/scripts/migrate-caller-attribute-lo-mastery-keys.ts
 *   npx tsx apps/admin/scripts/migrate-caller-attribute-lo-mastery-keys.ts --apply
 *
 * After --apply succeeds across all envs, the audit counter
 * `callerAttributeOldKeyFormCount` should read 0 and the reader
 * tolerance in `transforms/modules.ts:687` + `transforms/retrieval-practice.ts`
 * can be tightened (separate follow-on issue).
 *
 * See: gh issue view 614
 *      lib/curriculum/resolve-module.ts::resolveModuleSlug (mirror of write path)
 *      lib/prompt/composition/transforms/modules.ts:687 (reader grace window)
 */
import { PrismaClient } from "@prisma/client";
import { resolveModuleSlug } from "../lib/curriculum/resolve-module";

type LegacyRow = {
  id: string;
  callerId: string;
  key: string;
  scope: string;
  numberValue: number | null;
  validUntil: Date | null;
};

interface ParsedKey {
  prefix: string;       // "curriculum:<specSlug>:lo_mastery:"
  specSlug: string;
  moduleToken: string;  // may contain colons (display name)
  loRef: string;
}

function parseLoMasteryKey(key: string): ParsedKey | null {
  // Expected shape: curriculum:<specSlug>:lo_mastery:<moduleToken>:<loRef>
  // where moduleToken may itself contain colons.
  const marker = ":lo_mastery:";
  const markerIdx = key.indexOf(marker);
  if (markerIdx < 0) return null;

  const head = key.slice(0, markerIdx); // "curriculum:<specSlug>"
  const tail = key.slice(markerIdx + marker.length); // "<moduleToken>:<loRef>"

  // specSlug is everything between the LAST "curriculum:" and ":lo_mastery:".
  const curriculumMarker = "curriculum:";
  const curIdx = head.lastIndexOf(curriculumMarker);
  if (curIdx < 0) return null;
  const specSlug = head.slice(curIdx + curriculumMarker.length);
  if (!specSlug) return null;

  // loRef is the LAST colon-separated segment of the tail; moduleToken is
  // everything before that. LO refs ("OUT-01", "LO-1.2", etc.) don't
  // contain colons, so split-on-last-colon is robust against display-name
  // module tokens.
  const lastColon = tail.lastIndexOf(":");
  if (lastColon < 0) return null;
  const moduleToken = tail.slice(0, lastColon);
  const loRef = tail.slice(lastColon + 1);
  if (!moduleToken || !loRef) return null;

  return {
    prefix: key.slice(0, markerIdx + marker.length),
    specSlug,
    moduleToken,
    loRef,
  };
}

function isCanonical(moduleToken: string): boolean {
  // A canonical slug is lowercase, contains no spaces. Use the same shape
  // as the audit counter's regex (`[^:]*[A-Z ][^:]*`) but inverted.
  return !/[A-Z ]/.test(moduleToken);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  console.log(`#614 lo_mastery key migration — mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  // Stage 1 — fetch all candidates. Mirror of the audit counter's filter.
  const candidates = await prisma.$queryRaw<LegacyRow[]>`
    SELECT id, "callerId", key, scope, "numberValue", "validUntil"
    FROM "CallerAttribute"
    WHERE "key" LIKE '%:lo_mastery:%'
      AND "key" ~ ':lo_mastery:[^:]*[A-Z ][^:]*:'
      AND ("validUntil" IS NULL OR "validUntil" > NOW())
  `;

  console.log(`Found ${candidates.length} legacy lo_mastery row(s) needing migration`);

  if (candidates.length === 0) {
    console.log("Nothing to migrate. Counter should already read 0.");
    await prisma.$disconnect();
    return;
  }

  // Cache curricula by specSlug to avoid repeating findUnique.
  const curriculumCache = new Map<string, string | null>();
  async function getCurriculumId(specSlug: string): Promise<string | null> {
    if (curriculumCache.has(specSlug)) return curriculumCache.get(specSlug)!;
    const row = await prisma.curriculum.findUnique({
      where: { slug: specSlug },
      select: { id: true },
    });
    const id = row?.id ?? null;
    curriculumCache.set(specSlug, id);
    return id;
  }

  let parseFailed = 0;
  let alreadyCanonical = 0;
  let curriculumMissing = 0;
  let moduleUnresolved = 0;
  let mergedToCanonical = 0;
  let insertedCanonical = 0;
  let softDeleted = 0;

  for (const row of candidates) {
    const parsed = parseLoMasteryKey(row.key);
    if (!parsed) {
      parseFailed++;
      console.log(`  [parse-fail] ${row.key.slice(0, 80)}`);
      continue;
    }

    if (isCanonical(parsed.moduleToken)) {
      // The audit regex matched something (e.g. uppercase in the LO ref),
      // but the moduleToken itself is already canonical. No work needed.
      alreadyCanonical++;
      continue;
    }

    const curriculumId = await getCurriculumId(parsed.specSlug);
    if (!curriculumId) {
      curriculumMissing++;
      console.log(`  [no-curriculum] specSlug="${parsed.specSlug}" → orphan key, skip: ${row.key.slice(0, 80)}`);
      continue;
    }

    const canonicalSlug = await resolveModuleSlug(curriculumId, parsed.moduleToken);
    if (!canonicalSlug) {
      moduleUnresolved++;
      console.log(`  [unresolved] curriculum ${curriculumId} has no module "${parsed.moduleToken}", skip: ${row.key.slice(0, 80)}`);
      continue;
    }

    const canonicalKey = `${parsed.prefix}${canonicalSlug}:${parsed.loRef}`;

    if (canonicalKey === row.key) {
      // Already canonical (shouldn't happen given isCanonical above, but
      // defensive against edge cases like trailing whitespace).
      alreadyCanonical++;
      continue;
    }

    if (apply) {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.callerAttribute.findUnique({
          where: {
            callerId_key_scope: {
              callerId: row.callerId,
              key: canonicalKey,
              scope: row.scope,
            },
          },
        });

        if (existing) {
          // Conflict — merge: keep the higher mastery value.
          const winnerValue = Math.max(
            existing.numberValue ?? -Infinity,
            row.numberValue ?? -Infinity,
          );
          if (Number.isFinite(winnerValue) && winnerValue !== (existing.numberValue ?? -Infinity)) {
            await tx.callerAttribute.update({
              where: { id: existing.id },
              data: { numberValue: winnerValue },
            });
          }
          mergedToCanonical++;
        } else {
          await tx.callerAttribute.create({
            data: {
              callerId: row.callerId,
              key: canonicalKey,
              scope: row.scope,
              valueType: "NUMBER",
              numberValue: row.numberValue,
            },
          });
          insertedCanonical++;
        }

        // Soft-delete the legacy row so the audit counter drops.
        await tx.callerAttribute.update({
          where: { id: row.id },
          data: { validUntil: new Date() },
        });
        softDeleted++;
      });
    } else {
      // Dry-run accounting — predict insert vs merge.
      const existing = await prisma.callerAttribute.findUnique({
        where: {
          callerId_key_scope: {
            callerId: row.callerId,
            key: canonicalKey,
            scope: row.scope,
          },
        },
        select: { id: true, numberValue: true },
      });
      if (existing) {
        mergedToCanonical++;
        console.log(`  [merge] caller=${row.callerId.slice(0, 8)} "${parsed.moduleToken}" → "${canonicalSlug}" (existing canonical=${existing.numberValue}, legacy=${row.numberValue})`);
      } else {
        insertedCanonical++;
        console.log(`  [insert] caller=${row.callerId.slice(0, 8)} "${parsed.moduleToken}" → "${canonicalSlug}" (value=${row.numberValue})`);
      }
      softDeleted++;
    }
  }

  console.log(`\n──── summary ────`);
  console.log(`mode:                ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`candidates scanned:  ${candidates.length}`);
  console.log(`parse failures:      ${parseFailed}`);
  console.log(`already canonical:   ${alreadyCanonical}`);
  console.log(`curriculum missing:  ${curriculumMissing}  (orphan keys; spec deleted or renamed)`);
  console.log(`module unresolved:   ${moduleUnresolved}  (legacy moduleToken doesn't match any current module)`);
  console.log(`merged into canon:   ${mergedToCanonical}  (canonical row already existed; max-value kept)`);
  console.log(`inserted canonical:  ${insertedCanonical}`);
  console.log(`soft-deleted legacy: ${softDeleted}  (validUntil = NOW())`);
  if (!apply) {
    console.log(`(re-run with --apply to perform the writes)`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

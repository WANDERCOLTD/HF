/**
 * demo-928-bleed-prevention.ts
 *
 * Live-DB demonstration that #928's cross-course scoping fix works against
 * real data. Catalog entry: docs/TEST-BANK.md "D001".
 *
 * How it works:
 *   1. Picks the caller in the current DB with the most `lo_mastery` rows
 *      under a single curriculum spec slug (their "currentSpec").
 *   2. Records the helper's output for that caller × currentSpec — the
 *      BEFORE map.
 *   3. Injects three synthetic `curriculum:<foreignSpec>:lo_mastery:DEMO-...`
 *      rows under the same callerId. These are the "bleed" rows — they
 *      belong to a different course's spec slug.
 *   4. Re-runs the helper. The AFTER map must equal the BEFORE map: foreign
 *      rows live in the raw query result but the helper scopes them out.
 *   5. Cleans up the synthetic rows (marked with sourceSpecSlug
 *      'demo-928-bleed-marker' so cleanup is unambiguous).
 *
 * Failure mode it would catch:
 *   If buildLoMasteryMap regressed back to a `.includes(':lo_mastery:')`
 *   substring match, the AFTER map would contain `demo-module:DEMO-OUT-*`
 *   entries with scores 0.95 / 0.88 / 0.72 — and the verdict line would
 *   read "FAIL — fix broken".
 *
 * Run:
 *   On the VM: `cd ~/HF/apps/admin && npx tsx scripts/demo-928-bleed-prevention.ts`
 *
 * Safe to re-run. The synthetic rows are inserted with a unique marker and
 * deleted at the end of every run.
 *
 * Related:
 *   - lib/prompt/composition/lo-mastery-map.ts — the helper under test
 *   - tests/lib/prompt/composition/lo-mastery-map.test.ts — 13-property
 *     unit suite (test bank entry 001)
 *   - #928 — original cross-course bleed fix
 *   - #936 / #939 — helper extraction + transform refactor
 *   - docs/epic-100-chain-walk.md Link 6
 */

import { prisma } from "../lib/prisma";
import { buildLoMasteryMap } from "../lib/prompt/composition/lo-mastery-map";

const SYNTHETIC_MARKER = "demo-928-bleed-marker";

async function main() {
  // 1. Pick a caller with lo_mastery rows in some spec.
  const picks = await prisma.$queryRaw<
    Array<{ callerId: string; spec: string; row_count: bigint; caller_name: string | null }>
  >`
    SELECT ca."callerId",
           SPLIT_PART(ca."key", ':', 2) AS spec,
           COUNT(*)::bigint AS row_count,
           c."name" AS caller_name
    FROM "CallerAttribute" ca
    LEFT JOIN "Caller" c ON c.id = ca."callerId"
    WHERE ca."key" LIKE 'curriculum:%:lo_mastery:%'
      AND ca."scope" = 'CURRICULUM'
      AND (ca."validUntil" IS NULL OR ca."validUntil" > NOW())
    GROUP BY ca."callerId", spec, c."name"
    ORDER BY row_count DESC
    LIMIT 1
  `;

  if (picks.length === 0) {
    console.log("No callers with lo_mastery rows found — nothing to demo against.");
    process.exit(0);
  }

  const target = picks[0];
  const currentSpec = target.spec;
  const callerId = target.callerId;

  // Pick any foreign spec slug that exists in the DB (or fall back to a
  // synthetic-only one if there's only one spec live).
  const otherSpecRow = await prisma.$queryRaw<Array<{ spec: string }>>`
    SELECT DISTINCT SPLIT_PART("key", ':', 2) AS spec
    FROM "CallerAttribute"
    WHERE "key" LIKE 'curriculum:%:lo_mastery:%'
      AND "scope" = 'CURRICULUM'
      AND ("validUntil" IS NULL OR "validUntil" > NOW())
      AND SPLIT_PART("key", ':', 2) <> ${currentSpec}
    LIMIT 1
  `;
  const FOREIGN_SPEC = otherSpecRow[0]?.spec ?? "demo-foreign-spec-no-other-live";

  console.log("\n┌─────────────────────────────────────────────────────────────");
  console.log("│  DEMO TARGET");
  console.log("├─────────────────────────────────────────────────────────────");
  console.log(`│  callerId      ${callerId}`);
  console.log(`│  name          ${target.caller_name ?? "(unnamed)"}`);
  console.log(`│  currentSpec   ${currentSpec}  (${Number(target.row_count)} mastery rows)`);
  console.log(`│  foreignSpec   ${FOREIGN_SPEC}  (about to inject synthetic rows here)`);
  console.log(`│  admin URL     /x/callers/${callerId}`);
  console.log("└─────────────────────────────────────────────────────────────\n");

  // 2. BEFORE
  const attrsBefore = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      key: { contains: ":lo_mastery:" },
      scope: "CURRICULUM",
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    },
    select: { key: true, scope: true, numberValue: true },
  });
  const mapBefore = buildLoMasteryMap(attrsBefore, currentSpec);
  console.log("=== BEFORE: helper output for callerId × currentSpec ===");
  console.log(`  attrs in DB:        ${attrsBefore.length} rows`);
  console.log(`  loMasteryMap keys:  ${Object.keys(mapBefore).length}`);
  console.log(`  sample entries:     ${JSON.stringify(Object.entries(mapBefore).slice(0, 3))}`);

  // 3. INJECT
  const synthetic = [
    { ref: "DEMO-OUT-01", score: 0.95 },
    { ref: "DEMO-OUT-02", score: 0.88 },
    { ref: "DEMO-OUT-03", score: 0.72 },
  ];
  for (const s of synthetic) {
    await prisma.callerAttribute.upsert({
      where: {
        callerId_key_scope: {
          callerId,
          key: `curriculum:${FOREIGN_SPEC}:lo_mastery:demo-module:${s.ref}`,
          scope: "CURRICULUM",
        },
      },
      create: {
        callerId,
        key: `curriculum:${FOREIGN_SPEC}:lo_mastery:demo-module:${s.ref}`,
        scope: "CURRICULUM",
        valueType: "NUMBER",
        numberValue: s.score,
        sourceSpecSlug: SYNTHETIC_MARKER,
      },
      update: {
        numberValue: s.score,
        sourceSpecSlug: SYNTHETIC_MARKER,
        validUntil: null,
      },
    });
  }
  console.log(`\n=== INJECTED 3 synthetic foreign-spec rows under callerId ${callerId} ===`);

  // 4. AFTER
  const attrsAfter = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      key: { contains: ":lo_mastery:" },
      scope: "CURRICULUM",
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    },
    select: { key: true, scope: true, numberValue: true },
  });
  const foreignInRaw = attrsAfter.filter((a) => a.key.startsWith(`curriculum:${FOREIGN_SPEC}:`));
  const mapAfter = buildLoMasteryMap(attrsAfter, currentSpec);

  console.log("\n=== AFTER: same call, foreign rows now in DB ===");
  console.log(`  attrs in DB (raw):        ${attrsAfter.length} rows  ← went up by 3`);
  console.log(`  foreign-spec rows in raw:  ${foreignInRaw.length}  ← injected rows visible to loader`);
  console.log(`  loMasteryMap keys:         ${Object.keys(mapAfter).length}  ← MUST MATCH BEFORE`);
  console.log(`  sample entries:            ${JSON.stringify(Object.entries(mapAfter).slice(0, 3))}`);

  const beforeKeys = new Set(Object.keys(mapBefore));
  const afterKeys = new Set(Object.keys(mapAfter));
  const onlyInAfter = [...afterKeys].filter((k) => !beforeKeys.has(k));
  const containsDemoMarker = [...afterKeys].some((k) => k.includes("DEMO-"));
  const pass = !containsDemoMarker && onlyInAfter.length === 0;

  console.log("\n┌─ VERDICT ──────────────────────────────────────────────────");
  console.log(`│  loMasteryMap key delta (after - before):  ${JSON.stringify(onlyInAfter)}`);
  console.log(
    `│  helper output contains DEMO- markers:     ${
      containsDemoMarker ? "✗ FAIL — fix broken" : "✓ PASS — foreign rows scoped out"
    }`,
  );
  console.log("└─────────────────────────────────────────────────────────────\n");

  // 5. CLEANUP
  const deleted = await prisma.callerAttribute.deleteMany({
    where: { callerId, sourceSpecSlug: SYNTHETIC_MARKER },
  });
  console.log(`=== CLEANUP: removed ${deleted.count} synthetic rows ===\n`);

  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * sort-stale-ielts-skills.ts — idempotent stale-data drain for IELTS skill IDs.
 *
 * Purpose
 * -------
 * After the #2138 / #2304 / #2305 rename chain, IELTS skill parameter IDs
 * carry per-criterion suffixes (`_fc` / `_lr` / `_gra` / `_p`). On any
 * env where data accumulated BEFORE the rename, two stale-data classes
 * remain:
 *
 *   1. CallerTarget rows with the un-suffixed legacy parameter IDs
 *      (e.g. `skill_fluency_and_coherence`). Per #2138 the canonical
 *      form is suffixed; consumers (D5 IELTS-P3-FOCUS-001, SKILL-AGG-001
 *      re-aggregation) only read suffixed → un-suffixed rows are silently
 *      dormant. Sibling script
 *      `drain-stale-ielts-skill-callertargets.ts` (PR #2305) drains the
 *      ZERO-CallScore subset; this script drains the broader UN-SUFFIXED
 *      class.
 *
 *   2. BehaviorTarget rows duplicated on `(playbookId, parameterId)` —
 *      typically two SEED runs landing different targetValues for the
 *      same canonical param (e.g. 0.5 from pre-rename seed + 0.65 from
 *      post-rename seed). PR #2304's migration dropped the un-suffixed
 *      stale class; this script removes the canonical-suffixed dupes
 *      that arrived from re-seeding, keeping the most recent per pair.
 *
 * What this preserves (intentionally untouched)
 * ---------------------------------------------
 *   - Historical `CallScore` rows with un-suffixed IELTS IDs — forensic
 *     record of past pipeline runs; downstream consumers don't read
 *     them, but the audit trail is valuable.
 *   - Canonical `Parameter` rows for the un-suffixed legacy IDs —
 *     orphaned but harmless; deleting risks orphaning historical
 *     CallScore.parameterId FKs (relaxed FK, but still).
 *   - CALLER-scope BehaviorTarget rows with `playbookId=NULL` — pre-
 *     rename manual overrides, target=0, scope=CALLER; harmless.
 *
 * Usage
 * -----
 *   npx tsx scripts/sort-stale-ielts-skills.ts            # dry-run (default)
 *   npx tsx scripts/sort-stale-ielts-skills.ts --apply    # commit changes
 *
 * Idempotent: re-runs are safe; a clean DB produces a "0 / 0" report.
 *
 * Related
 * -------
 *   - #2138 rename
 *   - #2304 wizard alias map + BehaviorTarget migration
 *   - #2305 zero-CallScore CallerTarget drain
 *   - #2306 D5 pedagogy (reads suffixed canonical inputSkills)
 *   - .claude/rules/db-registry-parity.md
 */

import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local", override: true });
loadDotenv({ path: ".env" });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const UN_SUFFIXED_IELTS_PARAMS = [
  "skill_fluency_and_coherence",
  "skill_lexical_resource",
  "skill_grammatical_range_and_accuracy",
  "skill_pronunciation",
] as const;

interface SortResult {
  callerTargetsDeleted: number;
  behaviorTargetDuplicatesDeleted: number;
}

async function sortStaleIeltsSkills(apply: boolean): Promise<SortResult> {
  console.log(
    apply
      ? "=== APPLY mode — committing changes ==="
      : "=== DRY-RUN — no changes (use --apply to commit) ===",
  );

  // 1. Stale un-suffixed CallerTarget rows
  const staleCt = await prisma.callerTarget.findMany({
    where: { parameterId: { in: [...UN_SUFFIXED_IELTS_PARAMS] } },
    select: { id: true, callerId: true, parameterId: true },
  });
  console.log(`\n[1] Stale CallerTarget rows (un-suffixed IELTS): ${staleCt.length}`);
  for (const r of staleCt.slice(0, 5)) {
    console.log(`    caller=${r.callerId.slice(0, 8)} param=${r.parameterId}`);
  }
  if (staleCt.length > 5) console.log(`    ... and ${staleCt.length - 5} more`);
  let callerTargetsDeleted = 0;
  if (apply && staleCt.length > 0) {
    const del = await prisma.callerTarget.deleteMany({
      where: { id: { in: staleCt.map((r) => r.id) } },
    });
    callerTargetsDeleted = del.count;
    console.log(`    ✓ Deleted ${del.count} stale CallerTarget rows`);
  }

  // 2. BehaviorTarget duplicates on (playbookId, parameterId) — keep most recent
  const dupes = await prisma.$queryRaw<
    Array<{ playbookId: string; parameterId: string; n: bigint }>
  >`
    SELECT "playbookId", "parameterId", COUNT(*) as n
    FROM "BehaviorTarget"
    WHERE "playbookId" IS NOT NULL
    GROUP BY "playbookId", "parameterId"
    HAVING COUNT(*) > 1
  `;
  const idsToDelete: string[] = [];
  for (const d of dupes) {
    const rows = await prisma.behaviorTarget.findMany({
      where: { playbookId: d.playbookId, parameterId: d.parameterId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    idsToDelete.push(...rows.slice(1).map((r) => r.id));
  }
  console.log(
    `\n[2] BehaviorTarget duplicate rows (keep most recent per (playbookId, parameterId)): ${idsToDelete.length}`,
  );
  let behaviorTargetDuplicatesDeleted = 0;
  if (apply && idsToDelete.length > 0) {
    const del = await prisma.behaviorTarget.deleteMany({
      where: { id: { in: idsToDelete } },
    });
    behaviorTargetDuplicatesDeleted = del.count;
    console.log(`    ✓ Deleted ${del.count} duplicate BehaviorTarget rows`);
  }

  // 3. Post-apply verification
  if (apply) {
    const remainingCt = await prisma.callerTarget.count({
      where: { parameterId: { in: [...UN_SUFFIXED_IELTS_PARAMS] } },
    });
    const remainingDupes = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) as n FROM (
        SELECT "playbookId", "parameterId" FROM "BehaviorTarget"
        WHERE "playbookId" IS NOT NULL
        GROUP BY "playbookId", "parameterId" HAVING COUNT(*) > 1
      ) sub
    `;
    console.log(`\n=== POST-APPLY STATE ===`);
    console.log(`  Stale un-suffixed CallerTarget rows: ${remainingCt}`);
    console.log(
      `  Duplicate BehaviorTarget (playbookId, parameterId) pairs: ${remainingDupes[0]?.n ?? 0}`,
    );
  } else {
    console.log(
      `\n→ Re-run with --apply to commit. Preserved (untouched): historical CallScore + canonical Parameter legacy rows + CALLER-scope orphaned BehaviorTargets.`,
    );
  }

  return { callerTargetsDeleted, behaviorTargetDuplicatesDeleted };
}

async function main() {
  const apply = process.argv.includes("--apply");
  try {
    await sortStaleIeltsSkills(apply);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * G10 / #1160 — backfill ARCHIVE tutor-briefing Goal rows
 *
 * Walks every `Goal` row of `type=LEARN`, `progressStrategy=manual_only`,
 * `ref IS NULL`, `sourceContentId IS NULL` (the shape the audit identified
 * as the tutor-briefing leak). Runs the same validator
 * (`validateLearningOutcomeEntry`) against `Goal.name`. Rows that the
 * validator rejects get `status = 'ARCHIVED'`.
 *
 * Idempotent: re-running is a no-op once the row is ARCHIVED.
 *
 * `trackGoalProgress` (PIPELINE.md §7 sub-op 4) and `extractGoals` (sub-op 3)
 * both filter on `status: { in: [ACTIVE, PAUSED] }` per TL #1160 review —
 * archived rows are automatically excluded from pipeline reads.
 *
 * Usage:
 *   npx tsx apps/admin/scripts/backfill-archive-tutor-briefing-goals.ts
 *   npx tsx apps/admin/scripts/backfill-archive-tutor-briefing-goals.ts --dry-run
 *
 * @see docs/audit/pipeline-measure-adapt-2026-06.md §6 G10
 * @see lib/domain/validate-learning-outcome.ts (shared validator)
 */

import { PrismaClient } from "@prisma/client";
import { validateLearningOutcomeEntry } from "../lib/domain/validate-learning-outcome";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();

  console.log(`=== G10 backfill ${dryRun ? "(DRY RUN)" : "(APPLY)"} ===\n`);

  // Scope: LEARN goals shaped like the tutor-briefing leak.
  const candidates = await prisma.goal.findMany({
    where: {
      type: "LEARN",
      progressStrategy: "manual_only",
      ref: null,
      sourceContentId: null,
      status: { in: ["ACTIVE", "PAUSED"] }, // skip already-archived
    },
    select: {
      id: true,
      name: true,
      playbookId: true,
      callerId: true,
    },
  });

  console.log(`Candidates (manual_only + ref=null + sourceContentId=null + status∈{ACTIVE,PAUSED}): ${candidates.length}\n`);

  const rejected: Array<{ id: string; name: string; reason: string; playbookId: string | null }> = [];
  for (const g of candidates) {
    const result = validateLearningOutcomeEntry(g.name);
    if (!result.ok) {
      rejected.push({ id: g.id, name: g.name, reason: result.reason, playbookId: g.playbookId });
    }
  }
  console.log(`Validator-rejected (would archive): ${rejected.length}\n`);

  // Group by playbook for a readable summary.
  const byPlaybook = new Map<string, number>();
  for (const r of rejected) {
    const key = r.playbookId ?? "(no-playbook)";
    byPlaybook.set(key, (byPlaybook.get(key) ?? 0) + 1);
  }
  console.log("Per-playbook breakdown:");
  for (const [pb, count] of [...byPlaybook.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pb.slice(0, 8)}  ${count} row(s)`);
  }

  console.log("\nFirst 10 rejections (id / reason / name[:80]):");
  for (const r of rejected.slice(0, 10)) {
    console.log(`  ${r.id.slice(0, 8)}  ${r.reason}  ${r.name.slice(0, 80)}`);
  }

  if (dryRun) {
    console.log(`\nDRY RUN — no writes. Pass without --dry-run to ARCHIVE ${rejected.length} row(s).`);
    await prisma.$disconnect();
    return;
  }

  // Apply
  let archived = 0;
  for (const r of rejected) {
    await prisma.goal.update({ where: { id: r.id }, data: { status: "ARCHIVED" } });
    archived++;
  }
  console.log(`\n✓ Archived ${archived} tutor-briefing Goal rows.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Backfill — #950 repair stuck CallerModuleProgress rows.
 *
 * Repairs the dirty state where `status = NOT_STARTED` but `mastery > 0`.
 * This state was produced by the race between:
 *   - the legacy `updateModuleMastery` writer (writes status from a stale
 *     all-zero LO snapshot → NOT_STARTED), and
 *   - the canonical `writeModuleMastery` writer (writes the non-zero EMA
 *     mastery but, pre-#950, never touched status).
 *
 * Rule applied:
 *   - mastery >= 1.0   → leave alone (data error; let next pipeline re-aggregate fix it)
 *   - mastery in (0,1) → promote NOT_STARTED → IN_PROGRESS, set startedAt = updatedAt (best-effort)
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-950-stuck-module-status.ts          # report + apply
 *   npx tsx scripts/backfill-950-stuck-module-status.ts --dry    # report only
 */

import { prisma } from "../lib/prisma";

async function main() {
  const dry = process.argv.includes("--dry");
  console.log(`[backfill-950] mode=${dry ? "DRY-RUN" : "APPLY"}`);

  const stuck = await prisma.callerModuleProgress.findMany({
    where: {
      status: "NOT_STARTED",
      mastery: { gt: 0, lt: 1 },
    },
    select: {
      id: true,
      callerId: true,
      moduleId: true,
      mastery: true,
      callCount: true,
      startedAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(`[backfill-950] found ${stuck.length} stuck row(s)`);
  for (const row of stuck) {
    console.log(
      `  caller=${row.callerId.slice(0, 8)} module=${row.moduleId.slice(0, 8)} mastery=${row.mastery.toFixed(2)} callCount=${row.callCount} startedAt=${row.startedAt?.toISOString() ?? "null"}`,
    );
  }

  if (dry || stuck.length === 0) {
    await prisma.$disconnect();
    return;
  }

  let repaired = 0;
  for (const row of stuck) {
    await prisma.callerModuleProgress.update({
      where: { id: row.id },
      data: {
        status: "IN_PROGRESS",
        // Preserve original startedAt if somehow set; otherwise stamp updatedAt
        // so the timeline shows when the row was first touched, not now.
        startedAt: row.startedAt ?? row.updatedAt,
      },
    });
    repaired += 1;
  }
  console.log(`[backfill-950] repaired ${repaired} row(s)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("[backfill-950] error:", e);
  process.exit(1);
});

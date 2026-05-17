/**
 * #414 verification — resets Opal's LEARN/ACHIEVE goal.progress to 0, then
 * runs `trackGoalProgress` against her latest call so the new per-ref
 * derivation populates progress from `CallerModuleProgress.loScoresJson`.
 *
 * The old engagement heuristic had left every LEARN goal at 0.8714 and
 * every ACHIEVE goal at noise values from keyword matching. The new path
 * will produce DISTINCT per-goal progress derived from her actual LO
 * mastery — for OUT-01 it should be 0.55 (her accumulated value), for
 * other OUT-NN refs without mastery it stays at 0.
 *
 * Read-only-ish — only touches the 3 callers in the #407 incident.
 */
import { prisma } from "@/lib/prisma";
import { trackGoalProgress } from "@/lib/goals/track-progress";

const OPAL = "b9ad0217-9202-4f32-b358-6a79783170ef";

async function main() {
  // 1. Show current state
  const before = await prisma.goal.findMany({
    where: { callerId: OPAL, status: "ACTIVE" },
    select: { id: true, name: true, ref: true, type: true, progress: true },
    orderBy: [{ type: "asc" }, { ref: "asc" }],
  });
  console.log("\n=== BEFORE — current goal.progress (noise) ===");
  for (const g of before) {
    console.log(`  ${g.type.padEnd(7)} ${(g.ref ?? "<null>").padEnd(8)} ${g.progress.toFixed(4)}  ${g.name.slice(0, 80)}`);
  }

  // 2. Reset to 0 so the "only-update-if-higher" gate doesn't block the
  //    new lower-but-accurate values.
  const resetCount = await prisma.goal.updateMany({
    where: { callerId: OPAL, status: "ACTIVE", type: { in: ["LEARN", "ACHIEVE"] } },
    data: { progress: 0 },
  });
  console.log(`\nReset ${resetCount.count} goals to progress=0`);

  // 3. Find Opal's most recent call to drive trackGoalProgress
  const lastCall = await prisma.call.findFirst({
    where: { callerId: OPAL },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!lastCall) {
    console.error("No call found for Opal — aborting");
    process.exit(1);
  }

  // 4. Run the new derivation
  const result = await trackGoalProgress(OPAL, lastCall.id);
  console.log(`\ntrackGoalProgress: updated=${result.updated}, completed=${result.completed}`);

  // 5. Show new state
  const after = await prisma.goal.findMany({
    where: { callerId: OPAL, status: "ACTIVE" },
    select: { id: true, name: true, ref: true, type: true, progress: true },
    orderBy: [{ type: "asc" }, { ref: "asc" }],
  });
  console.log("\n=== AFTER — per-ref derivation ===");
  for (const g of after) {
    console.log(`  ${g.type.padEnd(7)} ${(g.ref ?? "<null>").padEnd(8)} ${g.progress.toFixed(4)}  ${g.name.slice(0, 80)}`);
  }

  // 6. Summary — how many distinct progress values among LEARN goals?
  const learnProgresses = after.filter((g) => g.type === "LEARN").map((g) => g.progress);
  const distinct = new Set(learnProgresses).size;
  console.log(`\nLEARN goal progress: ${learnProgresses.length} goals, ${distinct} distinct values`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

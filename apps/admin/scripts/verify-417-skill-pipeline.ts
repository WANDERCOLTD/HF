/**
 * #417 verification — full chain on Opal.
 *
 * 1. Synthesise 4 CallScore rows (one per skill_* parameter) on Opal's
 *    latest call with distinct scores (0.40 / 0.65 / 0.55 / 0.30).
 * 2. Run AGGREGATE → SKILL-AGG-001 picks them up and writes
 *    CallerTarget.currentScore via EMA.
 * 3. Run trackGoalProgress → 4 ACHIEVE goals each derive distinct
 *    per-skill progress with banding evidence strings.
 * 4. Print before / after.
 *
 * Re-runnable: the idempotency guard in accumulateSkillScores skips
 * CallScores already reflected in lastScoredAt.
 */
import { prisma } from "@/lib/prisma";
import { trackGoalProgress } from "@/lib/goals/track-progress";
import { runAggregateSpecs } from "@/lib/pipeline/aggregate-runner";

const OPAL = "b9ad0217-9202-4f32-b358-6a79783170ef";

const SYNTHETIC_SCORES: Record<string, number> = {
  skill_fluency_and_coherence_fc: 0.4,
  skill_lexical_resource_lr: 0.65,
  skill_grammatical_range_and_accuracy_gra: 0.55,
  skill_pronunciation_p: 0.3,
};

async function main() {
  // Pre-state
  console.log("=== BEFORE ===");
  const achieveGoals = await prisma.goal.findMany({
    where: { callerId: OPAL, type: "ACHIEVE", status: "ACTIVE" },
    select: { id: true, name: true, ref: true, progress: true },
    orderBy: { ref: "asc" },
  });
  for (const g of achieveGoals) {
    console.log(
      `  ${(g.ref ?? "<null>").padEnd(8)} progress=${g.progress.toFixed(4)}  ${g.name.slice(0, 60)}`,
    );
  }
  // Reset ACHIEVE progress so the new derivation has room to write.
  await prisma.goal.updateMany({
    where: { callerId: OPAL, type: "ACHIEVE", status: "ACTIVE" },
    data: { progress: 0 },
  });

  // Find all of Opal's calls — CallScore is UNIQUE(callId, parameterId)
  // so we need multiple callIds to synthesise multi-call evidence.
  const allCalls = await prisma.call.findMany({
    where: { callerId: OPAL },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (allCalls.length === 0) throw new Error("Opal has no calls");
  const lastCall = allCalls[allCalls.length - 1];

  // Synthesise CallScore rows for the 4 skill_* params. Cap factor
  // `SKILL_MIN_CALLS_TO_FULL = 4` means a single-call score is capped at
  // 0.25 regardless of value. Synthesise 5 calls' worth of evidence per
  // parameter (each ~10 minutes apart) so the cap releases and the EMA
  // surface produces meaningful distinct values.
  const existingScoreCount = await prisma.callScore.count({
    where: { callerId: OPAL, parameterId: { startsWith: "skill_" } },
  });
  if (existingScoreCount === 0) {
    console.log(
      `\nSynthesising ${allCalls.length} call(s) × 4 skill_* CallScores for Opal...`,
    );
    // Space synthetic createdAt timestamps 30 days apart so the EMA's
    // time-decay α is meaningfully > 0 (half-life is 14d). Without
    // spacing, all observations land at the same instant, α≈0, and the
    // first observation dominates forever — pinning every skill at the
    // first-call cap of 0.25.
    const baseTime = Date.now() - allCalls.length * 30 * 24 * 60 * 60 * 1000;
    for (let callIdx = 0; callIdx < allCalls.length; callIdx++) {
      const callId = allCalls[callIdx].id;
      const ts = new Date(baseTime + callIdx * 30 * 24 * 60 * 60 * 1000);
      for (const [parameterId, score] of Object.entries(SYNTHETIC_SCORES)) {
        await prisma.callScore.create({
          data: {
            callId,
            callerId: OPAL,
            parameterId,
            score,
            confidence: 0.8,
            evidence: [`Synthesised call ${callIdx + 1}/${allCalls.length} for #417 verification`],
            reasoning: "verify-417-skill-pipeline.ts",
            scoredBy: "VERIFY_SCRIPT",
            createdAt: ts,
          },
        });
      }
    }
  } else {
    console.log(`\n(${existingScoreCount} skill_* CallScores already exist — reusing)`);
  }

  // Run AGGREGATE — SKILL-AGG-001 picks up the new scores.
  console.log("\nrunAggregateSpecs(callerId)...");
  const aggResult = await runAggregateSpecs(OPAL);
  console.log(
    `  specsRun=${aggResult.specsRun} profileUpdates=${aggResult.profileUpdates} errors=${aggResult.errors.length}`,
  );
  if (aggResult.errors.length > 0) console.log("  errors:", aggResult.errors);

  // Inspect CallerTarget state
  const callerTargets = await prisma.callerTarget.findMany({
    where: { callerId: OPAL, parameterId: { startsWith: "skill_" } },
    select: { parameterId: true, currentScore: true, callsUsed: true, lastScoredAt: true },
    orderBy: { parameterId: "asc" },
  });
  console.log("\nCallerTarget state:");
  for (const ct of callerTargets) {
    console.log(
      `  ${ct.parameterId.padEnd(45)} currentScore=${(ct.currentScore ?? 0).toFixed(3)}  callsUsed=${ct.callsUsed}`,
    );
  }

  // Run goal progress
  console.log("\ntrackGoalProgress(callerId)...");
  const goalResult = await trackGoalProgress(OPAL, lastCall.id);
  console.log(`  updated=${goalResult.updated} completed=${goalResult.completed}`);

  // Post-state
  console.log("\n=== AFTER ===");
  const after = await prisma.goal.findMany({
    where: { callerId: OPAL, type: "ACHIEVE", status: "ACTIVE" },
    select: { id: true, name: true, ref: true, progress: true },
    orderBy: { ref: "asc" },
  });
  for (const g of after) {
    console.log(
      `  ${(g.ref ?? "<null>").padEnd(8)} progress=${g.progress.toFixed(4)}  ${g.name.slice(0, 60)}`,
    );
  }

  const distinct = new Set(after.map((g) => g.progress)).size;
  console.log(
    `\nACHIEVE goals: ${after.length} total, ${distinct} distinct progress values`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

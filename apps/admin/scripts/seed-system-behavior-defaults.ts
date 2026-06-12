/**
 * Seed SYSTEM-scope BehaviorTarget defaults — #1513 Slice 3 of epic #1510.
 *
 * Populates `BehaviorTarget(scope=SYSTEM, playbookId=null, value=0.5)` for
 * the canonical behaviour parameters surfaced in
 * `lib/cascade/knob-keys.ts::LISTED_KNOBS` (family === "behavior-target").
 *
 * Why this exists: the SCORE_AGENT BehaviorTarget cascade in
 * `app/api/calls/[callId]/pipeline/route.ts::stageExecutors.SCORE_AGENT`
 * falls back from `(playbookId, scope=PLAYBOOK)` to
 * `(scope=SYSTEM, playbookId=null)`. When the SYSTEM cascade root is
 * empty (the data gap #1513 fixes), the cascade has nothing to read; I-AL5
 * escalates to ERROR (`systemDefaultsEmpty: true`). This script seeds the
 * cascade root so:
 *   1. New playbooks without explicit BEH-* targets still get a neutral
 *      baseline (every value at 0.5).
 *   2. Operators tune per-playbook via the Course Design Console; this
 *      script never writes at PLAYBOOK scope.
 *
 * Source of truth: `lib/cascade/knob-keys.ts::LISTED_KNOBS` — the same
 * catalogue the demo doc, KB facts, and (future) Cmd+K palette read. If
 * a knob is added to LISTED_KNOBS with `family: "behavior-target"`, this
 * script picks it up automatically on the next run.
 *
 * Idempotent: re-runs find each `(parameterId, scope=SYSTEM)` row already
 * present and report `[already set]`. Existing rows are NEVER overwritten —
 * if an operator hand-tuned a SYSTEM-scope value, we leave it alone.
 *
 * Usage:
 *   npx tsx scripts/seed-system-behavior-defaults.ts             # dry-run (default)
 *   npx tsx scripts/seed-system-behavior-defaults.ts --execute   # write
 *
 * Exit codes: 0 success / no-op, 1 unexpected error.
 *
 * @see lib/pipeline/score-agent-cascade.ts — cascade reader
 * @see lib/pipeline/adaptive-loop-invariants.ts::recordIAL5ZeroTargets — observability
 * @see docs/CHAIN-CONTRACTS.md §6 — I-AL5 row
 */

import { prisma } from "../lib/prisma";
import { LISTED_KNOBS } from "../lib/cascade/knob-keys";

const DEFAULT_TARGET_VALUE = 0.5; // Neutral mid-scale starting point.

interface SeedPlan {
  parameterId: string;
  label: string;
  targetValue: number;
}

interface SeedReport {
  toCreate: SeedPlan[];
  alreadySet: SeedPlan[];
  missingParameter: SeedPlan[];
}

/**
 * Build the canonical seed plan from `LISTED_KNOBS`.
 *
 * Exported so the vitest can pin "what would this script write?" without
 * touching the DB.
 */
export function buildSeedPlan(): SeedPlan[] {
  return LISTED_KNOBS.filter((k) => k.family === "behavior-target").map(
    (k) => ({
      parameterId: k.knobKey,
      label: k.label,
      targetValue: DEFAULT_TARGET_VALUE,
    }),
  );
}

/**
 * Classify each seed entry against the live DB. Pure read — never mutates.
 * Exported for the vitest.
 */
export async function classifySeedPlan(plan: SeedPlan[]): Promise<SeedReport> {
  const toCreate: SeedPlan[] = [];
  const alreadySet: SeedPlan[] = [];
  const missingParameter: SeedPlan[] = [];

  // BehaviorTarget.parameterId is a FK to Parameter.parameterId. Pre-filter
  // against the Parameter table so we never blow up on a missing FK at
  // write time — surface the gap to the operator instead.
  const parameterIds = plan.map((p) => p.parameterId);
  const existingParams = await prisma.parameter.findMany({
    where: { parameterId: { in: parameterIds } },
    select: { parameterId: true },
  });
  const knownParam = new Set(existingParams.map((p) => p.parameterId));

  for (const entry of plan) {
    if (!knownParam.has(entry.parameterId)) {
      missingParameter.push(entry);
      continue;
    }
    const existing = await prisma.behaviorTarget.findFirst({
      where: {
        parameterId: entry.parameterId,
        scope: "SYSTEM",
        playbookId: null,
      },
      select: { id: true, targetValue: true },
    });
    if (existing) {
      alreadySet.push(entry);
    } else {
      toCreate.push(entry);
    }
  }

  return { toCreate, alreadySet, missingParameter };
}

async function main(): Promise<number> {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`[seed-1513] mode=${mode}`);

  const plan = buildSeedPlan();
  console.log(`[seed-1513] catalogue: ${plan.length} BEH-* parameter(s) from LISTED_KNOBS`);

  const report = await classifySeedPlan(plan);

  console.log("");
  if (report.alreadySet.length > 0) {
    console.log(`[seed-1513] already-set (${report.alreadySet.length}):`);
    for (const entry of report.alreadySet) {
      console.log(`  NOOP    ${entry.parameterId.padEnd(28)} "${entry.label}"`);
    }
  }
  if (report.missingParameter.length > 0) {
    console.log(`[seed-1513] missing Parameter row (${report.missingParameter.length}):`);
    for (const entry of report.missingParameter) {
      console.log(`  MISSING ${entry.parameterId.padEnd(28)} "${entry.label}" — register the Parameter first`);
    }
  }
  if (report.toCreate.length > 0) {
    console.log(`[seed-1513] planned writes (${report.toCreate.length}):`);
    for (const entry of report.toCreate) {
      console.log(
        `  PLAN    ${entry.parameterId.padEnd(28)} "${entry.label}" → targetValue=${entry.targetValue}`,
      );
    }
  }

  if (execute && report.toCreate.length > 0) {
    let written = 0;
    for (const entry of report.toCreate) {
      // Re-check under a single statement (race window with concurrent
      // operator edit is small but real). Skip if a row landed since the
      // classify pass.
      const existing = await prisma.behaviorTarget.findFirst({
        where: {
          parameterId: entry.parameterId,
          scope: "SYSTEM",
          playbookId: null,
        },
        select: { id: true },
      });
      if (existing) {
        console.log(`  RACE    ${entry.parameterId} already created by a peer — skip`);
        continue;
      }
      await prisma.behaviorTarget.create({
        data: {
          parameterId: entry.parameterId,
          scope: "SYSTEM",
          playbookId: null,
          targetValue: entry.targetValue,
          source: "SEED",
          confidence: 0.5,
        },
      });
      written++;
      console.log(`  WROTE   ${entry.parameterId.padEnd(28)} "${entry.label}" → targetValue=${entry.targetValue}`);
    }
    console.log("");
    console.log(`[seed-1513] summary: wrote=${written} noop=${report.alreadySet.length} missing=${report.missingParameter.length}`);
  } else {
    console.log("");
    console.log(
      `[seed-1513] summary: plan=${report.toCreate.length} noop=${report.alreadySet.length} missing=${report.missingParameter.length}`,
    );
    console.log(
      `[seed-1513] ${execute ? "APPLIED" : "DRY-RUN (no writes); re-run with --execute to commit."}`,
    );
  }

  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[seed-1513] FATAL", err);
      process.exit(1);
    });
}

/**
 * writer-completeness-invariant.ts (#1620 + #1621 / Epic #1618 Slices 3+4)
 *
 * I-WC1 — Writer Completeness invariant. For each entry in
 * `WRITER_REGISTRY` with `expectedTrigger === "per-call"`, verify the
 * field is populated on the call's relevant row after the pipeline
 * completes. Records a violation per silent field — fires AT RUNTIME,
 * AT THE END OF THE PIPELINE, AT PER-CALL GRANULARITY.
 *
 * Where Slice 1 (PR #1625) detects silent writers 24h after they go
 * silent across the population, and Slice 2 (PR #1651) catches drift
 * at PR time when a registered writer / reader symbol vanishes, this
 * invariant catches the THIRD failure mode: "the writer code runs but
 * produced NULL on THIS SPECIFIC CALL". Useful for catching:
 *
 *   - A logic regression where the writer is reachable but a guard
 *     short-circuits it on a real-world input the test fixtures
 *     didn't cover.
 *   - A new playbook configuration that exercises a code path no
 *     existing CI fixture hits (e.g. continuous-mode courses that
 *     intentionally skip per-stage writes — those are filtered by
 *     `appliesTo` below to avoid false positives).
 *
 * Each violation lands as one `pipeline.invariant.i-wc1` AppLog row.
 * The detector at `/x/system/pipeline-health` aggregates them over a
 * 24h window the same way it aggregates Slice 1's silent-writer alarms.
 *
 * Default severity: `warn`. Promotion to `error` (which would halt the
 * pipeline if hard mode is enabled) is gated on operator opt-in via
 * the existing `STRICT_PIPELINE_INVARIANTS=1` env var pattern that
 * Slice 4 codifies — same migration plan as I-AL6's eventual NOT NULL
 * promotion.
 */

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import {
  WRITER_REGISTRY,
  type WriterRegistryEntry,
} from "@/lib/contracts/writer-registry";

export const I_WC1_STAGE = "pipeline.invariant.i-wc1";

export interface WriterCompletenessFinding {
  field: string;
  stage: string;
  writer: string;
  populated: boolean;
  /** Why this entry was skipped (e.g. continuous course / mock engine). */
  skipReason: string | null;
}

interface CheckArgs {
  callId: string;
  callerId: string | null;
  playbookId: string | null;
  courseStyle: "structured" | "continuous";
  engine: string;
}

/**
 * Check whether each per-call-trigger entry in WRITER_REGISTRY
 * produced a non-null value for THIS call. Returns one finding per
 * entry — the caller decides whether to log or escalate.
 *
 * The check intentionally only handles `expectedTrigger: "per-call"`
 * entries. Enrollment / operator-action / scheduled writers fire on a
 * different cadence; their detection lives in Slice 1's 24h alarm
 * rather than this per-call runtime invariant.
 */
export async function checkWriterCompletenessAfterPipeline(
  args: CheckArgs,
): Promise<WriterCompletenessFinding[]> {
  const findings: WriterCompletenessFinding[] = [];

  // Filter to per-call writers only. Other entries are out of scope
  // for the runtime per-call invariant.
  const perCallEntries = WRITER_REGISTRY.filter(
    (e: WriterRegistryEntry) => e.expectedTrigger === "per-call",
  );

  for (const entry of perCallEntries) {
    const populated = await isFieldPopulatedForCall(entry, args);
    findings.push({
      field: entry.field,
      stage: entry.stage,
      writer: entry.writer,
      populated: populated.populated,
      skipReason: populated.skipReason,
    });
  }

  // Emit one AppLog row per finding that's both NOT populated AND not
  // skipped. Skipped entries (e.g. continuous course filtering out a
  // structured-only writer) are correctly absent — the invariant
  // exists to catch unexpected absence, not by-design absence.
  const violations = findings.filter((f) => !f.populated && !f.skipReason);
  for (const v of violations) {
    log("system", I_WC1_STAGE, {
      message: `I-WC1: ${v.field} not populated on call ${args.callId} (writer: ${v.writer})`,
      level: "warn",
      invariant: "I-WC1",
      callId: args.callId,
      callerId: args.callerId,
      playbookId: args.playbookId,
      field: v.field,
      stage: v.stage,
      writer: v.writer,
    });
  }

  return findings;
}

interface PopulationResult {
  populated: boolean;
  skipReason: string | null;
}

/**
 * Dispatch by field name. New registry entries land here when they
 * need a per-call existence check. The default branch returns
 * `populated: true` with a skipReason — meaning "the invariant
 * doesn't yet know how to check this field" — rather than firing a
 * false alarm. This is a deliberate conservatism: a new registry
 * entry doesn't break the invariant until someone adds the
 * corresponding check below.
 */
async function isFieldPopulatedForCall(
  entry: WriterRegistryEntry,
  args: CheckArgs,
): Promise<PopulationResult> {
  switch (entry.field) {
    case "BehaviorMeasurement.evidence": {
      // The post-#1608 contract is at least one evidence quote per
      // BehaviorMeasurement row OR an explicit empty array
      // (transcript had no learner contribution for the behavior).
      // The invariant fails when EVERY row's evidence array is empty
      // — meaning the LLM didn't produce ANY usable quote for the
      // call as a whole, which is suspicious for a non-trivial
      // transcript.
      if (args.engine === "mock") {
        return { populated: true, skipReason: "mock engine — evidence not expected" };
      }
      const totalRows = await prisma.behaviorMeasurement.count({
        where: { callId: args.callId },
      });
      if (totalRows === 0) {
        return { populated: true, skipReason: "no BehaviorMeasurement rows — SCORE_AGENT skipped" };
      }
      const withEvidence = await prisma.behaviorMeasurement.count({
        where: {
          callId: args.callId,
          evidence: { isEmpty: false },
        },
      });
      return { populated: withEvidence > 0, skipReason: null };
    }

    case "RewardScore.targetUpdatesApplied": {
      // The post-#1609 contract is one RewardScore row per STRUCTURED
      // call with targetUpdatesApplied either populated or `[]`.
      // Continuous courses skip REWARD entirely (route.ts:1614) — no
      // RewardScore expected.
      if (args.courseStyle === "continuous") {
        return { populated: true, skipReason: "continuous course — REWARD intentionally skipped" };
      }
      const reward = await prisma.rewardScore.findFirst({
        where: { callId: args.callId },
        select: { targetUpdatesApplied: true },
      });
      if (!reward) {
        return { populated: true, skipReason: "no RewardScore row — REWARD bailed (separate invariant catches this)" };
      }
      // `null` = ADAPT sub-op 8 didn't run; `[]` = ran with no updates;
      // populated = ran with updates. Last two count as populated.
      return { populated: reward.targetUpdatesApplied !== null, skipReason: null };
    }

    case "Goal.progressMetrics": {
      // The post-#1614 contract is `progressMetrics.lastMentionedCallId`
      // pointing at THIS call OR the call had no active goals (caller
      // has no goals at all in this playbook).
      if (!args.callerId) return { populated: true, skipReason: "no callerId on call" };
      const totalGoals = await prisma.goal.count({
        where: { callerId: args.callerId, status: { in: ["ACTIVE", "PAUSED"] } },
      });
      if (totalGoals === 0) {
        return { populated: true, skipReason: "no ACTIVE / PAUSED goals — trackGoalProgress is a no-op" };
      }
      // Did at least ONE goal reflect this call in its progressMetrics?
      // (Not every active goal will fire on every call — strategies
      // legitimately skip.)
      const updated = await prisma.goal.count({
        where: {
          callerId: args.callerId,
          progressMetrics: {
            path: ["lastMentionedCallId"],
            equals: args.callId,
          },
        },
      });
      return { populated: updated > 0, skipReason: null };
    }

    case "RewardScore.effectiveTargets": {
      // The post-#1641-followup contract is `effectiveTargets` is a
      // non-null Object on the call's RewardScore row.
      if (args.courseStyle === "continuous") {
        return { populated: true, skipReason: "continuous course — REWARD intentionally skipped" };
      }
      const reward = await prisma.rewardScore.findFirst({
        where: { callId: args.callId },
        select: { effectiveTargets: true },
      });
      if (!reward) {
        return { populated: true, skipReason: "no RewardScore row — REWARD bailed (separate invariant catches this)" };
      }
      return { populated: reward.effectiveTargets !== null, skipReason: null };
    }

    default:
      // Conservative default — the invariant doesn't know how to
      // check this field. Add a case branch when registering a new
      // per-call field.
      return { populated: true, skipReason: `i-wc1 dispatch missing for field "${entry.field}" — add a case in writer-completeness-invariant.ts` };
  }
}

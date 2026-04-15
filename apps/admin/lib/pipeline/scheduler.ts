/**
 * scheduler.ts — #155 Slice 2.
 *
 * `selectNextExchange(state, policy)` is the single explicit owner of
 * per-exchange selection decisions in continuous mode. It replaces the scatter
 * of ad-hoc logic in COMPOSE transforms. See:
 *   - docs/decisions/2026-04-14-scheduler-owns-the-plan.md
 *   - docs/decisions/2026-04-14-outcome-graph-pacing.md
 *
 * Slice 1 ordering (already shipped in event-gate.ts):
 *   EXTRACT on call N reads the SchedulerDecision written by COMPOSE on call N-1
 *   from CallerAttribute[scope=CURRICULUM, key=scheduler:last_decision]. Scoring
 *   is only allowed when the prior mode ∈ config.scheduler.assessmentModes.
 *
 * This module is pure — no DB, no LLM, no I/O. The caller fetches all state
 * upstream (modules.ts continuous branch) and hands it in. That keeps the
 * function unit-testable and deterministic.
 *
 * Candidate pool: we delegate TP/LO selection to `selectWorkingSet`
 * (lib/curriculum/working-set-selector.ts) rather than reimplementing the
 * budget/prereq/mastery-weighting/review-vs-new logic. The scheduler's new job
 * is mode selection (teach | review | assess | practice), reason traces, and
 * preserving the `frontierModuleId` contract for downstream pedagogy guidance.
 *
 * `contentSourceId` is emitted as null in v1 — the ADR reserves the field for
 * when content-source-aware selection lands. Kept on the decision shape for
 * forward compatibility.
 */

import { selectWorkingSet, type WorkingSetInput, type WorkingSetResult } from "@/lib/curriculum/working-set-selector";
import type { SchedulerDecision, SchedulerMode } from "./scheduler-decision";
import type { SchedulerPolicy } from "./scheduler-presets";

export interface SchedulerState {
  /** Candidate-pool inputs — forwarded to `selectWorkingSet`. */
  workingSetInput: WorkingSetInput;
  /**
   * Prior scheduler decision for this caller (from the last call). Used for:
   *   - retrieval cadence counter (`callsSinceLastAssess`)
   *   - interleave bonus (avoid repeating the same outcome)
   *   - recently-used penalty
   * Null on the first call.
   */
  priorDecision: SchedulerDecision | null;
  /**
   * How many calls have happened since the last `mode: assess` decision.
   * Derived upstream by walking CallerAttribute history. v1 uses a simple
   * counter: increment on every call, reset on assess.
   */
  callsSinceLastAssess: number;
}

/**
 * The scheduler runs once per COMPOSE and returns both the decision (for
 * persistence to CallerAttribute) and the full working-set result (so the
 * caller can preserve `frontierModuleId` and `selectedLOs` for downstream
 * pedagogy guidance rendering — see the frontierModuleId contract in #155).
 */
export interface SchedulerRun {
  decision: SchedulerDecision;
  workingSet: WorkingSetResult;
}

/**
 * Pure, deterministic selection of the next exchange.
 *
 * Failure modes:
 *   - `workingSetInput` produces an empty set → return a safe fallback decision
 *     with `mode: "teach"` and empty working set (logged by caller).
 *   - Prior decision is null (first call) → cadence counter defaults to 0 and
 *     mode drops to `teach` unless `retrievalCadence === 1`.
 */
export function selectNextExchange(
  state: SchedulerState,
  policy: SchedulerPolicy,
): SchedulerRun {
  const { workingSetInput, priorDecision, callsSinceLastAssess } = state;

  // Apply preset-level mastery threshold override if set. The LO-level
  // override (from lo.masteryThreshold ?? module.masteryThreshold) is applied
  // upstream in modules.ts when building the input; the preset override is a
  // second layer that biases the whole call.
  const effectiveInput: WorkingSetInput = policy.masteryThresholdOverride != null
    ? { ...workingSetInput, masteryThreshold: policy.masteryThresholdOverride }
    : workingSetInput;

  const ws: WorkingSetResult = selectWorkingSet(effectiveInput);

  // ── Empty-pool fallback ──
  if (ws.assertionIds.length === 0 || ws.selectedLOs.length === 0) {
    return {
      decision: {
        mode: "teach",
        outcomeId: null,
        contentSourceId: null,
        workingSetAssertionIds: [],
        reason: `scheduler: empty working set (${ws.totalLOs} LOs, ${ws.totalTps} TPs) — fallback teach mode`,
        writtenAt: new Date().toISOString(),
      },
      workingSet: ws,
    };
  }

  // ── Mode selection ──
  //
  // v1 is deterministic: retrieval cadence from the preset drives when to
  // fire `mode: assess`. Interleave and spaced-repetition signals influence
  // *which outcome* to pick (not mode). This is the minimum viable policy
  // that delivers event-gated scoring and Track A cadence without requiring
  // real spaced-repetition due-date tracking (that's Slice 3).
  const { mode, modeReason } = pickMode({
    callsSinceLastAssess,
    cadence: policy.retrievalCadence,
    hasReviewable: ws.reviewIds.length > 0,
    priorMode: priorDecision?.mode ?? null,
  });

  // ── Outcome selection ──
  //
  // Score each selectedLO with the weighted factors. `selectWorkingSet`
  // already applies α (mastery gap) and −ε (recently-used, via review vs new
  // split) implicitly. We layer γ (interleave) and η (retrieval opportunity)
  // on top to pick *which* of the selected LOs becomes the primary outcome
  // for this exchange.
  const priorOutcomeId = priorDecision?.outcomeId ?? null;

  const scoredLOs = ws.selectedLOs.map((lo) => {
    let score = 0;

    // α — mastery gap: review LOs have a higher gap than fresh LOs
    score += policy.masteryGap * (lo.status === "review" ? 1.0 : 0.7);

    // γ — interleave bonus: prefer LOs that differ from the prior call's outcome
    if (priorOutcomeId && lo.id !== priorOutcomeId) {
      score += policy.interleave;
    }

    // η — retrieval opportunity: in assess mode, prefer LOs the learner has
    // touched before (review status) because retrieval practice is the goal
    if (mode === "assess" && lo.status === "review") {
      score += policy.retrievalOpportunity;
    }

    // −ε — recently-used penalty: if this is the same outcome as last call,
    // penalise (interleave is bidirectional with this)
    if (priorOutcomeId && lo.id === priorOutcomeId) {
      score -= policy.recentlyUsedPenalty;
    }

    // −ζ — cognitive-load penalty: LOs with many TPs carry a load cost
    const loadCost = Math.max(0, lo.childTpIds.length - 3) * 0.1;
    score -= policy.cognitiveLoadPenalty * loadCost;

    return { lo, score };
  });

  scoredLOs.sort((a, b) => b.score - a.score);
  const picked = scoredLOs[0].lo;

  const reason = [
    `scheduler:${policy.name.toLowerCase()}`,
    `mode=${mode} (${modeReason})`,
    `outcome=${picked.ref} (${picked.status})`,
    `pool=${ws.selectedLOs.length}LOs/${ws.assertionIds.length}TPs`,
    `callsSinceAssess=${callsSinceLastAssess}`,
  ].join(" | ");

  return {
    decision: {
      mode,
      outcomeId: picked.id,
      // v1: content-source-aware selection is out of scope. Field preserved
      // on the shape for forward compatibility.
      contentSourceId: null,
      workingSetAssertionIds: ws.assertionIds,
      reason,
      writtenAt: new Date().toISOString(),
    },
    workingSet: ws,
  };
}

// ── Mode picker ──────────────────────────────────────────

interface PickModeInput {
  callsSinceLastAssess: number;
  cadence: number;
  hasReviewable: boolean;
  priorMode: SchedulerMode | null;
}

function pickMode(input: PickModeInput): { mode: SchedulerMode; modeReason: string } {
  const { callsSinceLastAssess, cadence, hasReviewable, priorMode } = input;

  // Track A retrieval: fire assess when the cadence threshold is reached.
  // This is the minimum viable gate for event-gated scoring.
  if (callsSinceLastAssess >= cadence) {
    return {
      mode: "assess",
      modeReason: `retrieval cadence reached (${callsSinceLastAssess}/${cadence})`,
    };
  }

  // If we just assessed last call, offer a review pass so the learner
  // consolidates rather than racing into new material.
  if (priorMode === "assess" && hasReviewable) {
    return {
      mode: "review",
      modeReason: "consolidation after prior assess",
    };
  }

  // Default: teach mode. Scoring is suppressed next call (by event-gate)
  // because `teach` is not in config.scheduler.assessmentModes.
  return {
    mode: "teach",
    modeReason: `below retrieval cadence (${callsSinceLastAssess}/${cadence})`,
  };
}

/**
 * append-progress-entry.ts (#1614 / Epic #1618)
 *
 * Pure helper for updating `Goal.progressMetrics` when a strategy fires
 * a progress delta. Matches the shape already written by
 * `lib/goals/extract-goals.ts::extractGoals` and read by the Attainment
 * tab's goal evidence trail (`app/api/callers/[callerId]/attainment/route.ts::buildGoalTrail`)
 * — extending the existing `evidence[]` + mention-tracking contract
 * rather than introducing a parallel shape.
 *
 * Pre-#1614 the writer at `lib/goals/track-progress.ts::trackGoalProgress`
 * incremented `Goal.progress` (the scalar) but never touched
 * `progressMetrics`. As a result every Goal in the DB has either NULL
 * `progressMetrics` (1,000 rows on hf-dev sandbox 2026-06-14) or
 * extraction-time metadata frozen at create time (113 rows). The
 * Attainment tab's `mentionCount` never advanced once the goal was
 * created; the evidence trail rendered "First noticed N days ago"
 * indefinitely.
 *
 * This helper extends the existing shape by:
 *   - bootstrapping `progressMetrics = {}` when the goal was created
 *     programmatically (NULL pre-fix) so per-call progress still leaves
 *     a trail
 *   - pushing the strategy's `evidence` string onto `evidence[]`
 *     (newest-last; the reader reverses to show newest-first)
 *   - capping `evidence[]` at `capN` entries (default 50)
 *   - updating `lastMentionedCallId`, `lastMentionedAt`, `mentionCount`
 *   - never overwriting extraction metadata (`extractionMethod`,
 *     `confidence`, `sourceCallId`, `extractedAt`, original `evidence[]`
 *     entries) — strategy writes APPEND, they never overwrite
 *   - idempotent on (currentMetrics, callId): if the last call to
 *     update was the same `callId`, the existing evidence + counter
 *     update is replayed in place (no double-count on pipeline retry)
 */

import type { StrategyKey } from "@/lib/goals/strategies/types";

/**
 * The `Goal.progressMetrics` shape this helper produces. Matches the
 * existing `extract-goals.ts` writer + `buildGoalTrail` reader contract.
 * Extra fields tolerated; missing fields default sensibly.
 */
export interface GoalProgressMetricsShape {
  extractionMethod?: string;
  confidence?: number;
  evidence?: string[];
  sourceCallId?: string;
  extractedAt?: string;
  lastMentionedCallId?: string;
  lastMentionedAt?: string;
  mentionCount?: number;
  /** Optional per-strategy hint so the trail can label "scored on call N by skill_ema". */
  lastStrategy?: StrategyKey;
}

export interface NewProgressEntry {
  callId: string;
  /** ISO timestamp — caller passes a stable instant so tests stay deterministic. */
  at: string;
  /** Evidence the strategy produced for this delta. May be undefined when the strategy is a rollup with no per-call quote. */
  evidence?: string;
  /** Which strategy fired. */
  sourceStrategy: StrategyKey;
}

/** Default cap on the evidence array. ~5 KB at 50 entries. */
export const DEFAULT_EVIDENCE_CAP = 50;

/**
 * Compute the new `progressMetrics` value for a `Goal.update` call. Pure —
 * no I/O, no side effects. Caller passes the result straight to
 * `prisma.goal.update({ data: { progressMetrics } })`.
 *
 * Idempotency: if `currentMetrics.lastMentionedCallId === entry.callId`,
 * the function REPLAYS the previous update in place (replaces the last
 * evidence entry with the new one, leaves `mentionCount` at its
 * previous value). Pipeline retries against the same call don't grow
 * the array or inflate the counter.
 */
export function appendGoalProgressEntry(
  currentMetrics: GoalProgressMetricsShape | null | undefined,
  entry: NewProgressEntry,
  capN: number = DEFAULT_EVIDENCE_CAP,
): GoalProgressMetricsShape {
  const base: GoalProgressMetricsShape = { ...(currentMetrics ?? {}) };
  const existingEvidence: string[] = Array.isArray(base.evidence) ? [...base.evidence] : [];

  const isReplayOfSameCall = base.lastMentionedCallId === entry.callId;

  // Append (or replace on replay) the strategy's evidence string.
  if (entry.evidence) {
    if (isReplayOfSameCall && existingEvidence.length > 0) {
      existingEvidence[existingEvidence.length - 1] = entry.evidence;
    } else {
      existingEvidence.push(entry.evidence);
    }
  }

  // Trim to last N. Oldest entries roll off the front.
  const trimmedEvidence =
    existingEvidence.length > capN
      ? existingEvidence.slice(existingEvidence.length - capN)
      : existingEvidence;

  return {
    ...base,
    // Always present (even when no strategy evidence string is produced).
    evidence: trimmedEvidence,
    lastMentionedCallId: entry.callId,
    lastMentionedAt: entry.at,
    mentionCount: isReplayOfSameCall
      ? base.mentionCount ?? 1
      : (base.mentionCount ?? 0) + 1,
    lastStrategy: entry.sourceStrategy,
  };
}

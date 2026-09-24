/**
 * validateIeltsCompletion — #1953 (Boaz/Eldar pre-voice gap analysis,
 * Cross-cutting A + Unit 1.2 + Unit 5).
 *
 * Single-source completion gate for IELTS-modal calls. A call is
 * "scorable" only when all four IELTS criteria carry a non-null,
 * non-zero score on the aggregate row:
 *
 *   skill_fluency_and_coherence_fc
 *   skill_pronunciation_p
 *   skill_lexical_resource_lr
 *   skill_grammatical_range_and_accuracy_gra
 *
 * Read site: AGGREGATE stage executor, immediately after
 * `applyProsodyContractToAggregate()` returns mode === "ielts". The
 * gate runs BEFORE the mastery writer in `track-progress.ts:665` so a
 * waived row can't be clobbered back to NOT_STARTED on the next
 * pipeline run (the chain-contract race the helper closes).
 *
 * Boaz's bar (output, consumer, visible change):
 *   - OUTPUT: a boolean completion flag for the call's IELTS module
 *   - CONSUMER: `stageExecutors.AGGREGATE` decides whether to fire
 *     `markModuleIncomplete` with `reason: "ielts_criteria"`
 *   - VISIBLE CHANGE: a session missing any criterion score does not
 *     mark the module complete; the picker stays on this module until
 *     the second-attempt waiver fires (Theme 9 #1703)
 *
 * Related:
 *   #1953 — this story
 *   #1700 — IELTS pre-voice epic
 *   #1703 — markModuleIncomplete chokepoint + sticky-waiver
 *   #1252 — courseStyle default-deny
 *   #1823 — Session.metadata.overallBand writer (sibling AGGREGATE tail)
 *   docs/draft-issues/ielts-pre-voice-gap-analysis-response-2026-06-18.md
 */

import { prisma } from "@/lib/prisma";

/** IELTS 4-criteria parameter ids. Post-#2138 (epic #2135 S3) these are
 *  written by the IELTS-MEASURE-001 LLM spec via the canonical SCORE_AGENT
 *  path (#2155); prosody-consumer writes its own `prosody_raw_*` namespace
 *  instead. The IDs here are the LLM-judged scores the completion gate
 *  reads to decide whether all 4 criteria have a non-zero score. */
export const IELTS_COMPLETION_PARAM_IDS = {
  fluencyCoherence: "skill_fluency_and_coherence_fc",
  pronunciation: "skill_pronunciation_p",
  lexicalResource: "skill_lexical_resource_lr",
  grammaticalRange: "skill_grammatical_range_and_accuracy_gra",
} as const;

const REQUIRED_PARAM_IDS = Object.values(
  IELTS_COMPLETION_PARAM_IDS,
) as readonly string[];

export interface ValidateIeltsCompletionResult {
  /** All four criteria carry score > 0 on the call's aggregate row. */
  complete: boolean;
  /** Parameter ids missing OR scored zero. Empty when `complete === true`. */
  missing: string[];
}

/**
 * Check whether the call's aggregate IELTS scores satisfy the 4-criteria
 * gate. Reads the aggregate (`segmentKey IS NULL`) rows written by the
 * IELTS-MEASURE-001 LLM spec via the canonical SCORE_AGENT path (post-#2138).
 * Per-phase rows are intentionally NOT consulted because the gate runs
 * at call-level.
 *
 * Score must be `> 0` (the writer skips non-finite bands but a zero
 * band would still produce a `score = 0` row; that's an incomplete
 * criterion in Boaz's "non-null, non-zero" definition).
 *
 * Caller decides what to do on incomplete; this helper only reads.
 */
export async function validateIeltsCompletion(
  callId: string,
): Promise<ValidateIeltsCompletionResult> {
  if (!callId) {
    throw new Error("validateIeltsCompletion: callId is required");
  }

  const rows = await prisma.callScore.findMany({
    where: {
      callId,
      parameterId: { in: [...REQUIRED_PARAM_IDS] },
      segmentKey: null,
    },
    select: { parameterId: true, score: true },
  });

  const scoredParamIds = new Set(
    rows.filter((r) => r.score > 0).map((r) => r.parameterId),
  );

  const missing = REQUIRED_PARAM_IDS.filter((id) => !scoredParamIds.has(id));

  return {
    complete: missing.length === 0,
    missing,
  };
}

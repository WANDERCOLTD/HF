/**
 * interleaveReview transform (#492 E3 Slice 3.3)
 *
 * Reads {@link InterleaveReviewData} from `loadedData.interleaveReview` and
 * emits the markdown block the tutor will see. Returns `null` when there is
 * no review to surface — combined with `fallback.action: "omit"` on the
 * section definition, the executor's "strip undefined" pass drops the
 * section entirely from `llmPrompt`.
 *
 * Output shape (consumed by the LLM prompt assembler):
 *   {
 *     hasReview: true,
 *     heading: "Review opportunity",
 *     body: "## Review opportunity\n\nIt's been 5 days since the learner last practised Part 1.\nConsider a brief review check-in.",
 *     summary: "It's been 5 days since the learner last practised Part 1. Consider a brief review check-in.",
 *     candidateSlug: "ielts-part-1",
 *     daysSinceLastCall: 5,
 *   }
 *
 * The tone is intentionally NEUTRAL / OPPORTUNITY — "Consider a brief review
 * check-in", not "review Part 1 next". The tutor decides whether to weave it
 * into the conversation; we never override the active module.
 *
 * @see loaders/interleaveReview.ts
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "../types";
import type { InterleaveReviewData } from "../loaders/interleaveReview";

export interface InterleaveReviewSection {
  hasReview: boolean;
  /** Markdown heading text — the tutor reads this verbatim. */
  heading: string;
  /** Fully assembled markdown block — heading + body. */
  body: string;
  /** 1-sentence tutor-facing summary (already includes day count). */
  summary: string;
  /** Slug of the mastered module being suggested for review. */
  candidateSlug: string | null;
  daysSinceLastCall: number | null;
}

const HEADING = "Review opportunity";

registerTransform("renderInterleaveReview", (
  rawData: InterleaveReviewData | null | undefined,
  _context: AssembledContext,
  _sectionDef: CompositionSectionDef,
): InterleaveReviewSection | null => {
  if (!rawData || !rawData.hasReview || !rawData.summary) {
    return null;
  }
  const body = `## ${HEADING}\n\n${rawData.summary}`;
  return {
    hasReview: true,
    heading: HEADING,
    body,
    summary: rawData.summary,
    candidateSlug: rawData.candidateModule?.slug ?? null,
    daysSinceLastCall: rawData.daysSinceLastCall,
  };
});

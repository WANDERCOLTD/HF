/**
 * priorCallFeedback transform (#492 Slice 3.5)
 *
 * Reads the {@link PriorCallFeedbackData} from `loadedData.priorCallFeedback`
 * and emits the section payload for the final prompt. Returns `null` when
 * there is no feedback to surface so the section is dropped by the executor's
 * "strip undefined" pass.
 *
 * Wire-up:
 *   - dataSource: "priorCallFeedback"
 *   - transform : "renderPriorCallFeedback"
 *   - outputKey : "priorCallFeedback"
 *   - condition : "dataExists" (the loader always returns an object — the
 *                 transform short-circuits to `null` when hasFeedback=false)
 *
 * The student-facing copy is built in the loader so callers (e.g. tests, dev
 * dashboards) get the same `summary` string the composer renders.
 */

import { registerTransform } from "../TransformRegistry";
import type {
  AssembledContext,
  CompositionSectionDef,
  PriorCallFeedbackData,
} from "../types";

export interface PriorCallFeedbackSection {
  hasFeedback: boolean;
  /** Markdown heading text — the tutor reads this verbatim */
  heading: string;
  /** 1–2 sentence canned summary (already includes relative time) */
  summary: string;
  lastCallAt: string | null;
  lastCallId: string | null;
  weakestParameterName: string | null;
  weakestParameterScore: number | null;
  overallScore: number | null;
}

const HEADING = "Since your last attempt on this module";

registerTransform("renderPriorCallFeedback", (
  rawData: PriorCallFeedbackData | null | undefined,
  _context: AssembledContext,
  _sectionDef: CompositionSectionDef,
): PriorCallFeedbackSection | null => {
  if (!rawData || !rawData.hasFeedback || !rawData.summary) {
    return null;
  }
  return {
    hasFeedback: true,
    heading: HEADING,
    summary: rawData.summary,
    lastCallAt: rawData.lastCallAt,
    lastCallId: rawData.lastCallId,
    weakestParameterName: rawData.weakestParameterName,
    weakestParameterScore: rawData.weakestParameterScore,
    overallScore: rawData.overallScore,
  };
});

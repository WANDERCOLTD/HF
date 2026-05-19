/**
 * courseComplete transform (#492 E3 Slice 3.7)
 *
 * Renders the celebratory block when the courseComplete loader reports
 * `courseComplete: true`. The transform sits at HIGH priority (5) in the
 * default sections so the tutor reads "celebrate and consolidate" BEFORE
 * any teaching directives (modules / mockDiagnostic / interleaveReview live
 * at priority 7+).
 *
 * Mode-specific phrasing:
 *   - "terminal-only" → "completed the final module"
 *   - "all-modules"   → "mastered every module"
 *   - "any"           → "completed at least one module — celebrate this
 *                       milestone even if more remain to explore"
 *
 * Returns null when the loader reported `courseComplete: false`. Combined
 * with the section's `fallback.action: "omit"`, that drops the section from
 * the final llmPrompt entirely on non-complete calls.
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import type { CompletionMode } from "@/lib/curriculum/course-completion";

export interface CourseCompleteSection {
  hasData: true;
  completionMode: CompletionMode | null;
  completedAt: string | null;
  daysSinceCompletion: number | null;
  /** Pre-rendered tutor-facing celebration block. */
  body: string;
}

// --- mode phrasing ---------------------------------------------------------

function phraseForMode(mode: CompletionMode | null): string {
  switch (mode) {
    case "terminal-only":
      return "completed the final module";
    case "all-modules":
      return "mastered every module";
    case "any":
      return "completed at least one module — celebrate this milestone even if more remain to explore";
    default:
      // Defensive — unreachable if loader returns a real verdict.
      return "completed the course";
  }
}

function buildBody(mode: CompletionMode | null, daysSinceCompletion: number | null): string {
  const modePhrasing = phraseForMode(mode);
  const daysLine =
    daysSinceCompletion != null
      ? `Completed ${daysSinceCompletion} day(s) ago.`
      : "Completion timestamp not recorded.";
  return [
    "## Course complete — celebrate and consolidate",
    "",
    `The learner has completed this course (${modePhrasing}). Your role for this session:`,
    "1. Open with a warm congratulation referencing their journey.",
    "2. Offer a light review check-in — pick any topic from the course they want to refresh.",
    "3. Encourage them to apply what they've learned in a real-world context.",
    "4. Do NOT push toward \"next module\" or \"next session\" content — there isn't one.",
    "",
    daysLine,
  ].join("\n");
}

// --- transform -------------------------------------------------------------

/**
 * Read `loadedData.courseComplete` (populated by the courseComplete loader)
 * and emit the section payload when courseComplete is true. Returns null
 * otherwise — `fallback.action: "omit"` does the rest.
 */
registerTransform("buildCourseCompleteBlock", (
  _rawData: any,
  context: AssembledContext,
): CourseCompleteSection | null => {
  const data = (context.loadedData as any).courseComplete as
    | { courseComplete?: boolean; completionMode?: CompletionMode | null; completedAt?: string | null; daysSinceCompletion?: number | null }
    | null
    | undefined;

  if (!data || data.courseComplete !== true) {
    return null;
  }

  return {
    hasData: true,
    completionMode: data.completionMode ?? null,
    completedAt: data.completedAt ?? null,
    daysSinceCompletion: data.daysSinceCompletion ?? null,
    body: buildBody(data.completionMode ?? null, data.daysSinceCompletion ?? null),
  };
});

// --- helpers shared with modules transform / tests -------------------------

/**
 * True when the courseComplete loader produced a positive verdict in this
 * compose. Used by `transforms/modules.ts` to switch the modules section to
 * its thin/titles-only output shape.
 */
export function isCourseCompleteFromLoadedData(
  loadedData: { courseComplete?: { courseComplete?: boolean } | null } | null | undefined,
): boolean {
  return loadedData?.courseComplete?.courseComplete === true;
}

// Exported for unit tests so the body can be inspected without going through
// the transform registry.
export const __test = { phraseForMode, buildBody };

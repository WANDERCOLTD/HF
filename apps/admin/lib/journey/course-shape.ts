/**
 * course-shape.ts — Phase P3d of the Course Detail tab refactor (epic #1850).
 *
 * Adapter from the binary runtime `CourseStyle`
 * (`structured | continuous` from `lib/pipeline/course-style.ts`) to the
 * ternary editor-facing `CourseShape` (`structured | continuous | exam`
 * from `lib/journey/setting-contracts.ts`).
 *
 * The `JourneySettingContract.appliesTo` field is keyed by `CourseShape`
 * so the Inspector can render an `out-of-shape` overlay for settings the
 * current course doesn't use (e.g. IELTS cue-card pool on a non-exam
 * structured course). The runtime pipeline only cares about the binary
 * style; this adapter is purely the EDITOR side per the
 * `setting-contracts.ts` `CourseShape` JSDoc:
 *
 *   > `appliesTo` is the *editor-facing* envelope: it tells the Inspector
 *   > whether to render a setting at all for a given course. The runtime
 *   > course-style resolver is unchanged.
 *
 * Detection heuristic (short-term):
 *   - `lessonPlanMode !== "structured"` → `"continuous"`
 *   - any module carries non-empty `settings.cueCardPool` → `"exam"`
 *   - otherwise → `"structured"`
 *
 * The cue-card-pool heuristic is a stop-gap: long-term the wizard
 * projection should set an explicit `Playbook.config.examShape` (or
 * widen `lessonPlanMode` to a ternary value) so this helper doesn't
 * have to read into `modules[].settings`. Tracked separately — for
 * now the heuristic matches the way IELTS courses are authored
 * (the cue-card pool is the most discriminating module setting).
 */

import { getCourseStyle } from "../pipeline/course-style";
import type { PlaybookConfig } from "../types/json-fields";
import type { CourseShape } from "./setting-contracts";

/**
 * Derive the editor-facing `CourseShape` from a Playbook config.
 *
 * Returns `"continuous"` when the runtime style resolver says so, the
 * Inspector hides modules entirely on this branch.
 *
 * For structured courses, looks for an exam-like signal — any
 * AuthoredModule whose `settings.cueCardPool` is a non-empty array.
 * That marks the course as an exam (the IELTS Mock pattern). All other
 * structured courses resolve to `"structured"`.
 */
export function getCourseShape(
  config: PlaybookConfig | null | undefined,
): CourseShape {
  const style = getCourseStyle(config);
  if (style === "continuous") return "continuous";
  const modules = config?.modules ?? [];
  const hasCueCardPool = modules.some((m) => {
    const pool = m?.settings?.cueCardPool;
    return Array.isArray(pool) && pool.length > 0;
  });
  return hasCueCardPool ? "exam" : "structured";
}

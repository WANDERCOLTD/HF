/**
 * course-style.ts
 *
 * Single source of truth for STRUCTURED vs CONTINUOUS course shape at runtime.
 *
 * DEFAULT-DENY: anything that isn't an explicit `lessonPlanMode === "structured"`
 * resolves to `"continuous"`. No inference from `modulesAuthored`, `curriculumId`,
 * or `playbookCurricula`. Old playbooks degrade to topic-pool conversations
 * until an admin re-publishes (visible regression, operator-fixable) — better
 * than the silent fall-through hallucination class that #1252 closes.
 *
 * Read by every pipeline stage that branches on course shape. Pre-resolved
 * once at `runSpecDrivenPipeline` entry and threaded into `PipelineContext`
 * so individual stages never re-derive (and never reach for a different
 * field by accident).
 *
 * Related:
 *   #1252 — epic
 *   #1253 — this enabler
 *   #1259 — ESLint rule `hf-pipeline/no-module-read-without-course-style-guard`
 *           encodes the same default-deny rule at build time.
 */

import type { PlaybookConfig } from "@/lib/types/json-fields";

export type CourseStyle = "structured" | "continuous";

/**
 * Resolve course style from a Playbook config.
 *
 * Explicit `lessonPlanMode === "structured"` → "structured".
 * Everything else (undefined, null, `"continuous"`, malformed string,
 * `{ modulesAuthored: true }` alone, empty `{}`) → "continuous".
 *
 * **Do not add a fallback derivation here.** The whole point of the helper
 * is to be the *one* place this decision is made — adding "smart" inference
 * reproduces the bug class #1252 exists to kill.
 */
export function getCourseStyle(
  config: PlaybookConfig | null | undefined,
): CourseStyle {
  if (config?.lessonPlanMode === "structured") return "structured";
  return "continuous";
}

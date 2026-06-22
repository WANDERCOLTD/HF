/**
 * Compatibility matrix — AssessmentKind ↔ AuthoredModuleMode.
 *
 * Locked decision 7 (epic #2176): cross-check the 4 fragmented enums
 * (`AssessmentKind` / `AuthoredModuleMode` / `JourneyStopKind` /
 * `FirstCallMode`) so a plan that cites a module whose mode can't host
 * the moment's kind fails the Coverage gate.
 *
 * Source-of-truth for:
 *  - `tests/lib/assessment/course-assessment-plan-coverage.test.ts`
 *    (the build-time Coverage gate)
 *  - `components/scoring-tab/AssessmentMomentEditor.tsx` (the UI
 *    surfaces a non-blocking warning when the operator picks a
 *    moduleSlug whose mode isn't in the kind's allow-list).
 *
 * Lifted from the inline copy in the Coverage test as part of #2176
 * S1 of the AssessmentPlan editor build (one canonical location so
 * the UI + the Coverage gate can never disagree).
 */

import type { AssessmentKind, AuthoredModuleMode } from "@/lib/types/json-fields";

/**
 * Which `AuthoredModuleMode` values can host each `AssessmentKind`.
 *
 * Mapping rationale (epic #2176 + #2009):
 *  - `upfront-baseline` → `examiner` (Baseline Assessment module) or
 *    `mock-exam` (full-mock-style upfront diagnostic).
 *  - `midpoint-check` → `quiz` (per-unit MCQ check) or `examiner`
 *    (mid-course examiner-style probe).
 *  - `end-mock` → `examiner` or `mock-exam` (full terminal mock).
 *  - `popquiz` → `quiz` only (the canonical CIO/CTO Pop Quiz shape).
 *  - `rubric-board-chair` → `mock-exam` or `examiner` (Distinction-tier
 *    board-chair rubric — see epic #2009 Story E #2015).
 */
export const KIND_MODE_COMPATIBILITY: Record<
  AssessmentKind,
  ReadonlyArray<AuthoredModuleMode>
> = {
  "upfront-baseline": ["examiner", "mock-exam"],
  "midpoint-check": ["quiz", "examiner"],
  "end-mock": ["examiner", "mock-exam"],
  popquiz: ["quiz"],
  "rubric-board-chair": ["mock-exam", "examiner"],
};

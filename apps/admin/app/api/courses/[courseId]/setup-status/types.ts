/**
 * Single-source-of-truth response type for GET /api/courses/[courseId]/setup-status.
 *
 * Shared between the route handler (its `NextResponse.json` payload conforms
 * to this) and the consumer hook (`useCourseSetupStatus`'s `readiness` input
 * extends this). Drift between server and client becomes a TypeScript error
 * instead of a silent runtime mystery.
 *
 * Pattern proposed in #428 (#418 silently shipped a broken chip when the route
 * stopped returning `activeCurriculumMode`; the hook still expected it; no
 * compile-time check caught the drift). Pilot for a codebase-wide sweep.
 */

export type ActiveCurriculumMode = "authored" | "derived";

export interface SetupStatusResponse {
  ok: true;
  lessonPlanBuilt: boolean;
  onboardingConfigured: boolean;
  promptComposable: boolean;
  allCriticalPass: boolean;
  /**
   * Issue #418 — which curriculum source is in effect.
   * - "authored" = Course Reference module catalogue drives modules
   * - "derived"  = AI extraction generates modules from uploaded content
   *
   * Drives the `CurriculumSourcePill` in the course header and the
   * `ModeToggle` in the Curriculum tab.
   */
  activeCurriculumMode: ActiveCurriculumMode;
  /**
   * #444 — every Goal in this playbook has a non-null progressStrategy.
   * When false, dispatch falls back to manual_only at runtime; the wizard
   * surfaces `unstrategisedGoalCount` so the educator can fix the offenders
   * (typically caller-expressed goals that need a SKILL/LO link).
   */
  strategiesAssigned: boolean;
  unstrategisedGoalCount: number;
  /**
   * #884 S0 — stopgap "Ready to Teach" gating signals.
   *
   * Stages 1–3 of the Course Setup tracker (Course Created, Content Uploaded,
   * Teaching Points Ready) are currently derived client-side from subject/source
   * data already loaded on the page. The server exposes these booleans so the
   * `useCourseSetupStatus` hook can enforce the invariant
   * `ready_to_teach ⇒ ∀ prior step done` without re-fetching subjects.
   *
   * These are deliberately NOT folded into `allCriticalPass` — the full
   * chain-contract refactor (S1–S2, see
   * `docs/decisions/2026-05-26-extend-chain-contracts-to-setup-readiness.md`)
   * decides their severity. Client enforces the dependency locally for now.
   *
   * - `hasSources`: at least one ContentSource linked to any Subject of this playbook
   * - `hasAssertions`: at least one ContentAssertion extracted for those sources
   */
  hasSources: boolean;
  hasAssertions: boolean;
}

/** 4xx/5xx error path — separate type so the success contract stays tight. */
export interface SetupStatusErrorResponse {
  ok: false;
  error: string;
}

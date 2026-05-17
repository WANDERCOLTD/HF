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
}

/** 4xx/5xx error path — separate type so the success contract stays tight. */
export interface SetupStatusErrorResponse {
  ok: false;
  error: string;
}

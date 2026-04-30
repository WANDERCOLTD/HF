/**
 * JourneyStop runner — evaluates a list of journey stops against current
 * pipeline state and returns the first stop that should fire (if any).
 *
 * Pure function. No side effects. No DB. Easy to test.
 *
 * Replaces the hardcoded `if (preTestEnabled) ... else if (npsFired) ...`
 * cascade in `app/api/student/journey-position/route.ts` with a
 * data-driven evaluator. Per Track A's hybrid recommendation, this runner
 * owns event-triggered stops (mastery_reached, course_complete, NPS,
 * session_count) for both continuous and structured-mode courses;
 * `applyAutoIncludeStops` continues to handle position-anchored stops in
 * structured mode (before_first / first / last / after_last).
 *
 * @see lib/session-flow/resolver.ts
 * @see app/api/student/journey-position/route.ts
 * @see docs/decisions/2026-04-29-session-flow-canonical-model.md
 * @see GitHub issue #218
 */

import type { JourneyStop, JourneyStopTrigger } from "@/lib/types/json-fields";

/**
 * Pipeline state the runner evaluates against. Shape matches what
 * `journey-position/route.ts` already collects today.
 */
export interface JourneyStopState {
  /** Current session number (1-indexed). 0 = not started. */
  currentSession: number;
  /** Total sessions in the course (only meaningful for structured mode). */
  totalSessions?: number;
  /** Mastery percentage (0–100). */
  masteryPct: number;
  /** Number of calls the learner has completed (call.endedAt set). */
  callCount: number;
  /** Whether onboarding is complete (OnboardingSession.isComplete or wasSkipped). */
  onboardingComplete: boolean;
  /** Stop ids the learner has already completed (submitted_at recorded). */
  completedStopIds: Set<string>;
  /** True when the course is finished (e.g. mastery 100% or final session reached). */
  courseComplete: boolean;
}

/**
 * The runner's verdict — either "fire this stop" or "no stop applies".
 */
export type StopVerdict =
  | { fire: true; stop: JourneyStop }
  | { fire: false };

/**
 * Walk the stops list in order. Return the first one whose trigger
 * is satisfied AND has not already been completed. Disabled stops are
 * skipped.
 */
export function evaluateStops(
  state: JourneyStopState,
  stops: JourneyStop[],
): StopVerdict {
  for (const stop of stops) {
    if (!stop.enabled) continue;
    if (state.completedStopIds.has(stop.id)) continue;
    if (triggerSatisfied(stop.trigger, state)) {
      return { fire: true, stop };
    }
  }
  return { fire: false };
}

/**
 * Check whether a trigger condition is met for the current state.
 * Pure boolean — no side effects.
 */
export function triggerSatisfied(
  trigger: JourneyStopTrigger,
  state: JourneyStopState,
): boolean {
  switch (trigger.type) {
    case "first_session":
      // Fires once before any session has started.
      return state.callCount === 0 && !state.onboardingComplete;

    case "before_session":
      // Fires before the Nth session starts (callCount = N-1, onboarding done).
      return state.onboardingComplete && state.callCount === Math.max(0, trigger.index - 1);

    case "after_session":
      // Fires after the Nth session ends (callCount >= N).
      return state.onboardingComplete && state.callCount >= trigger.index;

    case "midpoint":
      // Fires halfway through a structured course. Continuous courses
      // (no totalSessions) cannot fire midpoint.
      if (!state.totalSessions || state.totalSessions <= 0) return false;
      return state.callCount >= Math.ceil(state.totalSessions / 2);

    case "mastery_reached":
      // Fires when learner reaches the threshold mastery percentage.
      return state.masteryPct >= trigger.threshold;

    case "session_count":
      // Fires after N completed calls.
      return state.callCount >= trigger.count;

    case "course_complete":
      return state.courseComplete;

    default: {
      // Exhaustiveness check — TS fails compile if a new trigger type
      // is added without a matching case. eslint-disable is intentional:
      // the variable is the typecheck assertion, never read at runtime.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _exhaustive: never = trigger;
      return false;
    }
  }
}

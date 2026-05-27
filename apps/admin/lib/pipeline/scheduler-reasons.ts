/**
 * scheduler-reasons.ts — #923.
 *
 * Single source of truth for the `reason` string written into every
 * SchedulerDecision (and from there into `CallerAttribute.jsonValue.reason`,
 * scope `CURRICULUM`, key `scheduler:last_decision`).
 *
 * The reason field is read by learner-facing UI (SimProgressPanel "Today's
 * call" section, #917). Pre-#923, writer sites emitted debugger-style log
 * breadcrumbs ("scheduler: empty working set (0 LOs, 300 TPs) — fallback teach
 * mode") that leaked verbatim to learners. This module enforces a two-rule
 * contract:
 *
 *   1. Every reason reads as a complete sentence addressed to the learner.
 *   2. No reason starts with a lowercase log-prefix (e.g. `scheduler:`,
 *      `adapt:`, `reward:`). Regression-test contract: must not match
 *      `/^[a-z][a-z_-]*:\s/`.
 *
 * Internal diagnostic context (preset name, working-set counts, mode reason)
 * stays in `console.log` at the call sites — developers read those; learners
 * read this.
 *
 * If you add a new code path in scheduler.ts or scheduler-decision callers,
 * add a constant here. Do NOT build reason strings inline.
 */

import type { SchedulerMode } from "./scheduler-decision";

/**
 * Static reason strings — used whenever the code path is unambiguous and
 * doesn't depend on runtime values.
 */
export const SCHEDULER_REASONS = {
  /** Empty working set — fallback to teach mode (scheduler.ts:97). */
  emptyWorkingSetFallback:
    "Picking up where we left off — focusing on new material.",
  /** Picker-locked module path — #538 (modules.ts:967). */
  pickerLockedModule:
    "Working on the module you picked — practising at your own pace.",
} as const;

/**
 * Learner-facing copy for the happy-path scheduler decision (scheduler.ts:160).
 * Keyed by the mode the scheduler chose. Each string is a complete sentence
 * that tells the learner what this call is about without naming presets,
 * counts, or internal cadence state.
 */
export const SCHEDULER_MODE_REASONS: Record<SchedulerMode, string> = {
  teach: "We're moving on to something new today.",
  review: "Reviewing the tricky parts from your last call.",
  assess: "Time for a quick checkpoint to see how you're doing.",
  practice: "You've got the basics — let's practise putting them together.",
};

/**
 * Resolve the learner-facing reason for a given mode. Pure helper so call
 * sites don't reach into the map directly.
 */
export function reasonForMode(mode: SchedulerMode): string {
  return SCHEDULER_MODE_REASONS[mode];
}

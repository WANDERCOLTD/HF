/**
 * Learner-facing label for a scheduler mode.
 *
 * The scheduler internally uses four modes (`teach`, `review`, `assess`,
 * `practice`); the labels below are the educator/learner copy that appears in
 * the SimProgressPanel "Today's call" section (#917 Slice 2).
 *
 * Educator language only — never expose internal mode strings to the learner.
 */

import type { SchedulerMode } from "@/lib/pipeline/scheduler-decision";

const MODE_LABELS: Record<SchedulerMode, string> = {
  teach: "Learning new",
  review: "Reviewing",
  assess: "Mock checkpoint",
  practice: "Practice",
};

export function getSchedulerModeLabel(mode: SchedulerMode): string {
  return MODE_LABELS[mode];
}

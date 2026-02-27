/**
 * Shared constants for plan-related wizard steps.
 * Used by PlanSettingsStep (intents) and LessonPlanStep (inline param editor).
 */

export const DURATIONS = [15, 20, 30, 45, 60] as const;
export const EMPHASIS_OPTIONS = ["breadth", "balanced", "depth"] as const;
export const ASSESSMENT_OPTIONS = ["formal", "light", "none"] as const;

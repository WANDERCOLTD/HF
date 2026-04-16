/** Survey key constants — stored as CallerAttribute scope + key */

export const SURVEY_SCOPES = {
  PRE: "PRE_SURVEY",
  /** @deprecated Mid-survey removed — kept for backward compat reads */
  MID: "MID_SURVEY",
  POST: "POST_SURVEY",
  PERSONALITY: "PERSONALITY",
  PRE_TEST: "PRE_TEST",
  /** @deprecated Mid-test replaced by continuous retrieval practice — kept for backward compat reads */
  MID_TEST: "MID_TEST",
  POST_TEST: "POST_TEST",
} as const;

export const PRE_SURVEY_KEYS = {
  CONFIDENCE: "confidence",
  PRIOR_KNOWLEDGE: "prior_knowledge",
  GOAL_TEXT: "goal_text",
  CONCERN_TEXT: "concern_text",
  MOTIVATION: "motivation",
  SUBMITTED_AT: "submitted_at",
} as const;

/** @deprecated Mid-survey removed — kept for backward compat reads */
export const MID_SURVEY_KEYS = {
  PROGRESS_FEELING: "progress_feeling",
  MID_SATISFACTION: "mid_satisfaction",
  HELP_NEEDED: "help_needed",
  SUBMITTED_AT: "submitted_at",
} as const;

export const POST_SURVEY_KEYS = {
  CONFIDENCE: "confidence",
  CONFIDENCE_LIFT: "confidence_lift",
  SATISFACTION: "satisfaction",
  NPS: "nps",
  FEEDBACK_TEXT: "feedback_text",
  SUBMITTED_AT: "submitted_at",
} as const;

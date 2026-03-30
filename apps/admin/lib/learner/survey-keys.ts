/** Survey key constants — stored as CallerAttribute scope + key */

export const SURVEY_SCOPES = {
  PRE: "PRE_SURVEY",
  POST: "POST_SURVEY",
} as const;

export const PRE_SURVEY_KEYS = {
  CONFIDENCE: "confidence",
  PRIOR_KNOWLEDGE: "prior_knowledge",
  GOAL_TEXT: "goal_text",
  CONCERN_TEXT: "concern_text",
  SUBMITTED_AT: "submitted_at",
} as const;

export const POST_SURVEY_KEYS = {
  CONFIDENCE_LIFT: "confidence_lift",
  SATISFACTION: "satisfaction",
  NPS: "nps",
  FEEDBACK_TEXT: "feedback_text",
  SUBMITTED_AT: "submitted_at",
} as const;

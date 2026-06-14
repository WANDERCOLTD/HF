/**
 * normalize-score-agent-evidence.ts (#1608)
 *
 * Pure helper extracted from the SCORE_AGENT `BehaviorMeasurement` write loop
 * in `app/api/calls/[callId]/pipeline/route.ts`. Normalises whatever shape the
 * LLM returned in the `e` (evidence) field into a clean `string[]`.
 *
 * Pre-#1608 the prompt didn't request `e` at all, so the parser always fell
 * through to `["AI analysis"]` — a useless placeholder that masqueraded as
 * data in the Attainment tab's per-skill evidence trail (4,259 rows DB-wide).
 *
 * Post-#1608 the prompt requests `e` as a verbatim-quote array. This helper
 * is the canonical normaliser. Keep it deterministic + branchy enough to
 * survive every LLM response shape we've seen in production.
 */

/** Accept either the compact `e` field or the full `evidence` field. */
export interface RawScoreShape {
  e?: unknown;
  evidence?: unknown;
}

/**
 * Normalise the score-agent `e` / `evidence` field to a clean `string[]`.
 *
 * Rules:
 *   - Missing or non-string non-array → `[]`. (Pre-#1608 this returned the
 *     `["AI analysis"]` placeholder. Empty array is the right semantics —
 *     the Attainment tab's `SkillEvidencePanel` renders "No evidence
 *     captured" for `[]`, which is *honest* when the model failed to
 *     produce quotes.)
 *   - Array of strings → filter to non-empty strings only.
 *   - Bare non-empty string → wrap in single-element array.
 */
export function normalizeScoreAgentEvidence(scoreData: RawScoreShape): string[] {
  const raw = scoreData.evidence ?? scoreData.e;
  if (Array.isArray(raw)) {
    return raw.filter((q): q is string => typeof q === "string" && q.length > 0);
  }
  if (typeof raw === "string" && raw.length > 0) {
    return [raw];
  }
  return [];
}

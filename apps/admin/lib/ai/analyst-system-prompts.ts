/**
 * Analyst-stage LLM system prompts (#1404 B2).
 *
 * Centralises the SYSTEM-role messages we hand to the LLM when it acts
 * as an analyst inside the pipeline (EXTRACT, SCORE_AGENT, ADAPT) or
 * inside goal-extraction. These are NOT learner-facing utterances —
 * they tell the LLM which expert role to inhabit for an internal
 * structured-output task. They were previously inlined as string
 * literals at five call sites:
 *
 *   - `app/api/calls/[callId]/pipeline/route.ts:1129` (extract / measure)
 *   - `app/api/calls/[callId]/pipeline/route.ts:1569` (score_agent)
 *   - `app/api/calls/[callId]/pipeline/route.ts:2577` (adapt)
 *   - `lib/goals/extract-goals.ts:141`                (extract_goals)
 *   - `lib/goals/extract-goals.ts:477`                (extract_completion_signals)
 *
 * Two of those five were duplicated word-for-word in different code
 * paths, so the consolidation removes ~50% drift risk on its own.
 *
 * **Why constants and not an AnalysisSpec field?** Per the broader prompt
 * audit (#1404 / #TBD B1), the spec-driven promotion is appropriate
 * WHEN an educator asks to tune these. Today they're architectural
 * defaults — pre-positioning behind a named const lets us swap the
 * source to `spec.config.systemPrompt` later without touching the call
 * sites. The const module is the "deferred promotion" pattern.
 *
 * **Why this is NOT a Configuration over Code violation:** the principle's
 * intent is *learner-facing behaviour that an educator might reasonably
 * want to tune* (greeting style, persona warmth, course-context references).
 * Analyst stages are LLM-as-a-tool — the educator tunes the OUTPUT of
 * these stages via BehaviorTarget / EXTRACT spec config / AnalysisSpec
 * weighting, not by rewriting the analyst's "you are an expert at X"
 * preamble.
 *
 * Pure constants. No DB. No imports. Deterministic.
 */

/** EXTRACT (measure) stage — system prompt for the LLM behavioural-analysis
 *  pass that drives the `pipeline.measure` callPoint. Outputs JSON that
 *  feeds MeasureParam scoring + LearnActions extraction. */
export const PIPELINE_MEASURE_SYSTEM_PROMPT =
  "You are an expert behavioral analyst. Always respond with valid JSON.";

/** SCORE_AGENT stage — system prompt for the LLM evaluation pass that
 *  drives the `pipeline.score_agent` callPoint. Outputs JSON with
 *  parameter-level scores + brief evidence quotes. The "Keep evidence
 *  arrays brief" instruction is load-bearing — without it the LLM
 *  inflates evidence to multi-paragraph blocks and blows the maxTokens
 *  budget for any non-trivial parameter count. */
export const PIPELINE_SCORE_AGENT_SYSTEM_PROMPT =
  "You are an expert at evaluating conversational AI behavior. " +
  "Always respond with valid JSON. " +
  "Keep evidence arrays brief (1-2 short quotes max per parameter).";

/** ADAPT stage — system prompt for the LLM personalisation pass that
 *  drives the `pipeline.adapt` callPoint. Outputs JSON adjustments to
 *  the next prompt's BehaviorTarget set. */
export const PIPELINE_ADAPT_SYSTEM_PROMPT =
  "You are an expert at personalizing AI behaviour based on caller profiles. " +
  "Always respond with valid JSON.";

/** Goal extraction — system prompt for the `pipeline.extract_goals`
 *  callPoint inside `lib/goals/extract-goals.ts`. Outputs JSON list of
 *  Goal candidates with confidence + evidence pointers. */
export const GOALS_EXTRACT_SYSTEM_PROMPT =
  "You are an expert at understanding learner intentions. " +
  "Extract goals from conversations. Return valid JSON only.";

/** Goal-completion signals — system prompt for the
 *  `pipeline.extract_completion_signals` callPoint inside
 *  `lib/goals/extract-goals.ts`. Outputs JSON list of (goalId, claim,
 *  confidence) triples when the learner asserts having reached an
 *  assessment goal. */
export const GOALS_EXTRACT_COMPLETION_SIGNALS_SYSTEM_PROMPT =
  "You detect when learners claim to have achieved assessment goals. " +
  "Return valid JSON only.";

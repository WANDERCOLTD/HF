/**
 * Feature flag for epic #1700 — G8 module-scoped settings reads.
 *
 * **Default OFF.** Per epic decision 5, all G8 reads in compose
 * transforms + EXTRACT logic + endSession sit behind this flag during
 * the migration window. Operator opts in via
 * `HF_FLAG_IELTS_MODULE_SETTINGS=true` once Phase 1 + the consuming
 * transforms (epic #1730) are confirmed on hf-dev.
 *
 * Sibling pattern to `lib/voice/session-flag.ts::isSessionModelV2Enabled`.
 *
 * Read once per call — not cached so vitests can flip between tests.
 */

export const IELTS_MODULE_SETTINGS_ENV_VAR = "HF_FLAG_IELTS_MODULE_SETTINGS";

/**
 * Return true ONLY when `HF_FLAG_IELTS_MODULE_SETTINGS` is the literal
 * string `"true"`. Any other value (undefined, empty, "false", "1")
 * returns false — the migration-window default-off posture is
 * intentional. Flip to `true` in env once consumers are live.
 */
export function isIeltsModuleSettingsEnabled(): boolean {
  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const raw = env?.[IELTS_MODULE_SETTINGS_ENV_VAR];
  return raw === "true";
}

/**
 * Feature flag for epic #2135 — IELTS-MEASURE-001 LLM transcript scoring.
 *
 * **Default OFF.** When enabled (`HF_IELTS_LLM_MEASURE_V1=true`), the
 * `IELTS-MEASURE-001` AnalysisSpec runs via the EXTRACT / SCORE_AGENT
 * stage and writes `CallScore` rows for the 4 IELTS skill parameter IDs
 * (`skill_fluency_and_coherence_fc`, `skill_pronunciation_p`,
 * `skill_lexical_resource_lr`, `skill_grammatical_range_and_accuracy_gra`).
 *
 * **Post-#2138 (S3) flag scope:**
 *
 * The flag now controls ONLY the LLM-judged path's enablement. It no
 * longer gates the prosody-consumer at all — #2138 refactored the
 * prosody IELTS-mode writer to target separate `prosody_raw_*`
 * parameter IDs (`prosody_raw_fc` / `_p` / `_lr` / `_gra`). The two
 * writers now target disjoint parameterId namespaces, so no dual-writer
 * race is possible regardless of flag state. Prosody-raw rows always
 * land when the vendor envelope is present.
 *
 * Lifecycle:
 *   - Flag OFF (today's default) → no LLM-judged IELTS skill scores.
 *     Prosody-raw rows still land (audio-feature signal preserved).
 *     Note: the 4 IELTS skill IDs receive ZERO CallScore rows in this
 *     state — that is the gap epic #2135 exists to close. Flip ON.
 *   - Flag ON → LLM-judged IELTS skill scores land via SCORE_AGENT.
 *     Prosody-raw rows continue to land independently. Tool-use
 *     augmentation (LLM consuming prosody-raw to boost FC + P
 *     confidence) is a post-MVP enhancement, not gated by this flag.
 *   - Post-S6 verification → consider promoting to always-on and
 *     retiring the flag in a follow-on chore.
 *
 * **OPERATOR RULE (verbatim, from epic #2135):**
 * NEVER land hardcoded or AI-guessed score defaults to "fill" empty
 * CallerTarget rows. Honest empty bands surface gaps; fake scores
 * corrupt EMA.
 *
 * Sibling pattern to `isIeltsModuleSettingsEnabled` above. Read once
 * per call — not cached so vitests can flip between tests.
 */
export const IELTS_LLM_MEASURE_ENV_VAR = "HF_IELTS_LLM_MEASURE_V1";

/**
 * Return true ONLY when `HF_IELTS_LLM_MEASURE_V1` is the literal string
 * `"true"`. Any other value returns false — default-off until S6
 * verification confirms the LLM path produces correct bands.
 */
export function ieltsLlmMeasureV1Enabled(): boolean {
  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const raw = env?.[IELTS_LLM_MEASURE_ENV_VAR];
  return raw === "true";
}

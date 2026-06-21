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
 * `IELTS-MEASURE-001` AnalysisSpec runs via the EXTRACT stage and writes
 * `CallScore` rows for the 4 IELTS skill parameters. The legacy
 * prosody-consumer's `writeIeltsCallScores` then skips IELTS-skill writes
 * (LLM spec owns those rows).
 *
 * When disabled, the legacy path is unchanged — prosody-consumer
 * continues to be the sole writer for the 4 IELTS skill params (which
 * means callers without prosody-vendor signal continue to get NO IELTS
 * skill scores at all, the very gap epic #2135 closes).
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

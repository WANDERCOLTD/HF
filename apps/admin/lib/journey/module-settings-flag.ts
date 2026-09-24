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
 * Story #2158 (epic #2135 follow-on, 2026-06-21) — the
 * `HF_IELTS_LLM_MEASURE_V1` env flag and `ieltsLlmMeasureV1Enabled()`
 * helper were RETIRED here.
 *
 * The IELTS LLM-judged MEASURE path is now selected at the COURSE LEVEL
 * via two layered mechanisms:
 *
 *   1. **Auto-detect** (default ON, runs whenever the playbook has IELTS
 *      BehaviorTarget intent):
 *      `lib/pipeline/specs-loader.ts::filterByBehaviorTargetParams` (#2155)
 *      runs IELTS-MEASURE-001 whenever the playbook carries any of the 4
 *      IELTS skill parameters on its PLAYBOOK-scope `BehaviorTarget` rows.
 *      The operator's BehaviorTarget intent IS the signal — no separate
 *      enablement flag is required.
 *
 *   2. **Per-course override** (kill-switch):
 *      `PlaybookConfig.aiMeasurement.disableLlmIeltsScoring = true`
 *      filters IELTS-MEASURE-001 OUT for that specific course even when
 *      auto-detect would otherwise run it. Surfaced in the Course Skills
 *      tab → Rubric Calibration lens → "AI Measurement Method" card and
 *      protected by the `JourneySettingContract`
 *      `aiMeasurementDisableLlmIeltsScoring` (G4 / I_scoring bucket).
 *
 * Prosody-consumer's IELTS-skill writes are namespace-disjoint from the
 * LLM spec (PR #2157 / story #2138 — `prosody_raw_*` parameter IDs) so
 * no env-flag check is required on the prosody side either.
 *
 * **OPERATOR RULE (verbatim, from epic #2135):**
 * NEVER land hardcoded or AI-guessed score defaults to "fill" empty
 * `CallerTarget` rows. Honest empty bands surface gaps; fake scores
 * corrupt EMA.
 */

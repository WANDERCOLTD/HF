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

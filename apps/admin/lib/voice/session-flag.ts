/**
 * Feature flag for epic #1338 — Session model V2 builders.
 *
 * Default flipped to `true` in #1344 Slice 4 (single-counter cutover):
 * `createSession` / `endSession` are now the canonical Session-write
 * path. Operator can disable temporarily via `HF_FLAG_SESSION_MODEL_V2=false`
 * if a regression surfaces — Slice 5 removes the flag entirely.
 *
 * Read once per call via `isSessionModelV2Enabled()`. The function is
 * not cached deliberately: vitests need to flip the env var between
 * tests and observe both paths.
 *
 * @see github.com/.../issues/1338 (epic), /.../issues/1342 (Slice 3),
 *      /.../issues/1344 (Slice 4 — default flipped to true)
 */

export const SESSION_MODEL_V2_ENV_VAR = "HF_FLAG_SESSION_MODEL_V2";

/**
 * Return true unless `HF_FLAG_SESSION_MODEL_V2` is the literal string
 * "false". Any other value (undefined, empty, "true", "1") returns true
 * — the Session model V2 builders are the default path from #1344
 * Slice 4 onward.
 */
export function isSessionModelV2Enabled(): boolean {
  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const raw = env?.[SESSION_MODEL_V2_ENV_VAR];
  return raw !== "false";
}

/**
 * Feature flag for epic #1338 Slice 3 — Session model V2 builders.
 *
 * When `HF_FLAG_SESSION_MODEL_V2 === "true"` every Session-creating route
 * routes through `createSession` / `endSession` (this slice's builders)
 * and writes the canonical `Session` parent row alongside the legacy
 * `Call` child. When false (default), the routes preserve their existing
 * shape — useful while the migration soaks on hf_sandbox.
 *
 * Threaded through every cut-over site so the false-path is the literal
 * pre-existing code (not a builder no-op). The flag intentionally has no
 * fallback on `NEXT_PUBLIC_APP_ENV` — operator opts in explicitly.
 *
 * Read once per call via `isSessionModelV2Enabled()`. The function is
 * not cached deliberately: vitests need to flip the env var between
 * tests and observe both paths.
 *
 * @see github.com/.../issues/1338 (epic), /.../issues/1342 (this slice)
 */

export const SESSION_MODEL_V2_ENV_VAR = "HF_FLAG_SESSION_MODEL_V2";

/**
 * Return true iff `HF_FLAG_SESSION_MODEL_V2` is the literal string "true".
 * Any other value (undefined, empty, "false", "1") returns false.
 */
export function isSessionModelV2Enabled(): boolean {
  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const raw = env?.[SESSION_MODEL_V2_ENV_VAR];
  return raw === "true";
}

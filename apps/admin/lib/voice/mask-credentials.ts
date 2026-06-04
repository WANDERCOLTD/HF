/**
 * Credential masking helper (AnyVoice #1031).
 *
 * Replaces sensitive credential values in any object with a fixed mask
 * before the object is returned from an API response or rendered in a
 * UI. The masking convention is full redaction (`***`), NOT
 * last-four-reveal — preventing partial credential leaks via response
 * inspection.
 *
 * **Suffix match (case-insensitive):** any key whose name ends in
 * `key`, `secret`, `token`, or `password` is masked. Other keys pass
 * through unchanged (provider-specific config values like `baseUrl`,
 * `model`, `voiceId` are not sensitive).
 *
 * **Never log raw credentials.** This helper exists to enforce that
 * rule at every read site that crosses an API boundary. If you find
 * yourself bypassing it ("just for this one log line"), stop — the
 * leak is one rotation cycle away from a real incident.
 */

const MASK = "***";
const NOT_SET = "[not set]";

/** Case-insensitive suffix patterns that mark a credential field. */
const SENSITIVE_SUFFIXES = ["key", "secret", "token", "password"] as const;

/** True when the field name ends in a sensitive suffix (case-insensitive). */
function isSensitiveFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_SUFFIXES.some((s) => lower.endsWith(s));
}

/**
 * Return a new object with sensitive fields masked. Non-sensitive
 * fields pass through unchanged. Nullish / empty values for sensitive
 * fields render as `[not set]` so the UI can distinguish "redacted"
 * from "unconfigured" without exposing the value.
 *
 * The input is not mutated. Nested objects are NOT recursed into —
 * credentials are flat key/value pairs by convention. If a provider
 * ever stores nested credentials, extend with a recursion arm + tests.
 */
export function maskCredentials(
  credentials: Record<string, unknown>,
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (isSensitiveFieldName(key)) {
      if (value === null || value === undefined || value === "") {
        masked[key] = NOT_SET;
      } else {
        masked[key] = MASK;
      }
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

/** Re-export for tests that want to assert the contract. */
export const MASK_TOKEN = MASK;
export const NOT_SET_TOKEN = NOT_SET;

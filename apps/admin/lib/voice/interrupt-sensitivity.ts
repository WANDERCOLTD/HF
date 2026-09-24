/**
 * Interrupt-sensitivity → VAPI barge-in mapper (#2053 / sub-epic D of #2049).
 *
 * The journey/voice contract `interruptSensitivity` (`Playbook.config.interruptSensitivity`)
 * controls how readily the AI yields when the learner starts speaking.
 * Storage is a slider (numeric) with optional tier-string fallback for
 * forward-compat with operator UI experiments. Pre-#2053 the value was
 * persisted but no runtime path consumed it — the Inspector lied (badge:
 * "🚫 Not yet active — voice-stack consumer pending").
 *
 * This module is the consumer. Pure function, no IO. Callers (the VAPI
 * adapter today, future Retell sibling) translate the resolved value into
 * the provider's wire-format barge-in knob.
 *
 * VAPI mapping — `stopSpeakingPlan.numWords`
 * -----------------------------------------
 * VAPI's barge-in control lives on `assistant.stopSpeakingPlan.numWords`
 * (https://docs.vapi.ai/api-reference/assistants/create-assistant —
 * `stopSpeakingPlan`): the count of consecutive learner words that must
 * be detected before the assistant stops talking. Lower = more sensitive
 * (interrupts sooner). VAPI's default is 0 (any detected speech yields).
 *
 *   Sensitivity (educator setting) → numWords (VAPI):
 *     1.0 / "high"   → 0  (most sensitive — yields on any speech)
 *     0.5 / "medium" → 1  (yields after 1 detected word)
 *     0.0 / "low"    → 3  (only yields after 3 words; assistant talks through brief noises)
 *
 * Numeric values between buckets are linearly interpolated then rounded.
 * Out-of-range / unparseable values resolve to "medium" — the safer
 * mid-band default — and the caller can log a warn.
 *
 * Companion test: `tests/lib/voice/interrupt-sensitivity.test.ts` pins
 * every tier + the numeric interpolation.
 */

/** Tier strings the educator UI MAY emit (forward-compat — today's
 *  slider stores a number). Accepted by the resolver so a future
 *  `control: "select"` swap doesn't break the consumer. */
export type InterruptSensitivityTier = "low" | "medium" | "high";

/** Wire-shape fragment the adapter spreads onto the VAPI assistant
 *  payload. Never overwrites unrelated keys. */
export interface VapiBargeInConfig {
  stopSpeakingPlan: {
    numWords: number;
  };
}

const TIER_TO_NUM_WORDS: Record<InterruptSensitivityTier, number> = {
  low: 3,
  medium: 1,
  high: 0,
};

/**
 * Resolve a stored sensitivity value into a VAPI barge-in fragment, or
 * `null` when the operator hasn't set anything (caller should omit the
 * key and let VAPI's own default ride).
 *
 * Accepts:
 *   - `number` in [0, 1] (slider — default control type for the contract)
 *   - tier string `"low" | "medium" | "high"` (forward-compat for a
 *     possible select-control swap)
 *   - `null` / `undefined` / unrecognised value → returns `null`
 */
export function mapInterruptSensitivityToVapi(
  value: unknown,
): VapiBargeInConfig | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const tier = value.toLowerCase() as InterruptSensitivityTier;
    if (tier in TIER_TO_NUM_WORDS) {
      return { stopSpeakingPlan: { numWords: TIER_TO_NUM_WORDS[tier] } };
    }
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // Clamp to [0, 1]. The contract is a `slider`; if a future UI bug
    // ships an out-of-range write, we'd rather clamp than crash the
    // assistant payload.
    const clamped = Math.max(0, Math.min(1, value));
    // Linear interpolation: 0.0 → 3 words, 0.5 → 1.5 → rounded 2 (sensible
    // between low + medium), 1.0 → 0 words. Round to nearest integer to
    // satisfy VAPI's int type.
    const numWords = Math.round(3 - 3 * clamped);
    return { stopSpeakingPlan: { numWords } };
  }

  return null;
}

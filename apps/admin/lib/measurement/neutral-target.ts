/**
 * Neutral parameter target — the canonical midpoint on the 0..1 behavior axis.
 *
 * Every behavior parameter (BEH-WARMTH, BEH-RESPONSE-LEN, BEH-PAUSE-TOLERANCE,
 * etc.) is scored on a 0..1 scale where 0.5 is "no override" — neither push
 * toward the LOW pole nor the HIGH pole. When a transform reads `targetValue`
 * and no measured value or configured default is available, it falls back to
 * this midpoint.
 *
 * `NEUTRAL_TARGET_TOLERANCE` is the half-width used to treat a value as
 * "effectively neutral" (e.g. identity-spec sliders skip rendering a
 * `Department tone:` directive when the slider sits within ±0.05 of 0.5).
 *
 * **Why a const, not the literal:**
 *  - 6 sites in `transforms/quickstart.ts` and 2 in `transforms/identity.ts`
 *    used the bare literal `0.5`. If the neutral midpoint ever needs to
 *    shift (or a per-param defaultTarget injection lands), the bare literals
 *    are silent footguns.
 *  - The `pipeline-and-prompt.md` rule treats hardcoded behavior values in
 *    composition transforms as a contract-leak — they're tutor-behavior
 *    knobs that must be sourced.
 *
 * **Per-parameter defaults:** when the calling site has access to the
 * `Parameter` table row, prefer `parameter.defaultTarget` over this midpoint.
 * This constant is the fallback when no parameter row is in scope.
 */
export const NEUTRAL_PARAMETER_TARGET = 0.5;

/**
 * Tolerance half-width around `NEUTRAL_PARAMETER_TARGET` for "effectively
 * neutral" classification. `|value - 0.5| < 0.05` means the slider has not
 * been moved meaningfully off the midpoint.
 */
export const NEUTRAL_TARGET_TOLERANCE = 0.05;

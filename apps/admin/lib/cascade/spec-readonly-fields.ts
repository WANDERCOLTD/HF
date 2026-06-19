/**
 * Spec-readonly fields — declarative boundary between HF-canonical
 * parameter semantics and customer-tunable parameter VALUES.
 *
 * @canonical-doc .claude/rules/spec-readonly-boundary.md
 *
 * Background
 *
 * The HF parameter registry carries TWO kinds of fields on every
 * `Parameter` row:
 *
 * 1. **Spec fields** — the semantics: what the parameter MEANS.
 *    `definition`, `interpretationHigh`, `interpretationLow`.
 *    These are HF-canonical IP. Customer educators must NOT overwrite
 *    them, because the composed prompt's `behavior_targets_semantics`
 *    block emits these texts directly to the LLM. A customer tweaking
 *    `interpretationHigh` corrupts the AI's behaviour for every other
 *    customer reading the same parameter.
 *
 * 2. **Value fields** — the tuning surface: WHAT VALUE to use.
 *    `BehaviorTarget.targetValue` (per scope). The cascade
 *    (System → Domain → Course → Segment → Caller) resolves these
 *    layer-by-layer. Customer-tunable by design.
 *
 * This constant declares the SPEC fields so the sibling Lattice
 * Protection epic's ESLint rule
 * (`hf-spec/no-customer-write-to-canonical-interpretation`) can pin the
 * boundary at edit time. No runtime consumer in S4 — this is purely a
 * declaration that the future guard reads.
 *
 * If you add a new HF-canonical field to `Parameter` (e.g.
 * `measurementVoiceOnly` is also HF-canonical), add it here too.
 *
 * @see .claude/rules/spec-readonly-boundary.md — discipline file.
 * @see docs/PARAMETER-TAXONOMY.md — the broader IP-quality framing.
 */
export const PARAMETER_SPEC_READONLY_FIELDS = [
  "definition",
  "interpretationHigh",
  "interpretationLow",
] as const;

export type ParameterSpecReadonlyField =
  (typeof PARAMETER_SPEC_READONLY_FIELDS)[number];

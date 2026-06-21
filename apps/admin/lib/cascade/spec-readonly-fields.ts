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
 * 1. **Spec fields** — the semantics: what the parameter MEANS and
 *    HOW the LLM should grade it. The original three:
 *    `definition`, `interpretationHigh`, `interpretationLow` —
 *    these are emitted verbatim into the composed prompt's
 *    `behavior_targets_semantics` block (#1951 S4). A customer
 *    tweaking `interpretationHigh` corrupts the AI's behaviour for
 *    every other customer reading the same parameter.
 *
 *    Defensively extended 2026-06-21 by #2174 S5 to include the four
 *    grading-rubric fields catalogued by the #2174 epic audit:
 *    `tiers`, `tierScheme`, `defaultTarget`, `config`. These describe
 *    the rubric the LLM grades against (per-band descriptor text,
 *    band scheme, HF-canonical default target). The asymmetry with
 *    `interpretationHigh`/`interpretationLow` worth flagging: those
 *    three are cross-Parameter-poison risks (one customer's edit
 *    bleeds into every tenant's prompt). `tiers` / `tierScheme` /
 *    `defaultTarget` / `config` are per-Parameter — so the poison
 *    radius is narrower — but they are still the LLM grading rubric
 *    that HF curates. Same trust class. Customer tuning happens via
 *    the sibling `BehaviorTarget.targetValue` cascade, NOT by
 *    mutating the Parameter row's rubric definition.
 *
 * 2. **Value fields** — the tuning surface: WHAT VALUE to use.
 *    `BehaviorTarget.targetValue` (per scope). The cascade
 *    (System → Domain → Course → Segment → Caller) resolves these
 *    layer-by-layer. Customer-tunable by design.
 *
 * This constant declares the SPEC fields so the sibling Lattice
 * Protection epic's ESLint rule
 * (`hf-spec/no-customer-write-to-canonical-interpretation`) can pin the
 * boundary at edit time. The rule auto-covers any field added here.
 *
 * Note on `config` vs `config.<subkey>`: the ESLint rule blocks
 * top-level object-literal keys in the `data: {}` payload. Adding
 * `"config"` to this list blocks any write of `data: { config: ... }`
 * from a customer-driven path. Future #2174 follow-ons MAY classify
 * specific `config` subfields (e.g. `config.bandThresholds`) as
 * TUNABLE — at which point a sibling helper that writes only those
 * subfields would need to be added to the rule's allow-list, or the
 * subfield surface would need its own validate-then-merge chokepoint.
 *
 * If you add a new HF-canonical field to `Parameter` (e.g.
 * `measurementVoiceOnly` is also HF-canonical), add it here too.
 *
 * @see .claude/rules/spec-readonly-boundary.md — discipline file.
 * @see docs/PARAMETER-TAXONOMY.md — the broader IP-quality framing.
 * @see docs/SCORING-EDITABILITY.md — the #2174 audit that classified
 *      these four fields as HF-CANONICAL (PR #2179, in flight).
 */
export const PARAMETER_SPEC_READONLY_FIELDS = [
  "definition",
  "interpretationHigh",
  "interpretationLow",
  // #2174 S5 — defensive extension. Grading-rubric fields classified
  // HF-canonical by the #2174 epic audit (docs/SCORING-EDITABILITY.md).
  "tiers",
  "tierScheme",
  "defaultTarget",
  "config",
] as const;

export type ParameterSpecReadonlyField =
  (typeof PARAMETER_SPEC_READONLY_FIELDS)[number];

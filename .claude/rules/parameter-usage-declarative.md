# Parameter `usage` — declarative Lattice Coverage

> Every parameter in
> `apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`
> MUST carry a `usage` block declaring (a) how its interpretation
> reaches the LLM (`compose`) and (b) how it is measured
> (`measurement`). The block is the data-driven structural answer
> to "100% of parameters USED" — the orphan problem is no longer
> implicit silence; it is explicit metadata.
>
> Sibling to [`parameter-coverage.md`](./parameter-coverage.md) (the
> fuzzy substring ratchet, complementary). Both pin the same
> coverage pillar — this one from the registry side, that one from
> the source-code side.
>
> Catalogued in [`docs/kb/guard-registry.md`](../../docs/kb/guard-registry.md)
> as part of the Coverage pillar of HF Lattice.

## Rule

When you add or modify a parameter row in
`behavior-parameters.registry.json`:

1. **Active parameter** (no `deprecatedAt`): set
   ```json
   "usage": {
     "compose": "semantics-block" | "prompt-injection" | "transform-direct",
     "measurement": { "specSlug": "<slug>" } | "deferred-#1967"
   }
   ```
2. **Deprecated parameter** (has `deprecatedAt`): set
   ```json
   "usage": {
     "compose": "deprecated",
     "measurement": "deprecated"
   }
   ```

The structural invariants are pinned by
[`tests/lib/registry/parameter-usage-coverage.test.ts`](../../apps/admin/tests/lib/registry/parameter-usage-coverage.test.ts).

## `usage.compose` values

| Value | When to use |
|---|---|
| `semantics-block` | Default for active params. The `## Behavior Targets Semantics` block in `renderPromptSummary.ts` (#1951) emits this param's `interpretationHigh`/`interpretationLow` to the LLM on every call. |
| `prompt-injection` | The param has a `promptInjection` block in the registry; the `parametersAsDirectives.ts` dispatcher (#1907) renders a directive into the prompt. Use when the param needs special prompt placement beyond the SEMANTICS list. |
| `transform-direct` | A compose transform mentions the param by ID (or alias) directly. Use when the param drives a custom transform block (e.g. specific phrasing logic). |
| `deprecated` | The param has `deprecatedAt`; no prompt route. |

## `usage.measurement` values

| Value | When to use |
|---|---|
| `{ specSlug: "<analysis-spec-slug>" }` | An AnalysisSpec measures this param from the call transcript. The pipeline reads the spec, scores it, writes a `CallScore` keyed on this `parameterId`. **Target for every active param.** |
| `"deferred-#1967"` | The param is producer-only — operator can tune the cascade but nothing scores it. Tracked by epic #1967 (Pipeline Measurement Coverage). The ratchet in the test file caps the count. |
| `"deprecated"` | The param has `deprecatedAt`; not measured. |

## Ratchet

Today's incumbent (2026-06-18): **139 active params with
`measurement: "deferred-#1967"`** — the entire active population.
Epic #1967 backfills real `specSlug` values; this number shrinks
monotonically. The test
(`EXPECTED_DEFERRED_MEASUREMENT_COUNT`) ratchets it down.

If you land a new active param without a real `specSlug`, you join
the deferred list AND must consciously bump
`EXPECTED_DEFERRED_MEASUREMENT_COUNT` (or — better — define the
AnalysisSpec in the same PR).

## Why two coverage tests, not one

The substring-based
[`parameter-coverage.test.ts`](../../apps/admin/tests/lib/measurement/parameter-coverage.test.ts)
(#1849) checks whether the source code references the param by
name. The declarative
[`parameter-usage-coverage.test.ts`](../../apps/admin/tests/lib/registry/parameter-usage-coverage.test.ts)
(this rule) checks whether the registry explicitly declares the
intent. Both must hold:

- A param mentioned in source but declared `"deferred-#1967"` is a
  registry stale — fix the declaration.
- A param declared with `{specSlug: "..."}` but the spec doesn't
  exist will fail an integration test (when #1967 wires the
  specSlug→spec check).

The two layers together close the "is this used?" question from
both sides.

## When NOT to apply

This rule applies to **every parameter** in the canonical registry.
There is no exemption path — the `usage` block is mandatory. If a
parameter is genuinely not used anywhere, the right state is
`deprecatedAt` + `usage: { compose: "deprecated", measurement: "deprecated" }`.

## Related

- [`tests/lib/registry/parameter-usage-coverage.test.ts`](../../apps/admin/tests/lib/registry/parameter-usage-coverage.test.ts) — the test
- [`apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`](../../apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json) — the canonical seed
- [`.claude/rules/parameter-coverage.md`](./parameter-coverage.md) — sibling substring-based ratchet
- Epic [#1946](https://github.com/WANDERCOLTD/HF/issues/1946) — canonical parameter spec curation
- Epic [#1967](https://github.com/WANDERCOLTD/HF/issues/1967) — pipeline measurement coverage

# Parameter measurement coverage — link 7 of the Lattice chain

> Every active parameter MUST declare which AnalysisSpec measures it
> via `usage.measurement: { specSlug: "..." }` (single) OR
> `{ specSlugs: [...] }` (multi). The cross-check verifies the spec
> actually exists and references the parameter by canonical id or
> alias. Producer-only debt is explicit:
> `measurement: "deferred-#1967"`.
>
> Sibling to [`parameter-usage-declarative.md`](./parameter-usage-declarative.md)
> (schema invariant) — this rule pins the **substantive** cross-check:
> are the declarations REAL? Both rules together close link 7 of the
> Lattice's adaptive loop (call behaviour → measurement).
>
> Story: [#1967](https://github.com/WANDERCOLTD/HF/issues/1967) M1.
> Part of the Coverage pillar of HF Lattice.

## Rule

When you add or modify a parameter row in
`behavior-parameters.registry.json`:

1. **Choose one of**:
   - `usage.measurement: { specSlug: "<existing-spec-slug>" }` — the
     AnalysisSpec named by the slug exists under
     `docs-archive/bdd-specs/<slug>.spec.json` AND its `parameters`
     array contains either the canonical id OR one of the param's
     aliases.
   - `usage.measurement: { specSlugs: [...] }` — same, but multiple
     specs measure this param.
   - `usage.measurement: { kind: "operator-only", reason: "..." }` —
     explicit non-measurable tutor knob (M4, 2026-06-18). The reason
     must be >20 chars and explain why the param isn't learner-
     derivable from transcript (typical case: tutor-emit behaviour
     directive that the LLM expresses but no learner-side signal
     reflects). Excluded from the gap ratchet.
   - `usage.measurement: "deferred-#1967"` — explicit producer-only
     debt. Acceptable but counts against the gap ratchet.
   - `usage.measurement: "deprecated"` — only valid when
     `deprecatedAt` is also set.

2. The structural enforcement lives in
   [`tests/lib/measurement/parameter-measurement-coverage.test.ts`](../../apps/admin/tests/lib/measurement/parameter-measurement-coverage.test.ts).

## Cross-check semantics

The test loads every `*.spec.json` under `docs-archive/bdd-specs/`
at runtime and walks the spec's `parameters` array. For each
parameter row in the registry, the citation is verified:

```
candidates = { parameterId } ∪ aliases
for each cited specSlug:
  if spec exists AND spec.parameters[*].id ∈ candidates:
    → measured (verified)
```

A citation that fails the cross-check is classified `stale` and
fails the test — the operator must either author the missing spec
or update the citation.

## Classifications

| Classification | Meaning | Counts toward gap ratchet? |
|---|---|---|
| `measured` | At least one cited specSlug cross-checks | No |
| `operator-only` | Declared `{ kind: "operator-only", reason }` with substantive reason | No (excluded) |
| `deferred` | Declared `"deferred-#1967"` | **Yes — the ratchet** |
| `deprecated` | Has `deprecatedAt` + measurement "deprecated" | No (excluded) |
| `stale` | Citation present but cross-check fails | **Fails the test** |
| `gap-no-usage` | Missing or malformed `usage.measurement` | **Fails the test** |

## Ratchet

`EXPECTED_GAP_COUNT` caps the `deferred` count. 2026-06-18 incumbent
post-M4: **48 active parameters** still declare `"deferred-#1967"`
(M4 reclassified 9 of the original 57 — 3 measured via STYLE-001
alias-citation, 6 operator-only). Pedagogy review per
[`docs/M4-pedagogy-review.md`](../../docs/M4-pedagogy-review.md)
drives the remaining 48 monotonically toward 0.

## When you DON'T need an AnalysisSpec

Some parameters are operator-only knobs that don't need scoring:

- Default-targets settings (`BEH-DEFAULT-TARGETS-QUALITY` etc.) are
  set by the wizard; they aren't transcript-derivable.
- Pure config knobs that drive prompt construction without ever
  needing a learner-state signal back.
- Tutor-emit behaviour directives (`BEH-WARMTH`'s sibling knobs
  like `BEH-PAUSE-TOLERANCE`, `BEH-RESPONSE-LEN`, `BEH-TURN-LENGTH`)
  — the LLM expresses them but no learner-side signal reflects them
  back as a measurable score. SUPERVISE-stage compliance checks are
  a separate concern (see #1967 epic notes).

For these, declare `usage.measurement: { kind: "operator-only",
reason: "..." }` with a substantive (>20 char) reason. Excluded
from the gap ratchet.

## When adding a new parameter

Author checklist (same PR):

1. Define the parameter in
   `docs-archive/bdd-specs/behavior-parameters.registry.json` with
   `usage: { compose, measurement }`.
2. If the parameter is transcript-derivable: author the AnalysisSpec
   in the same PR; cite it as `{ specSlug }`.
3. If the parameter is operator-only or not yet specified: declare
   `"deferred-#1967"` and bump `EXPECTED_GAP_COUNT` in the test.
4. Run the test. Expect `measured` or `deferred` classification.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/measurement/parameter-measurement-coverage.test.ts` | Substantive cross-check + ratchet | Stale citations, missing usage blocks, gap-count regressions |
| `tests/lib/registry/parameter-usage-coverage.test.ts` | Schema shape | Malformed usage blocks |
| Sibling future ESLint rule (M3) | `hf-measurement/no-direct-callscore-write` | Bypassing the canonical CallScore writer |

## Related

- [`tests/lib/measurement/parameter-measurement-coverage.test.ts`](../../apps/admin/tests/lib/measurement/parameter-measurement-coverage.test.ts) — the test
- [`tests/lib/registry/parameter-usage-coverage.test.ts`](../../apps/admin/tests/lib/registry/parameter-usage-coverage.test.ts) — schema sibling
- [`.claude/rules/parameter-usage-declarative.md`](./parameter-usage-declarative.md) — sibling rule
- Epic [#1967](https://github.com/WANDERCOLTD/HF/issues/1967) — Pipeline Measurement Coverage

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
     must be **>40 chars** (M4 structural pass tightened from 20 to
     force substantive justification) and follow the decision tree
     below to declare WHICH non-measurable shape applies. Excluded
     from the gap ratchet.
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

`EXPECTED_GAP_COUNT` caps the `deferred` count. 2026-06-19 incumbent
post-M4-structural-pass: **34 active parameters** still declare
`"deferred-#1967"`. The M4 reclassification ratchet history:

- M1 (#1998) — backfilled 82 active params from existing spec corpus
- M4 (#2006) — reclassified 9 (3 measured via STYLE-001 alias-
  citation, 6 operator-only) → ratchet 57 → 48
- M4 structural pass (this commit) — reclassified 14 without
  pedagogy input using the decision tree above (1 stale row already
  wired via `parametersAsDirectives`, 5 folk-pedagogy preference
  assertions paired with BEH-* siblings, 8 ADAPT-stage decision
  rules) → ratchet 48 → 34

Pedagogy review per
[`docs/M4-pedagogy-review.md`](../../docs/M4-pedagogy-review.md)
drives the remaining 34 monotonically toward 0.

## Decision tree — how to classify a non-measurable parameter

Born of the M4 structural pass (2026-06-19, this commit) — the M4
worksheet ([`docs/M4-pedagogy-review.md`](../../docs/M4-pedagogy-review.md))
named only two forks (`measure` / `operator-only` / `defer`) but
investigation surfaced THREE structurally distinct shapes of "not
measurable", and an ADAPT-stage shape the worksheet didn't name.
Use this tree when an active parameter is producer-only and you
need to classify it:

```
Q1: Is the parameter transcript-derivable from a single call?
     (would a human listening to one transcript reliably score it?)

  YES → measured. Author or cite the AnalysisSpec.
        usage.measurement: { specSlug: "..." } or { specSlugs: [...] }
        Ratchet stays.

  NO → continue Q2.

Q2: WHY isn't it transcript-derivable? Pick one shape:

  (a) TUTOR-EMIT DIRECTIVE
      The LLM expresses the behaviour (response length, pause
      tolerance, turn length, chunk size, response style); no
      learner-side signal reflects it back. SUPERVISE-stage
      compliance checks are a separate concern.
      Reason template:
        "Sets tutor [behaviour]; tutor-emit directive expressed
         via prompt composition. Not learner-derivable from
         transcript."
      Examples: BEH-RESPONSE-LEN, BEH-TURN-LENGTH, BEH-CHUNK-SIZE,
      BEH-PAUSE-TOLERANCE, BEH-ABSTRACT-VS-CONCRETE.

  (b) FOLK-PEDAGOGY PREFERENCE ASSERTION
      The row describes a learner-preference claim ("visual learners
      respond well to analogies", "fast pace learners can handle
      more concepts at once"). Not an observable; a hypothesis.
      Typically paired with a measurable BEH-* sibling that captures
      the tutor-behaviour knob. Reference the sibling.
      Reason template:
        "Folk-pedagogy preference assertion (\"<quote from
         definition>\"); learner-preference signal that is not
         derivable from a single transcript. See <BEH-SIBLING-ID>
         sibling for the measurable tutor-behavior knob."
      Examples: analogy-usage, concept-density, example-richness,
      repetition-frequency, scaffolding (all paired with their
      BEH-* siblings).

  (c) ADAPT-STAGE DECISION RULE
      The parameter is consumed by the ADAPT-runner to make
      curriculum-sequencing decisions against aggregated mastery —
      not transcript-observable at the EXTRACT stage. The operator
      sets the target band; ADAPT reads it; no EXTRACT signal
      produces it. Per `docs/CHAIN-CONTRACTS.md`, ADAPT consumes
      CallScore + writes CallerTarget — it isn't itself a CallScore
      producer.
      Reason template:
        "ADAPT-stage curriculum-sequencing decision rule (<what it
         decides>); operator sets the target band, ADAPT-runner
         reads it against aggregated mastery. Not a transcript-
         observable EXTRACT signal — measurement does not apply at
         the EXTRACT stage."
      Examples: BEH-ADVANCE-READINESS, BEH-CHALLENGE-LEVEL,
      BEH-FOUNDATION-FOCUS, BEH-INTERLEAVING, BEH-NEW-CONTENT-RATE,
      BEH-PREREQUISITE-CALLBACK, BEH-PRODUCTIVE-STRUGGLE,
      BEH-SPACED-RETRIEVAL-PRIORITY.

  All three shapes use the same `{ kind: "operator-only", reason }`
  shape. The reason text carries the semantic distinction. Future
  tooling MAY add a discriminated kind (`adapt-stage-producer` etc.)
  but the data model stays single-kind today to avoid premature
  schema fanout — the reason templates above are the structural
  contract.

  None of these match? → "deferred-#1967" + bump ratchet. Explain
  in the PR body what classification you considered and rejected.
```

## When you DON'T need an AnalysisSpec

Quick reference — the three families covered by the tree above:

- Default-targets settings (`BEH-DEFAULT-TARGETS-QUALITY` etc.) are
  set by the wizard; they aren't transcript-derivable.
- Pure config knobs that drive prompt construction without a
  learner-state signal back (tree shape (a) — tutor-emit directive).
- Folk-pedagogy preference assertions (tree shape (b)) — paired
  with a BEH-* sibling that captures the measurable tutor-behaviour
  knob.
- ADAPT-stage decision rules (tree shape (c)) — consumed by ADAPT
  against aggregated mastery, not produced by EXTRACT.

Declare `usage.measurement: { kind: "operator-only", reason: "..." }`
with a substantive (**>40 char**) reason matching one of the
templates above. Excluded from the gap ratchet.

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
| `eslint-rules/no-bare-call-score-write.mjs` (rule `hf-measurement/no-bare-call-score-write`, #1539 / epic #1967 M3) | Edit-time, error severity | Bare `prisma.callScore.{create,update,upsert}` outside the chokepoint — guarantees every CallScore row carries a real `analysisSpecId` (producer side of measurement-loop closure). Behavioural tests at `tests/eslint-rules/no-bare-call-score-write.test.ts`. |

## Related

- [`tests/lib/measurement/parameter-measurement-coverage.test.ts`](../../apps/admin/tests/lib/measurement/parameter-measurement-coverage.test.ts) — the test
- [`tests/lib/registry/parameter-usage-coverage.test.ts`](../../apps/admin/tests/lib/registry/parameter-usage-coverage.test.ts) — schema sibling
- [`.claude/rules/parameter-usage-declarative.md`](./parameter-usage-declarative.md) — sibling rule
- Epic [#1967](https://github.com/WANDERCOLTD/HF/issues/1967) — Pipeline Measurement Coverage

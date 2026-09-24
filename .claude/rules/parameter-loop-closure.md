# Parameter loop closure — link 8 of the Lattice chain

> Every parameter classified `measured` by
> [`parameter-measurement-coverage`](./parameter-measurement-coverage.md)
> MUST also have a runtime CONSUMER — an `AGGREGATE` / `ADAPT` /
> `REWARD` spec rule that reads the param's `CallScore` and rolls
> the result back into the cascade-readable state (`CallerTarget` /
> `CallerAttribute` / `BehaviorTarget`).
>
> Without this, a parameter can be measured every call yet never
> affect subsequent behaviour: the LLM is graded, the score lands in
> `CallScore`, and nothing reads it. The adaptive loop runs but the
> per-parameter gain is 0.
>
> Sibling to [`parameter-measurement-coverage.md`](./parameter-measurement-coverage.md)
> (link 7 — measurement exists). M1 + M2 together close links 7 and 8
> of the Lattice's adaptive loop (call behaviour → measurement →
> next-call cascade).
>
> Story: [#1967](https://github.com/WANDERCOLTD/HF/issues/1967) M2.
> Part of the Coverage pillar of HF Lattice.

## Rule

When you modify a parameter's `usage.measurement` to a real spec
citation (i.e. move it from `"deferred-#1967"` to
`{ specSlug: "..." }`), check that SOME AGGREGATE / ADAPT / REWARD
spec also consumes its `CallScore`. If none does, either:

1. **Close the loop** in the same PR — extend an existing AGGREGATE /
   ADAPT spec's `aggregationRules` / `adaptationRules` to cite the
   new param as a `sourceParameter` / `sourceParameterId`, OR author
   a new AGGREGATE / ADAPT spec.
2. **Accept the gap** consciously — bump `EXPECTED_GAP_COUNT` in
   [`tests/lib/measurement/parameter-loop-closure.test.ts`](../../apps/admin/tests/lib/measurement/parameter-loop-closure.test.ts)
   with a PR-body note explaining why the loop stays open.

## Closure rules — what counts

The M2 test walks every `*.spec.json` under `docs-archive/bdd-specs/`
and classifies each measured param by closure mechanism:

| Mechanism | Recognised field | Example |
|---|---|---|
| Direct citation | `sourceParameter` (AGGREGATE) | `"sourceParameter": "COACH_CLARITY"` |
| Direct citation | `sourceParameterId` (ADAPT) | `"sourceParameterId": "module_mastery"` |
| Pattern | `sourceParameterPattern` (AGGREGATE) | `"sourceParameterPattern": "skill_*"` |
| Pattern (suffix-glob) | `sourceParameter` ending `*` | `"sourceParameter": "skill_*"` |
| Aggregator output | the param IS in an AGGREGATE spec's `parameters[].id` | `skill_ema_aggregate` |
| `_average` sentinel | (skipped — not a real source) | — |

Citations match against the param's canonical id OR any of its
declared `aliases[]`. Glob patterns match by prefix
(`skill_*` covers `skill_speaking_fluency`, `skill_listening`, …).

## Classifications

| Classification | Meaning | Counts toward gap ratchet? |
|---|---|---|
| `closed-direct` | A spec literally cites the canonical id / alias | No |
| `closed-pattern` | A `sourceParameterPattern` prefix-matches the id | No |
| `closed-aggregator-output` | The param IS the output of an AGGREGATE spec (loop self-closes through the AGGREGATE write) | No |
| `gap` | Measured but no consumer found anywhere | **Yes — the ratchet** |

## Ratchet

`EXPECTED_GAP_COUNT` caps the open-loop count. 2026-06-18 incumbent:
**67 measured parameters** have no consumer. M4 (pedagogy review +
spec authoring) plus extension PRs against existing AGGREGATE / ADAPT
specs drive this toward 0.

## When the loop legitimately stays open

A few parameter shapes don't close through the same loop:

- **AGGREGATE-output params** that are themselves consumed only by
  prose composition (not another AGGREGATE / ADAPT). The
  `closed-aggregator-output` classification handles these — they're
  not gaps.
- **Parameters whose only consumer is the composed prompt directly**
  (e.g. a `behavior:` token rendered via `transforms/targets.ts`).
  For these the loop is closed at LINK 5/6 (compose reads the
  CallerTarget) rather than at link 8. Today the M2 test treats these
  as `gap` — M4's pedagogy review will reclassify them with an
  explicit exemption category.

## When adding a new parameter

Author checklist (same PR), extending the M1 checklist:

1. Define the parameter in
   `docs-archive/bdd-specs/behavior-parameters.registry.json` with
   `usage: { compose, measurement }`.
2. Author the MEASURE AnalysisSpec (link 7 — pinned by M1).
3. **Decide the closure mechanism** (this rule — link 8):
   - Extend `SKILL-AGG-001` / `COACH-AGG-001` / sibling AGGREGATE
     spec's `aggregationRules` to add `{ sourceParameter: "<new-id>",
     targetProfileKey: "...", method: "..." }`.
   - OR extend an `ADAPT-*` spec's adaptationRules to cite the new
     id as `sourceParameterId`.
   - OR author a new AGGREGATE / ADAPT spec that consumes the param.
4. Run the test. Expect `closed-*` classification.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/measurement/parameter-loop-closure.test.ts` (this PR) | Substantive closure walk + ratchet | New measured params that silently never affect next-call behaviour |
| `tests/lib/measurement/parameter-measurement-coverage.test.ts` (M1) | Substantive measurement walk | Parameters that aren't measured at all |
| `tests/lib/registry/parameter-usage-coverage.test.ts` (M1) | Schema shape | Malformed usage blocks |
| Sibling M3 — `hf-measurement/no-direct-callscore-write` | ESLint | Bypassing the canonical CallScore writer (which is what guarantees the per-param CallScore lineage M2 builds on) |

## Related

- [`tests/lib/measurement/parameter-loop-closure.test.ts`](../../apps/admin/tests/lib/measurement/parameter-loop-closure.test.ts) — the test
- [`parameter-measurement-coverage.md`](./parameter-measurement-coverage.md) — sibling (link 7)
- [`docs/CHAIN-CONTRACTS.md`](../../docs/CHAIN-CONTRACTS.md) §3e — the structural contract row
- Epic [#1967](https://github.com/WANDERCOLTD/HF/issues/1967) — Pipeline Measurement Coverage

# CallerTarget produced ↔ consumed Coverage (Data Presence sub-pillar — cascade reachability)

> Every `targetParameter` an ADAPT spec writes via `adaptationRules`
> MUST have at least one compose-side consumer reading the resulting
> `CallerTarget` row at next-call time. Orphan DATA rows are silent
> dead branches in the adaptive loop — the row gets written, no one
> reads it, the adaptive gain is zero.
>
> Sibling Data Presence Coverage gates:
> [`parser-roundtrip-coverage.md`](./parser-roundtrip-coverage.md)
> (#2283 — authored-vs-projected parity),
> [`spec-params-canonical-presence-coverage.md`](./spec-params-canonical-presence-coverage.md)
> (#2280 — soft-FK resolvability).
>
> Sibling Producer↔Consumer Coverage gate (AGGREGATE side):
> [`aggregate-output-consumer-coverage.test.ts`](../../apps/admin/tests/lib/measurement/aggregate-output-consumer-coverage.test.ts)
> (#1967 M2). This gate covers the ADAPT-write side; together they
> close the M2 loop-closure pattern across both producer surfaces.
>
> Parent sub-pillar:
> [`data-presence-coverage.md`](./data-presence-coverage.md).
>
> Story: [#2284](https://github.com/WANDERCOLTD/HF/issues/2284)
> (umbrella [#2279](https://github.com/WANDERCOLTD/HF/issues/2279)).

## Rule

When you add or modify an ADAPT spec's `adaptationRules[].action.targetParameter`
(or `targetParameterId`):

1. **At least one compose-side reader MUST consume the resulting
   `CallerTarget` row at next-call time** — search the consumer
   dirs (`lib/prompt/composition/`, `lib/cascade/`,
   `lib/pipeline/`, `lib/voice/`, `lib/curriculum/`, `lib/goals/`)
   for the literal `targetParameter` value OR any of its registry
   aliases. The reader pattern is typically
   `prisma.callerTarget.findMany({where: {parameterId: <id>}})`
   inside a transform / cascade resolver.

2. **If you can't ship the reader in the same PR**:
   - Bump `EXPECTED_GAP_COUNT` consciously (the gate is a `<=`
     ratchet, so adding any new gap will fail CI until you bump it
     OR wire the reader).
   - OR add the `(specFile, targetParameter)` tuple to
     `CALLTARGET_EXEMPT` in
     [`tests/lib/measurement/calltarget-produced-consumed.test.ts`](../../apps/admin/tests/lib/measurement/calltarget-produced-consumed.test.ts)
     with a >20-char reason naming the compose-side absence
     rationale.

3. **When wiring a NEW reader** for an existing gap, drop
   `EXPECTED_GAP_COUNT` accordingly. The "encourage forward
   progress" test fires if the constant is 10+ gaps behind the
   actual count.

## Why this exists

ADAPT specs write to `CallerTarget` via runtime `adaptationRules`
that mutate `currentScore` / `targetScore` / `confidence` /
`rationale` fields keyed by `parameterId`. If no compose transform
reads the row at next-call time, the adapted state never reaches
the LLM — the per-call gain is zero, the EMA averages noise, the
operator can't see the loop is dead.

The sibling AGGREGATE-output gate (`aggregate-output-consumer-coverage.test.ts`,
born of #1967 M2) catches the same class on the AGGREGATE side
(`targetProfileKey` writes to `CallerAttribute`). The two together
close the loop-closure pattern for both producer surfaces.

## Alias resolution

ADAPT specs frequently use **legacy UPPER-SNAKE** parameterId forms
(`BEH-ENGAGEMENT`, `BEH-QUESTION-RATE`) while modern compose code
uses **canonical lower-snake** forms (`engagement`, `question_rate`).
Without alias resolution every legacy ref would falsely classify as
a gap.

The gate reads `behavior-parameters.registry.json` and builds an
alias index: for each `targetParameter` value found in an ADAPT
spec, the consumer corpus is searched for the canonical id OR any
declared alias.

When you add a new parameter to the registry, declare any legacy
forms in its `aliases[]` array so this gate (and sibling gates)
resolves cross-form correctly.

## How matching works

The vitest:

1. Walks every `*.spec.json` under `docs-archive/bdd-specs/`.
2. For each spec with `specRole === "ADAPT"` OR `outputType === "ADAPT"`,
   recursively extracts every `targetParameter` / `targetParameterId`
   value from `adaptationRules[].action`.
3. Loads `behavior-parameters.registry.json` and builds an alias
   index keyed on canonical `parameterId`.
4. Concatenates source from all consumer dirs into a single corpus
   string.
5. For each (specFile, targetParameter) tuple:
   - **Exempt** — listed in `CALLTARGET_EXEMPT` with reason.
   - **Covered** — the literal or any alias appears as a quoted
     string in the consumer corpus.
   - **Gap** — neither.
6. Asserts gap count ≤ `EXPECTED_GAP_COUNT`.

## Ratchet & debt

Land-time incumbent: **136 gaps** across 9 ADAPT specs. Top
offenders:
- 72 from ADAPT-LEARN-001 (learner-profile-adaptation)
- 25 from ADAPT-VARK-001 (modality-adaptation)
- 13 from ADAPT-BEH-001 (behavior-adaptation)
- 8 from ADAPT-CURR-001 (curriculum-adaptation)
- 6 from COMP-ADAPT-001 (comprehension-adaptation)
- (remainder spread across PERS / COACH / ENG / DISC)

The TL flagged this as debt at the time of grooming: "60-90
incumbent gaps; ratchet freezes but won't close without a
compose-side ADAPT-reader epic." The gate's role is to **freeze the
floor** — future ADAPT additions won't introduce more silent
dead-branches.

Driving the ratchet toward 0 requires a sibling pedagogy-led epic
that builds compose-side readers for each adapted parameter family.
Not in scope of this story; tracked as a follow-on per the
umbrella discussion in [#2279](https://github.com/WANDERCOLTD/HF/issues/2279).

## When NOT to apply

- Non-ADAPT specs — only ADAPT specs write `CallerTarget` via
  `adaptationRules`. SCORE_AGENT / AGGREGATE / REWARD have their
  own coverage in sibling gates.
- Direct `prisma.callerTarget.create` calls that don't flow through
  an ADAPT spec — those are caught by the canonical-writer ESLint
  guards (sibling Lattice surface).
- Parameter ids that are intentionally write-only telemetry (e.g.
  parameters fed back to operator dashboards, not the LLM). Add to
  `CALLTARGET_EXEMPT` with reason explaining the telemetry path.

## When adding a new ADAPT spec

Author checklist (same PR):

1. Author the ADAPT spec with `adaptationRules` referencing
   `targetParameter` values.
2. For each target, **wire a compose-side reader** in
   `lib/prompt/composition/` (or sibling consumer dir) that reads
   `CallerTarget` for the parameterId AND surfaces the adapted
   value into the composed prompt.
3. Run
   `npx vitest run tests/lib/measurement/calltarget-produced-consumed.test.ts`.
4. Green → ship. Gap → wire the reader OR drop EXPECTED_GAP_COUNT
   if not feasible AND add to exempt.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/measurement/calltarget-produced-consumed.test.ts` (this PR) | 10 vitests: walker / corpus / registry / gap ratchet / exempt ratchet / non-empty reason / no-stale-exempt / distribution / forward-progress nudge | New ADAPT targetParameter refs landing without compose-side consumers beyond the 136 incumbent floor. Stale exempt entries. Ratchet drift. |
| `tests/lib/measurement/aggregate-output-consumer-coverage.test.ts` (#1967 M2) | Sibling AGGREGATE-output ratchet | Same loop-closure class on the AGGREGATE side. The two together close the M2 pattern. |

## Related

- [`tests/lib/measurement/calltarget-produced-consumed.test.ts`](../../apps/admin/tests/lib/measurement/calltarget-produced-consumed.test.ts) — the gate
- [`tests/lib/measurement/aggregate-output-consumer-coverage.test.ts`](../../apps/admin/tests/lib/measurement/aggregate-output-consumer-coverage.test.ts) — AGGREGATE-side sibling
- [`apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`](../../apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json) — alias source-of-truth
- [`.claude/rules/data-presence-coverage.md`](./data-presence-coverage.md) — parent sub-pillar
- [`docs/CHAIN-CONTRACTS.md`](../../docs/CHAIN-CONTRACTS.md) §3e Link M2 — adaptive loop chain contract
- Story [#2284](https://github.com/WANDERCOLTD/HF/issues/2284) — this gate
- Parent umbrella [#2279](https://github.com/WANDERCOLTD/HF/issues/2279) — Lattice Coverage gaps from IELTS-MEASURE-001

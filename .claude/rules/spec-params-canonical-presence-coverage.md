# Spec action.parameterId → canonical Parameter Coverage (Data Presence sub-pillar instance)

> Every `triggers[].actions[].parameterId` referenced in any
> `*.spec.json` MUST resolve to a canonical Parameter definition —
> either an entry in `behavior-parameters.registry.json` OR a
> `parameters[]` declaration in any (same or other) spec file.
> Refs to non-canonical IDs are silent soft-FK failures: at runtime
> the pipeline references a non-existent `Parameter` row with no
> Postgres constraint to catch it.
>
> Sibling Data Presence Coverage gates:
> [`source-ref-coverage.md`](./source-ref-coverage.md) (Playbook
> module-config soft refs → ContentSource row),
> [`parser-roundtrip-coverage.md`](./parser-roundtrip-coverage.md)
> (JSON spec parser authored-vs-projected parity),
> [`cascade-value-presence-coverage.md`](./cascade-value-presence-coverage.md)
> (cascade-eligible knob × layer × playbook).
>
> Parent sub-pillar:
> [`data-presence-coverage.md`](./data-presence-coverage.md).
>
> Story: [#2280](https://github.com/WANDERCOLTD/HF/issues/2280)
> (umbrella [#2279](https://github.com/WANDERCOLTD/HF/issues/2279)).
> Born of the IELTS-MEASURE-001 silent-drop (2026-06-23): the spec's
> 4 action paramIds did resolve canonically (they ARE defined in the
> spec's own `parameters[]`), so that bug was NOT this gate's
> failure mode. But the gate prevents a sibling class: a future
> spec that references a paramId no one declares would silently
> point at a non-existent Parameter row, with no operator-visible
> signal.

## Rule

When you write a new `AnalysisSpec` JSON or modify an existing
spec's `triggers[].actions[].parameterId` reference:

1. **Each `parameterId` MUST be canonical** — defined somewhere a
   downstream consumer can find it:
   - **In the canonical registry** —
     `behavior-parameters.registry.json::parameters[]`.
   - **In the same spec's `parameters[]` block** — spec-internal
     STATE / MEASURE output declarations.
   - **In any other spec's `parameters[]` block** — cross-spec
     reference.
2. **If a paramId legitimately should not be canonically defined**
   (e.g. derived/computed at runtime), add to
   `SPEC_PARAM_REF_EXEMPT` in
   [`tests/lib/registry/spec-params-canonical-presence.test.ts`](../../apps/admin/tests/lib/registry/spec-params-canonical-presence.test.ts)
   with a >20-char reason naming the runtime resolution path AND
   bump `EXPECTED_EXEMPT_COUNT`.

The gate is structural: `EXPECTED_GAP_COUNT = 0` at land. Any new
ungrouned reference fails CI immediately.

## How matching works

The vitest walks every `*.spec.json` under `docs-archive/bdd-specs/`
and:

1. Collects every `parameters[].id` declaration across ALL specs
   into `allDefinedParamIds`.
2. Unions with every `parameterId` from
   `behavior-parameters.registry.json`.
3. Walks every `triggers[].actions[].parameterId` reference.
4. Classifies each ref:
   - `exempt` — listed in `SPEC_PARAM_REF_EXEMPT` with reason.
   - `canonical` — paramId in `allDefinedParamIds`.
   - `gap` — neither.
5. Asserts `gaps.length === EXPECTED_GAP_COUNT (= 0)`.

## When this applies

Any PR that:

- Adds a new `*.spec.json` with `triggers[].actions[].parameterId`
  references.
- Modifies an existing spec's actions to reference a new paramId.
- Removes a `parameters[]` entry that other specs' actions
  reference.
- Renames a registry-canonical paramId without updating its sibling
  declarations.

## When NOT to apply

- Pure-storyboard specs without `triggers[]` — no action refs to
  resolve.
- Registry-canonical params that are referenced ONLY by composed
  prompts (not by spec actions) — those are caught by
  `parameter-coverage.test.ts` (Producer↔Consumer Coverage sibling).
- Soft refs in `Playbook.config.modules[]` — those are caught by
  `source-ref-coverage.test.ts` (separate Data Presence instance).

## When adding a new action paramId reference

Author checklist (same PR):

1. Decide where the paramId lives canonically:
   - **Registry** — add to `behavior-parameters.registry.json`
     with full taxonomy (id, name, definition, domainGroup,
     interpretationHigh, interpretationLow, usage).
   - **Same spec** — add to the spec's `parameters[]` block.
   - **Another spec** — confirm the cross-spec reference is
     intentional and stable.
2. Reference the paramId in `triggers[].actions[].parameterId`.
3. Run
   `npx vitest run tests/lib/registry/spec-params-canonical-presence.test.ts`.
   Green → ship. Gap → fix the resolution OR add to exempt.

## Why incumbent count is 0

At land time, all 33 incumbent action-paramId references across
107 spec files resolve canonically — every one is defined in
either the registry (163 entries) or some spec's `parameters[]`
(union 403 entries). The gate's value is forward-looking: any
new spec or action ref that introduces a silent soft-FK failure
will fail CI before reaching hf_sandbox.

## Future DB-integration phase

The current gate is purely static (no DB query). A sibling DB
phase — gated by `process.env.DATABASE_URL` — would assert each
referenced paramId ALSO exists on the live DB's `Parameter` table.
This catches a different failure mode: spec catalog is clean but
DB-state has drifted (seed never ran, migration dropped a row,
etc.). Deferred to a follow-on story when CI's unit-tests job
gets a Postgres service.

Today's coverage already catches the structural class. The DB
phase is defense-in-depth.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/registry/spec-params-canonical-presence.test.ts` (this PR) | 9 vitests: walker / registry / refs / gap-check / exempt-ratchet / non-empty-reason / no-stale-canonical / no-stale-key / distribution | A new spec action.parameterId that points at a paramId nobody declares. Stale exempt entries. Distribution drift. |
| `tests/lib/registry/parameter-domain-group-taxonomy.test.ts` (#1948) | Registry canonical-12-tuple check | Sibling gate on the registry SOURCE side |
| `lib/pipeline/specs-loader.ts::filterByBehaviorTargetParams` | Runtime opt-in gate | Sibling structural enforcement on the runtime side (BT-presence check); #2271 redesigns this layer |

## Related

- [`tests/lib/registry/spec-params-canonical-presence.test.ts`](../../apps/admin/tests/lib/registry/spec-params-canonical-presence.test.ts) — the gate
- [`apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json`](../../apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json) — the canonical registry
- [`.claude/rules/data-presence-coverage.md`](./data-presence-coverage.md) — parent sub-pillar
- [`.claude/rules/parser-roundtrip-coverage.md`](./parser-roundtrip-coverage.md) — sibling Data Presence gate (#2283)
- [`.claude/rules/source-ref-coverage.md`](./source-ref-coverage.md) — sibling Data Presence gate (#2166)
- Story [#2280](https://github.com/WANDERCOLTD/HF/issues/2280) — this gate
- Parent umbrella [#2279](https://github.com/WANDERCOLTD/HF/issues/2279) — Lattice Coverage gaps from IELTS-MEASURE-001

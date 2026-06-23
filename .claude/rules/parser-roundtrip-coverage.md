# Parser round-trip Coverage — JsonParameter → ParsedParameter (Data Presence sub-pillar instance)

> Every optional field declared on `JsonParameter` in
> `apps/admin/lib/bdd/ai-parser.ts` MUST either round-trip through
> `convertJsonSpecToHybrid` to the resulting `ParsedParameter` OR be
> documented as intentionally dropped (because it is consumed from
> `rawSpec` elsewhere in the seed pipeline, not from the parsed-
> parameter pathway).
>
> Sibling Data Presence Coverage gates:
> [`source-ref-coverage.md`](./source-ref-coverage.md) (soft-FK
> resolvability — JSON soft ref → DB row),
> [`cascade-value-presence-coverage.md`](./cascade-value-presence-coverage.md)
> (cascade reachability — every published-playbook cascade cell
> classified). This rule is the **authored-vs-projected parity**
> shape of the Data Presence sub-pillar — author declares a field,
> projection through the parser/seed pipeline must carry it (or the
> drop must be explicit).
>
> Parent sub-pillar:
> [`data-presence-coverage.md`](./data-presence-coverage.md) — the
> umbrella meta-rule for the Data Presence sub-pillar of the Lattice
> Coverage pillar.
>
> Story: [#2283](https://github.com/WANDERCOLTD/HF/issues/2283)
> (umbrella [#2279](https://github.com/WANDERCOLTD/HF/issues/2279)).
> Born of PR #2276: the parser silently dropped the JSON's
> `isAdjustable: true` declaration on the 4 IELTS skill parameters,
> defeating PR #2273's intended unblock. The seed pipeline read
> `param.isAdjustable` as `undefined` → `Parameter.isAdjustable=false`
> regardless of what the spec author declared.

## Rule

When you add or modify an optional field on `JsonParameter` (or any
sibling `Json*` interface in the parser's `parameters[]` ingestion
path):

1. **Add the field to the `SENTINEL_PARAM` fixture** in
   [`tests/lib/bdd/ai-parser-roundtrip.test.ts`](../../apps/admin/tests/lib/bdd/ai-parser-roundtrip.test.ts)
   with a known sentinel value.
2. **Add the field to the `EXPECTED_OPTIONAL_FIELDS` extension
   ratchet** at the bottom of the same test file. The ratchet fails
   if `JsonParameter` grows an optional field but the fixture
   doesn't exercise it.
3. **Decide the projection plan:**
   - **Round-trip** — the field flows from JSON → `convertJsonSpecToHybrid`
     map return → `ParsedParameter` → `seed-from-specs.ts:375` →
     `Parameter` row. Add an assertion in the round-trip
     `describe` block that the sentinel value lands on the projected
     parameter.
   - **Documented drop** — the field is consumed from `rawSpec`
     directly (e.g. `usedBy`, `learningOutcomes`) elsewhere in the
     seed pipeline, not via `ParsedParameter`. Add an entry to the
     `DROPPED_FIELDS` array with a `consumedBy` note naming the
     real reader.

If you can't ship a projection plan in the same PR, default to
documented drop with a TODO and a follow-on issue.

## Why this exists

PR #2276 closed the `isAdjustable` drop, but the root cause is
structural: `convertJsonSpecToHybrid` returns an explicit-field
shape (`{ id: p.id, name: p.name, ... }`) which means **every
optional field on `JsonParameter` needs to be MANUALLY mirrored**.
There is no automatic forwarding. Adding a new field to the
interface AND seeding pipeline without remembering the map return
is the silent-drop class this gate closes.

The drop is invisible because:
- TypeScript doesn't fail — the map return is an object literal,
  not a typed construction
- `seed-from-specs.ts:375` reads `param.isAdjustable || false` —
  `undefined || false === false`, no error
- The DB row gets the default value; no operator-visible signal
  fires
- Downstream consumers (e.g. `compile-targets`) silently filter
  out the affected parameters

This is a textbook authored-vs-projected parity failure: the
author declared the value, the projection pipeline lost it, no
gate caught the drop.

## How matching works

The round-trip vitest builds a single `JsonFeatureSpec` fixture
whose `parameters[0]` carries every optional `JsonParameter`
field set to a sentinel value. It runs the fixture through
`convertJsonSpecToHybrid` and asserts:

1. Each field listed in the round-trip assertions appears on the
   resulting `ParsedParameter` with the sentinel value.
2. Each field listed in `DROPPED_FIELDS` is `undefined` on the
   resulting `ParsedParameter` (so a future refactor that starts
   forwarding the field surfaces here as a test failure → move
   the entry to round-trip assertions).
3. The fixture exercises every entry in
   `EXPECTED_OPTIONAL_FIELDS` (the extension ratchet). When a new
   optional field is added to `JsonParameter`, the ratchet fails
   until the author updates the fixture AND classifies the field
   (round-trip vs. documented drop).

## When NOT to apply

- Required fields (`id`, `name`, `description`) — they're already
  pinned by the existing `ai-parser.test.ts` "happy-path" tests.
- Optional fields on `JsonFeatureSpec` (e.g. `status`, `domain`,
  `agentScope`) — they don't flow through the `parameters[]` map;
  they're consumed from `rawSpec` directly. The gate scope is
  the parameter map specifically.
- Sibling `Json*` interfaces (`JsonAcceptanceCriterion`,
  `JsonConstraint`, etc.) — they have their own conversion paths
  in `convertJsonSpecToHybrid` with their own dedicated test
  coverage in `ai-parser.test.ts`. If a similar drop class
  emerges on those paths, file a sibling Coverage gate.

## When adding a new optional JsonParameter field

Author checklist (same PR):

1. Declare the field on the `JsonParameter` interface in
   `lib/bdd/ai-parser.ts`.
2. Add the field to the `SENTINEL_PARAM` fixture in
   `ai-parser-roundtrip.test.ts` with a sentinel value.
3. Add the field to `EXPECTED_OPTIONAL_FIELDS`.
4. Decide: round-trip or documented drop.
   - **Round-trip**: extend `convertJsonSpecToHybrid` to forward
     the field, extend `ParsedParameter` if needed, add a
     round-trip assertion.
   - **Documented drop**: add to `DROPPED_FIELDS` with a
     `consumedBy` note naming the real consumer.
5. Run
   `npx vitest run tests/lib/bdd/ai-parser-roundtrip.test.ts`.
   Green → ship.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/bdd/ai-parser-roundtrip.test.ts` (born this PR) | Round-trip fixture + extension ratchet | New optional fields silently dropped by `convertJsonSpecToHybrid` (the #2276 fingerprint generalized) |
| `tests/lib/bdd/ai-parser.test.ts` (PR #2276) | Regression pin for `isAdjustable` specifically | Direct regression of the original incident |
| `lib/bdd/ai-parser.ts` (PR #2276 fix) | `isAdjustable` added to `ParsedParameter` + map return | The original drop |

## Related

- [`tests/lib/bdd/ai-parser-roundtrip.test.ts`](../../apps/admin/tests/lib/bdd/ai-parser-roundtrip.test.ts) — the gate
- [`apps/admin/lib/bdd/ai-parser.ts`](../../apps/admin/lib/bdd/ai-parser.ts) — `JsonParameter` + `ParsedParameter` source-of-truth
- [`.claude/rules/data-presence-coverage.md`](./data-presence-coverage.md) — parent sub-pillar meta-rule
- [`.claude/rules/source-ref-coverage.md`](./source-ref-coverage.md) — sibling Data Presence gate (soft-FK resolvability)
- [`.claude/rules/cascade-value-presence-coverage.md`](./cascade-value-presence-coverage.md) — sibling Data Presence gate (cascade reachability)
- Story [#2283](https://github.com/WANDERCOLTD/HF/issues/2283) — this gate
- Parent umbrella [#2279](https://github.com/WANDERCOLTD/HF/issues/2279) — Lattice Coverage gaps from IELTS-MEASURE-001
- PR #2276 — the original `isAdjustable` drop fix; this rule generalizes the protection

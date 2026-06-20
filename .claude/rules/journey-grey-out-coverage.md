# Journey grey-out coverage (Lattice Coverage-pillar member)

> Every `gatedBy` declaration on a `JourneySettingContract` is pinned
> by `tests/lib/journey/gated-by-coverage.test.ts`. The test catches:
> typo'd parent ids, empty `inactiveValues` (would gate forever),
> boolean-vs-select mismatches, and select values that aren't in the
> parent's `options[]` (would silently never fire).
>
> Sibling Coverage-pillar tests: [`registry-consumer-coverage.md`](./registry-consumer-coverage.md),
> [`registry-schema-coverage.md`](./registry-schema-coverage.md),
> [`route-auth-zod-coverage.md`](./route-auth-zod-coverage.md),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md),
> [`parameter-coverage.md`](./parameter-coverage.md). Same generic
> enumerate→classify→ratchet pattern, sixth surface.

## Rule

When you write a new `JourneySettingContract` whose value is downstream
of another setting (the parent's value makes this one irrelevant),
declare the relationship via `gatedBy`:

```ts
gatedBy: {
  parentId: "<other contract id>",
  inactiveValues: [<value(s) of parent that make this irrelevant>],
}
```

The Inspector's `RelevanceWrapper` reads this and renders the control
in `gated-off` state — visible-but-greyed with a chip naming the parent.
Replaces the previous pattern of silently filtering the control out of
the Inspector when its setting was irrelevant — which left educators
asking "where did that toggle go?".

## Why this exists

The Slice 1 sweep of the journey grey-out epic landed 18 `gatedBy`
declarations covering the canonical dependencies (master-toggle
families like `npsEnabled` → `nps*`, `progressNarrativeEnabled` →
`progressNarrative*`, plus the `firstCallMode` → intake/onboarding
shape). The infrastructure (`computeRelevanceState` → `isGatedBy` →
`RelevanceWrapper`) already existed; no contract had declared a gate.

This coverage test makes the contract-author the responsible party:
forget the `gatedBy` and the test still passes (it doesn't enforce
completeness), but ship a *broken* `gatedBy` (typo, empty values,
value-mismatch) and CI fires immediately.

A future hardening pass can add a completeness ratchet: every contract
whose helpText says "only relevant when …" MUST also declare a
`gatedBy`. Today that's heuristic — keep it human-curated.

## How matching works

For each contract with a `gatedBy`:

1. `parentId` is looked up in `JOURNEY_SETTINGS_BY_ID`. Missing → FAIL.
2. `inactiveValues.length > 0` — empty → FAIL ("would gate forever").
3. If parent is a toggle (`control: "toggle"`), every entry in
   `inactiveValues` must be a boolean. Non-boolean → FAIL.
4. If parent is a select (`control: "select"`), every entry in
   `inactiveValues` must appear in the parent's `options[].value` set.
   Orphan value → FAIL ("declared gate would never fire").
5. No self-gate — `parentId === id` → FAIL.

## When NOT to apply

- Settings whose helpText reads "only relevant when …" but where the
  parent doesn't exist as a separate Inspector control (the parent is
  schema-level, not surfaced) — declaring `gatedBy` against a
  non-existent parent fails the test. In that case, surface the parent
  control first (a separate slice) before declaring the gate.
- Settings whose mutually-exclusive sibling is gated via
  `autoEnableLinks` instead (the auto-derived state covers that case).

## When adding a new contract

Author checklist (same PR):

1. Does this setting become irrelevant when another setting is in a
   specific value? → continue.
2. Verify the parent is a registered contract.
3. Declare:
   ```ts
   gatedBy: {
     parentId: "<parentId>",
     inactiveValues: [<values>],
   }
   ```
4. Run `npx vitest run tests/lib/journey/gated-by-coverage.test.ts`.
   If green → ship. If FAIL → fix the typo / value.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/journey/gated-by-coverage.test.ts` (born 2026-06-19) | 6 vitests | Typo parentIds, empty inactiveValues, control-type mismatch, orphan select values, self-gates. |
| `tests/lib/journey/is-gated-by.test.ts` | Resolver unit tests | Behaviour of `isGatedBy()` resolver against synthetic fixtures. |
| `tests/lib/journey/compute-relevance-state.test.ts` | Resolver unit tests | Priority order: out-of-shape → gated-off → auto-derived → inherited → active. |
| `components/journey-tab/JourneyInspectorPanel.tsx` | Render-side | `RelevanceWrapper` consumes the state; the test pins the contract. |

## Related

- [`tests/lib/journey/gated-by-coverage.test.ts`](../../apps/admin/tests/lib/journey/gated-by-coverage.test.ts) — the test
- [`lib/journey/setting-contracts.ts`](../../apps/admin/lib/journey/setting-contracts.ts) — `gatedBy` type
- [`lib/journey/compute-relevance-state.ts`](../../apps/admin/lib/journey/compute-relevance-state.ts) — the resolver
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test

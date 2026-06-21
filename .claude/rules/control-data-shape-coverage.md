# Control-type ↔ data-shape coverage (Lattice Coverage-pillar member)

> Every `JourneySettingContract` + `VoiceSettingsContract` MUST declare
> a `(control, dataShape)` pairing that is structurally compatible.
> Control type drives which `JourneyField` primitive renders the editor;
> data shape drives what the primitive reads / writes. A mismatch
> produces silent UX failure modes: `text` control over `Array<...>`
> storage truncates on save; `json-fallback` over a typeable
> `Array<{...}>` forces operators to hand-write JSON (one mistyped key
> drops the entry); `array-editor` over a `string[]` shows "No row
> schema registered" because the row-schema lookup misses.
>
> Sibling Coverage-pillar gates:
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (storagePath → transform reader),
> [`registry-schema-coverage.md`](./registry-schema-coverage.md)
> (`PlaybookConfig` field → contract / exempt),
> [`registry-options-coverage.md`](./registry-options-coverage.md)
> (`select` / `multi-select` options ↔ canonical literal set),
> [`gated-by-coverage.md`](./journey-grey-out-coverage.md)
> (`gatedBy.parentId` pins),
> [`arraykey-writer-coverage.md`](./arraykey-writer-coverage.md)
> (`arrayKey` ↔ writer route pairing). Same generic
> enumerate→classify→ratchet pattern. Sixth journey-tab Coverage gate.
>
> Catalogued in [`docs/lattice-chains.md`](../../docs/lattice-chains.md)
> as part of the Coverage pillar of HF Lattice. Born of #2225 A5 —
> the structural close-out of Mode 2 (control-type mismatch) of the
> RHS Inspector Robustness audit. A2 + A2b paired fixes (PR a792b8af
> + the `fix/2225-a2b-modulescaffoldpool-schema` branch) repair the
> 3-incumbent population; this rule prevents the regression class
> from re-entering the codebase.

## Rule

When you add or modify a `JourneySettingContract` / `VoiceSettingsContract`:

1. **Decide the storage data shape** by reading the type at
   `lib/types/json-fields.ts::PlaybookConfig` (or
   `AuthoredModuleSettings` for module-scoped settings). Pick the
   matching `DataShape` from the test's enumeration:
   `boolean | string | number | duration | enum-string |`
   `enum-multi-string | array-of-objects | array-of-strings |`
   `min-target-pair | phases-list | targets-list | tier-mapping |`
   `stop-config | voice-credential | opaque-object`.
2. **Pick a compatible control type** per the
   `CONTROL_DATA_SHAPE_COMPATIBILITY` matrix in
   [`tests/lib/journey/control-data-shape-coverage.test.ts`](../../apps/admin/tests/lib/journey/control-data-shape-coverage.test.ts).
3. **Add a `DECLARED_DATA_SHAPE` row** mapping the contract's `id` to
   its declared shape — same PR as the contract addition.
4. **If you can't ship the matching control in the same PR** (e.g.
   the matching primitive needs a row schema that's deferred to a
   later slice), add the contract id to `CONTROL_SHAPE_EXEMPT` with a
   >20-char reason naming the deferred sibling AND bump
   `EXPECTED_EXEMPT_COUNT`. The ratchet catches the bump as a
   conscious decision.

## Why this exists

`.claude/rules/lattice-survey.md` "Producer ↔ consumer pairing"
section documents the producer-only failure class for the
registry → transform layer. This rule extends the discipline ONE
layer down — to the Inspector's render path.

Mode 2 of the 2026-06-21 #2225 audit found 6 G8 module-scoped
contracts shipping in mismatch:

| Contract | Pre-A2/A2b control | Storage shape | Failure mode |
|---|---|---|---|
| `moduleTopicPool` | `json-fallback` | `Array<{topic, questions: string[]}>` | Operators hand-edit JSON; typed editor exists but isn't dispatched |
| `moduleProfileFieldsToCapture` | `json-fallback` | `ProfileFieldToCapture[]` | Same — ROW_SCHEMAS entry already shipped via Theme 1b #1815 but contract never flipped |
| `moduleScaffoldPool` | `array-editor` | `string[]` | JourneyArrayEditor's ROW_SCHEMAS lookup misses → "No row schema registered" banner; editor can't add items |

A2 (PR a792b8af) migrated `moduleTopicPool` + `moduleProfileFieldsToCapture`
to `array-editor` + added a paired `topicPool` row schema. A2b
(`fix/2225-a2b-modulescaffoldpool-schema`, in flight) closes
`moduleScaffoldPool` either by adding a string-bullet ROW_SCHEMAS path
or by converting the control to a string-bullet editor.

Without this gate, a future contract author can re-introduce the
same shape: declare `control: "json-fallback"` next to an
`Array<{...}>` field, ship operator UI that forces hand-edited JSON
through the inspector, and the silent UX regression isn't caught
until a learner-facing follow-on bug filing.

## How matching works

For each contract in `[...JOURNEY_SETTINGS, ...VOICE_SETTINGS]`:

1. Look up `DECLARED_DATA_SHAPE[contract.id]`. Missing → fails the
   "every contract has a row" assertion.
2. If `CONTROL_SHAPE_EXEMPT[contract.id]` → classify as `exempt`.
3. Otherwise check `CONTROL_DATA_SHAPE_COMPATIBILITY[contract.control]`
   for the declared shape. Match → `valid`. Mismatch → `mismatch`
   (fails the test).

## Compatibility matrix (canonical)

| Control | Allowed data shapes |
|---|---|
| `toggle` | `boolean` |
| `select` | `enum-string`, `string` |
| `multi-select` | `enum-multi-string` |
| `text` | `string` |
| `number` | `number` |
| `slider` | `number` |
| `duration` | `duration`, `number` |
| `json-fallback` | `opaque-object` |
| `phases` | `phases-list` |
| `targets` | `targets-list` |
| `banding` | `tier-mapping` |
| `voice-picker` | `voice-credential`, `string` |
| `stop` | `stop-config` |
| `min-target` | `min-target-pair` |
| `array-editor` | `array-of-objects` |

Asymmetric on purpose:

- **`select` accepts both `enum-string` and `string`** — some select-shape
  contracts gate values at the schema layer (closed union) while others
  pick from a runtime registry (e.g. `tierPresetId` reads `TIER_PRESETS`
  keys). `string` is the fallback for the latter.
- **`duration` accepts `number`** — the primitive formats seconds as a
  duration but the underlying column is numeric.
- **`array-editor` accepts ONLY `array-of-objects`** — the
  `JourneyArrayEditor.tsx::ROW_SCHEMAS` lookup keys per-field schemas
  by `contract.id`, and the schema definition requires `key: string`
  per field. `string[]` storage has no object keys to map — the editor
  shows the "No row schema registered" banner. A2b is the structural
  close-out of this class.
- **`json-fallback` accepts ONLY `opaque-object`** — the JSON editor is
  the universal escape hatch but should be a last resort. Any
  array-of-objects shape that COULD be typed (cue-card pool / topic
  pool / profile-fields) belongs on `array-editor` + ROW_SCHEMAS, not
  json-fallback.

## When NOT to apply

The vitest is structural — it ALWAYS applies. What's exempted are
individual contracts via `CONTROL_SHAPE_EXEMPT` with documented reason.

Exempt entries are appropriate when:

- The matching primitive needs a row schema that's deferred to a
  later slice (e.g. A2b's `moduleScaffoldPool` string-bullet editor).
- The data is genuinely opaque (operator-only telemetry config blob
  like `talkTimeBudgets` — declared `opaque-object` + paired with
  `json-fallback`).
- A custom primitive is in flight in a sibling PR.

Exempt entries are NOT appropriate for:

- "We'll fix it later" without a sibling-fix branch named.
- A contract that's been around for >2 PRs with no sibling-fix
  in flight.
- Convenience over correctness ("operators understand JSON").

## When adding a new contract

Author checklist (same PR):

1. Declare the contract in
   `lib/journey/setting-contracts.entries.ts` (or
   `lib/settings/voice-setting-contracts.ts`).
2. Decide the storage data shape — read the type definition at
   `lib/types/json-fields.ts` to confirm.
3. Pick the compatible control type per the matrix above.
4. Add a `DECLARED_DATA_SHAPE` row in
   `tests/lib/journey/control-data-shape-coverage.test.ts`.
5. Run
   `npx vitest run tests/lib/journey/control-data-shape-coverage.test.ts`.
6. Green → ship. RED with `missing-declaration` → add the row. RED
   with `mismatch` → fix the contract OR fix the type OR add to
   exempt with a >20-char reason naming the sibling fix.

## When adding a new control type

Author checklist (same PR):

1. Add the new value to `ControlType` in
   `lib/journey/setting-contracts.ts`.
2. Add the new primitive component to `JourneyField.tsx::PRIMITIVES`.
3. Add the new value to `CONTROL_DATA_SHAPE_COMPATIBILITY` in this
   test mapping it to the data shape(s) it can render.
4. If the new control requires a new `DataShape` value too, extend
   the `DataShape` union type alongside.

## When adding a new data shape

Author checklist (same PR):

1. Extend the `DataShape` union in this test.
2. Extend at least one row in `CONTROL_DATA_SHAPE_COMPATIBILITY` so
   the new shape has a compatible control.
3. Add the new shape's `DECLARED_DATA_SHAPE` rows for any contracts
   that use it.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/journey/control-data-shape-coverage.test.ts` (born 2026-06-22, A5 of #2225) | 8 vitests: missing-declaration check, compatibility check, exempt ratchet, non-empty reason, no-stale-exempt, no-stale-declared, no-contradiction, distribution sanity | New (control, shape) mismatches re-entering the registry — the Mode 2 audit class beyond the 3-incumbent ratchet. Authors silently adding contracts without declaring data shape. Stale exempt entries hanging on after the fix. |
| `components/journey-controls/JourneyField.tsx::PRIMITIVES` | Runtime dispatch table | Drift between contract control values and registered primitives (defensive — completeness vitest also pins it). |
| `components/journey-controls/JourneyArrayEditor.tsx::ROW_SCHEMAS` | Per-contract row schema lookup | The "No row schema registered" banner case — A2b is the structural close-out for `moduleScaffoldPool`. |
| `.claude/rules/lattice-survey.md` "Producer ↔ consumer pairing" | Author discipline | Sibling failure class one layer up (registry → transform reader). |

## When NOT to apply (structural)

The vitest is structural — it always runs. What's exempted is
individual contracts via `CONTROL_SHAPE_EXEMPT` with documented
reason naming the sibling fix branch.

## Future hardening

- **Promote `array-editor` to require strict object-shape ROW_SCHEMAS
  entry** when A2b's string-bullet variant lands as its own typed
  control (`text-array-editor` or similar). At that point
  `array-of-strings` gets a typed control and the json-fallback
  escape hatch tightens further.
- **Tighten `select` to drop the `string` fallback** when every
  options-bearing contract's values are pinned by
  `registry-options-coverage.test.ts` (Lane 4). Today the dual is
  needed for runtime-registry-sourced contracts; once those carry
  derived options too, `string` becomes a code-smell.
- **Add Inspector E2E assertion** — Playwright test that exercises
  every primitive's edit cycle (operator types → save → reload →
  value preserved). The current Coverage gate is structural; an E2E
  pin would catch primitive-internal regressions that pass the
  shape-compatibility check.

## Related

- [`tests/lib/journey/control-data-shape-coverage.test.ts`](../../apps/admin/tests/lib/journey/control-data-shape-coverage.test.ts) — the test
- [`apps/admin/lib/journey/setting-contracts.ts`](../../apps/admin/lib/journey/setting-contracts.ts) — `ControlType` source-of-truth + contract shape
- [`apps/admin/lib/journey/setting-contracts.entries.ts`](../../apps/admin/lib/journey/setting-contracts.entries.ts) — `JOURNEY_SETTINGS` array
- [`apps/admin/lib/settings/voice-setting-contracts.ts`](../../apps/admin/lib/settings/voice-setting-contracts.ts) — `VOICE_SETTINGS` array
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — `PlaybookConfig` + `AuthoredModuleSettings` data shapes
- [`apps/admin/components/journey-controls/JourneyField.tsx`](../../apps/admin/components/journey-controls/JourneyField.tsx) — `PRIMITIVES` dispatch table
- [`apps/admin/components/journey-controls/JourneyArrayEditor.tsx`](../../apps/admin/components/journey-controls/JourneyArrayEditor.tsx) — `ROW_SCHEMAS` per-contract row schema lookup
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test (one layer up)
- [`.claude/rules/registry-schema-coverage.md`](./registry-schema-coverage.md) — sibling Coverage-pillar test (`PlaybookConfig` field-level)
- [`.claude/rules/registry-options-coverage.md`](./registry-options-coverage.md) — sibling Coverage-pillar test (`options[].value` ↔ canonical literal)
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- Story [#2225](https://github.com/WANDERCOLTD/HF/issues/2225) — RHS Inspector Robustness epic (A5 = this gate)
- Sibling PRs: A2 (a792b8af — `feat/2225-a2-control-type-array-editor-migration`), A2b (`fix/2225-a2b-modulescaffoldpool-schema`, in flight), A1b (`bb61e425` — teachingStyle cascade FAMILIES entry), A0 (a93ead67 — registry-consumer-coverage false-negative fix), A3 (0383b12c — Course-only pill), A4 (e13f76a4 — domain-rooted writes)

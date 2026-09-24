# FOH Coverage — AuthoredModuleMode ↔ FOH learner-UI consumer pairing

> Every `AuthoredModuleMode` value in
> `apps/admin/lib/types/json-fields.ts` MUST have a learner-facing
> consumer inside the FOH workspace (`apps/foh/app/**` +
> `apps/foh/components/**`): either a future `resolveLearnerShell(...)`
> dispatch call OR a literal `mode === "<value>"` / `.mode === "<value>"`
> render branch. Modes intentionally rendered by the default chat-feed
> shell live in `FOH_MODE_EXEMPT` with a >20-char reason.
>
> Sibling Coverage-pillar gates:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (the broader 3-axis
> teaching / adminUI / learnerUI matrix across admin + FOH),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (`JOURNEY_SETTINGS` storagePath → transform reader),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (`SessionKindString` value → writer + reader),
> [`parameter-coverage.md`](./parameter-coverage.md) (Parameter row →
> runtime consumer).
>
> Born of #2185 Learner gap L3 (2026-06-20): today
> `apps/foh/app/sim/page.tsx` is plain chat regardless of
> `AuthoredModule.mode`. The mode-ui-coverage matrix (#2144) already
> tracks the learner-UI axis across both `components/sim` AND FOH dirs,
> but FOH is the dominant shipping learner surface — narrowing this
> gate to the FOH workspace alone keeps the L3 gap structurally visible
> even as the broader matrix evolves.

## Rule

When you add or modify a value in the `AuthoredModuleMode` type union
at `apps/admin/lib/types/json-fields.ts`:

1. **Add the value to the matrix** in
   `apps/admin/tests/components/foh-coverage.test.ts` —
   specifically add the literal to `AUTHORED_MODULE_MODE_VALUES`. The
   source-vs-matrix sanity test fires immediately if you don't.
2. **Decide the FOH consumer plan:**
   - Does the learner experience anything different inside the FOH
     workspace? A `quiz` MCQ overlay, a `mock-exam` board-chair shell,
     a `resolveLearnerShell` dispatch that branches per mode?
   - If yes → wire the consumer (a `.mode === "<value>"` branch OR a
     `resolveLearnerShell(...)` call). Drop `EXPECTED_GAP_COUNT` by
     one.
   - If no (mode is intentionally the chat-feed default) → add to
     `FOH_MODE_EXEMPT` with a >20-char reason AND bump
     `EXPECTED_EXEMPT_COUNT`. Drop `EXPECTED_GAP_COUNT` by one.
3. **If you can't ship a consumer in the same PR** — leave the new
   value as `gap` and bump `EXPECTED_GAP_COUNT` by one. The ratchet
   test catches the bump as a conscious decision.

## How matching works

The test walks `apps/foh/app/**` + `apps/foh/components/**` (skipping
`node_modules`, `__tests__`, `.next`) and concatenates every `.ts` /
`.tsx` file's contents. For each `AuthoredModuleMode` value the test
looks for either:

1. **A `resolveLearnerShell(...)` call anywhere in the concatenated
   source** — if any FOH file calls the future dispatcher, every mode
   classifies as covered. The dispatcher OWNS the per-mode branching,
   the same way `mode-ui-coverage.test.ts` trusts per-axis dispatcher
   helpers.

2. **A literal mode-equality comparison:**
   ```
   mode === "<value>"
   mode !== "<value>"
   .mode === "<value>"
   .mode !== "<value>"
   ```

Switch-case branches (`case "<value>":`) are **deliberately NOT
matched** — FOH source contains unrelated string literals (`Triage`
status values, audience IDs, etc.) that would falsely match a
case-based detector. Mode-keyed switches should rewrite to `===`
checks or exempt the mode with a one-line reason.

## Today's incumbent matrix (2026-06-20 baseline)

| Mode | FOH consumer | Status |
|---|---|---|
| `tutor` | none — plain `SimChatPage` | gap |
| `examiner` | none — plain `SimChatPage` | gap |
| `mixed` | none — plain `SimChatPage` | gap |
| `quiz` | none — plain `SimChatPage` | gap |
| `mock-exam` | none — plain `SimChatPage` | gap |

Ratchet baseline: `EXPECTED_EXEMPT_COUNT = 0`, `EXPECTED_GAP_COUNT = 5`.

The first PR that wires a FOH `resolveLearnerShell` dispatch collapses
all five gaps to `covered` in one step. Incremental wiring (one mode
at a time via explicit `.mode === "X"` branches) drops the ratchet by
one per PR.

## When NOT to apply

- The mode is consumed in the admin SIM tooling (`components/sim/**`,
  `app/x/student/**`) but not the FOH workspace. The broader
  `mode-ui-coverage.test.ts` (#2144) tracks that surface; this FOH
  gate is intentionally narrower.
- The mode value was retired from the union. Remove the literal from
  `AUTHORED_MODULE_MODE_VALUES` (and the admin sibling matrix).

## Related

- [`tests/components/foh-coverage.test.ts`](../../apps/admin/tests/components/foh-coverage.test.ts) — the test
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — `AuthoredModuleMode` source-of-truth
- [`apps/foh/app/sim/page.tsx`](../../apps/foh/app/sim/page.tsx) — today's mode-unaware FOH SIM page (the target consumer)
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling Coverage-pillar test (broader 3-axis matrix)
- [`.claude/rules/sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) — sibling Coverage-pillar test (type-union → writer + reader pairing)
- Parent epic [#2185](https://github.com/WANDERCOLTD/HF/issues/2185) — UI Gap Zero umbrella (Learner gap L3)
- Story [#2207](https://github.com/WANDERCOLTD/HF/issues/2207) — this gate

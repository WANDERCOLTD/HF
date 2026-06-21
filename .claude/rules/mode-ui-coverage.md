# Mode UI coverage — type-union value ↔ UI consumer pairing

> Every `AuthoredModuleMode` value in
> `apps/admin/lib/types/json-fields.ts` MUST have a consumer on each
> of three axes: **teaching** (compose-side directive or default),
> **adminUI** (badge / icon / inspector / pill), and **learnerUI**
> (SIM shell, FOH pre-call card, ExamModeShell mount, or chat-feed
> reskin). Modes that legitimately don't need a per-axis consumer
> (because they ARE the default — `tutor` baseline conversational,
> `mixed` = tutor + assessment touches) live in `MODE_AXIS_EXEMPT`
> with a >20-char reason.
>
> Sibling Coverage-pillar gates:
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (`JOURNEY_SETTINGS` storagePath → transform reader),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (`SessionKindString` value → writer + reader),
> [`parameter-coverage.md`](./parameter-coverage.md) (Parameter row →
> runtime consumer),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md)
> (route response → tier-redactor).
>
> Born of the 2026-06-21 audit which surfaced the producer-only
> failure mode: PRs #2077 / #2081 / #2090 closed stories #2010 / #2011
> / #2013 with COMPLETED state after wiring the type union extension
> + compose directives + admin badge icons. The audit confirmed all
> three were on `origin/main`. But for `quiz` and `mock-exam`, NO
> learner-facing UI consumer ever shipped — the learner experienced
> an identical SimChat session whether the module's mode was `tutor`,
> `mixed`, `quiz`, or `mock-exam`. The Coverage matrix was incomplete
> at the consumer surface that mattered most.

## Rule

When you add or modify a value in the `AuthoredModuleMode` type union
at `apps/admin/lib/types/json-fields.ts`:

1. **Add coverage rows for the new value** in
   `apps/admin/tests/lib/sim-chat/mode-ui-coverage.test.ts` —
   specifically add the literal to `AUTHORED_MODULE_MODE_VALUES`. The
   source-vs-matrix sanity test fires immediately if you don't.
2. **Decide the consumer plan for each of the three axes:**
   - **teaching** (compose-side): does this mode need a compose-time
     directive (like `resolveModuleQuizDirective` /
     `resolveModuleMockExamDirective`)? OR is it covered by the
     baseline tutor stack (like `tutor` and `mixed`)? OR via a
     spec-slug template runner (like `examiner`)? Wire the
     consumer OR add to `MODE_AXIS_EXEMPT` with reason.
   - **adminUI**: at least one `app/x/**` or `components/**` file
     should branch on `.mode === "<value>"` to render a distinct
     badge / icon / inspector. Tutor today is the implicit fallback
     in `ModePill` / `ModeIcon` ternary chains; if your mode is
     similarly implicit, exempt with reason.
   - **learnerUI**: does the learner experience anything different?
     A SimChat reskin? A specialised shell (like `ExamModeShell` for
     `examiner`)? A pre-call context card? Wire OR exempt.
3. **If you can't ship a consumer in the same PR**, add to
   `MODE_AXIS_EXEMPT` with a reason describing WHY the cell is
   intentionally producer-only AND bump `EXPECTED_EXEMPT_COUNT`. The
   ratchet test catches the bump as a conscious decision.

## How matching works

For each (mode, axis) cell, the test walks the axis's consumer
directories and looks for the mode literal in a comparison against
`mode` / `.mode`:

```
mode === "<value>"
mode !== "<value>"
.mode === "<value>"
.mode !== "<value>"
```

Switch-case branches (`case "<value>":`) are **deliberately NOT
matched** — they may legitimately exist for unrelated string literals
(e.g. `AudienceId = "mixed"` in
`lib/prompt/composition/transforms/audience.ts` is NOT a mode
consumer). If your mode is consumed via a switch, rewrite the branch
to use an explicit `=== ` check OR list the cell in `MODE_AXIS_EXEMPT`
with a one-line reason.

## Axis consumer-directory map

| Axis | Directories |
|---|---|
| teaching | `lib/prompt/composition/transforms`, `lib/prompt/composition/loaders`, `lib/prompt/composition`, `lib/curriculum` |
| adminUI | `app/x`, `components/modules-tab`, `components/journey-tab` |
| learnerUI | `components/sim`, `app/x/student`, `apps/foh/app`, `apps/foh/components` |

## Today's incumbent matrix (2026-06-21 baseline)

| Mode | teaching | adminUI | learnerUI |
|---|---|---|---|
| `tutor` | exempt-default | exempt-fallback | exempt-default |
| `mixed` | exempt-default | covered | exempt-default |
| `examiner` | exempt-template | covered | covered (`ExamModeShell`) |
| `quiz` | covered (`resolveModuleQuizDirective`) | covered (ModePill icon) | **gap** |
| `mock-exam` | covered (`resolveModuleMockExamDirective`) | covered (ModePill icon) | **gap** |

Ratchet baseline: `EXPECTED_EXEMPT_COUNT = 6`, `EXPECTED_GAP_COUNT = 2`.

## Shell reuse pattern (operator-preferred)

When a new mode shares behaviour with an existing one (e.g.
`mock-exam` is conceptually examiner-mode with a different persona +
visual aesthetic), the preferred shape is:

1. Extend the existing shell's mount-gate to accept both modes:
   ```ts
   // components/sim/ExamModeShell.tsx
   export function shouldMountExamModeShell(
     module: Pick<AuthoredModule, "mode">,
     sessionTerminal: boolean,
   ): boolean {
     return (
       (module.mode === "examiner" || module.mode === "mock-exam") &&
       sessionTerminal === true
     );
   }
   ```
2. Drive the colour theme + mode-pill copy from the mode literal
   inside the shell — same JSX, themed differently per mode.
3. Both `examiner` and `mock-exam` cells become `covered`; no new
   shell file required.

This counts as `covered` (real `.mode === "X"` reader in the
learnerUI dir). The Coverage test doesn't distinguish "covered-own"
from "covered-shared" today — that's metadata for the operator to
track in the rule file's matrix.

## When NOT to apply

This rule covers `AuthoredModuleMode`. The same generic shape applies
to other type unions where producer-only failure would surprise
learners — e.g. `SessionKindString` (covered by
[`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)).
Each surface gets its own paired test + rule.

## Related

- [`tests/lib/sim-chat/mode-ui-coverage.test.ts`](../../apps/admin/tests/lib/sim-chat/mode-ui-coverage.test.ts) — the test
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — `AuthoredModuleMode` source-of-truth
- [`apps/admin/lib/prompt/composition/transforms/instructions.ts`](../../apps/admin/lib/prompt/composition/transforms/instructions.ts) — `resolveModuleQuizDirective` + `resolveModuleMockExamDirective`
- [`apps/admin/components/sim/ExamModeShell.tsx`](../../apps/admin/components/sim/ExamModeShell.tsx) — `shouldMountExamModeShell` (examiner-only today; mock-exam shell-reuse pending)
- [`.claude/rules/sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) — sibling Coverage-pillar test
- [`.claude/rules/registry-consumer-coverage.md`](./registry-consumer-coverage.md) — sibling Coverage-pillar test (storagePath surface)
- Epic [#2009](https://github.com/WANDERCOLTD/HF/issues/2009) — CIO/CTO trio variant mechanics (closing PRs #2077 / #2081 / #2090 exposed this gap)

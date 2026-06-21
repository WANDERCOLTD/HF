# Shell coverage — LearnerShellKind ↔ concrete component pairing

> Every `LearnerShellKind` value in
> `apps/admin/lib/types/json-fields.ts` (declared by PR #2173 as part
> of epic #2163) MUST have a concrete React component under
> `apps/admin/components/sim/` that (a) exists at the canonical
> `<PascalCase(kind)>Shell.tsx` path AND (b) accepts a
> `capabilities: LearnerShellCapabilities` prop. Shells that hard-branch
> on the kind literal instead of consuming the capability map fail the
> structural contract.
>
> Sibling Coverage-pillar gates:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (AuthoredModuleMode ×
> teaching/admin/learner axes),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (SessionKindString writer ↔ reader pairing),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (JOURNEY_SETTINGS storagePath → transform reader),
> [`tier-visibility-coverage.md`](./tier-visibility-coverage.md) (route
> response → tier-redactor).
>
> Born of the 2026-06-21 audit that became epic #2185 (UI Gap Zero):
> the LearnerShellKind union shipped via PR #2173 as a declarative
> Lattice primitive, but no structural gate pinned each kind to a
> concrete UI consumer. Without this Coverage test, a future kind
> addition (e.g. `connect-warmth-fitness` for #2163's per-course
> extension) could land in the type union + `SHELL_DEFAULTS` map and
> reach prod with the learner silently falling back to the implicit
> `chat-feed` default — invisible to operators reviewing the merge.

## Rule

When you add or modify a value in the `LearnerShellKind` type union at
`apps/admin/lib/types/json-fields.ts`:

1. **Add coverage rows for the new value** in
   `apps/admin/tests/components/shell-coverage.test.ts` —
   specifically append the literal to `LEARNER_SHELL_KIND_VALUES` AND
   add an entry to `KIND_TO_COMPONENT`. The source-vs-matrix sanity
   test fires the moment the union diverges.
2. **Ship the concrete shell component** under
   `apps/admin/components/sim/<PascalCase(kind)>Shell.tsx`. Components
   MUST accept the `capabilities: LearnerShellCapabilities` prop and
   read affordances from the capability map — never branch on the kind
   literal inside JSX (`shellKind === "exam" ? ... : ...`). That
   procedural pattern defeats the Coverage walk AND the wider epic
   #2163 decoupling goal.
3. **If you can't ship the shell in the same PR**, add an entry to
   `SHELL_EXEMPT` in the test file with a >20-char reason describing
   WHY the kind is intentionally producer-only AND when the consumer
   will land. Bump `EXPECTED_EXEMPT_COUNT`. The ratchet test forces a
   conscious decision.

## How matching works

For each `LearnerShellKind` value, the test:

1. Resolves the component filename via `KIND_TO_COMPONENT`. The
   convention is `kebab-case → PascalCase + "Shell"`:

   | Kind | Component file |
   |---|---|
   | `chat-feed` | `ChatFeedShell.tsx` |
   | `exam` | `ExamModeShell.tsx` (backwards-compat with #1745) |
   | `mcq-rounds` | `MCQRoundsShell.tsx` |
   | `results-readout` | `ResultsReadoutShell.tsx` |
   | `intake-wizard` | `IntakeWizardShell.tsx` |

2. Checks `apps/admin/components/sim/<Component>.tsx` exists on disk.
3. Reads the source; matches the regex
   `\bcapabilities\s*[?]?\s*:\s*Learner` — i.e. the shell declares a
   prop named `capabilities` typed against a `Learner`-prefixed type
   (`LearnerShellCapabilities` today; allows generics + optional `?`).

A match counts as `covered`. Exempt cells are listed in `SHELL_EXEMPT`
with a documented reason. Anything else is `gap`.

## Ratchets

| Constant | Today's value | Drops when |
|---|---|---|
| `EXPECTED_GAP_COUNT` | 5 (RED first-run against `main` pre-#2202) | PR #2202 lands → 2 (results-readout + intake-wizard remain). S4-S7 of #2163 land → 1 → 0. |
| `EXPECTED_EXEMPT_COUNT` | 0 | Stays 0 unless a kind is declared without a planned consumer. |

Both ratchets are exact-match (`toBe(...)`). Closing or opening a row
forces a conscious bump in the same PR.

## How to fix a failure

| Failure shape | Fix |
|---|---|
| "no LearnerShellKind is an uncovered gap beyond the ratchet" | Ship the shell with `capabilities: LearnerShellCapabilities` OR add to `SHELL_EXEMPT` with reason. |
| "ratchet — gap count matches EXPECTED_GAP_COUNT exactly" | Drop or bump the constant in the same commit that closed/opened the gap. |
| "no exempt entry is contradicted by an actual covered component" | The component shipped — remove the stale exempt entry. |
| "no exempt entry references an unknown kind (stale row)" | A kind was renamed/retired — remove the exempt entry. |
| "test matrix matches the source-of-truth type union" | Append the new kind to `LEARNER_SHELL_KIND_VALUES` AND `KIND_TO_COMPONENT`. |

## When NOT to apply

- A kind is removed from the type union — the test naturally stops
  enumerating it. Remove the `KIND_TO_COMPONENT` entry; remove the
  `SHELL_EXEMPT` entry if any.
- Per-course extension kinds added under the #2145 / #2163 per-course
  typed-union pattern — those live in a separate per-course module
  and have their own coverage strategy (TBD in #2163 S5+).
- Storybook-only shells or test fixtures — those don't live under
  `components/sim/` and never appear in the matrix.

## Internal-name discipline (cross-cut with `learner-ui-leak-coverage`)

The shell kind name (`"exam"` / `"chat-feed"` etc.) is **internal** —
it never reaches learner UI as a static literal. The learner sees the
capability EFFECTS (timer visible / mode pill copy / colour theme)
rendered from the `capabilities` map. The
[`learner-ui-leak-coverage.test.ts`](../../apps/admin/tests/lib/sim-chat/learner-ui-leak-coverage.test.ts)
gate is the sibling that pins this discipline.

## Related

- [`tests/components/shell-coverage.test.ts`](../../apps/admin/tests/components/shell-coverage.test.ts) — the test
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — `LearnerShellKind` source-of-truth (PR #2173)
- [`apps/admin/components/sim/ExamModeShell.tsx`](../../apps/admin/components/sim/ExamModeShell.tsx) — first concrete shell (#1745; capability refactor lands via PR #2202)
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling Coverage-pillar test (AuthoredModuleMode surface)
- [`.claude/rules/sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md) — sibling Coverage-pillar test (SessionKindString surface)
- Epic [#2163](https://github.com/WANDERCOLTD/HF/issues/2163) — LearnerShell as a typed Lattice primitive
- Story [#2208](https://github.com/WANDERCOLTD/HF/issues/2208) — U7 of #2185, this gate
- Parent epic [#2185](https://github.com/WANDERCOLTD/HF/issues/2185) — UI Gap Zero umbrella

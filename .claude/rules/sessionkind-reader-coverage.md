# SessionKind reader coverage — writer + reader pairing

> Every `SessionKindString` value in
> `apps/admin/lib/voice/session-rules.ts` MUST have BOTH a writer
> (at least one code path creates a `Session` with that kind) AND a
> reader (at least one business-logic surface branches on the kind).
> Type-only ghosts — values declared in the union with no writer and
> no business-logic reader, only the type-exhaustiveness switch case
> — must either be implemented OR removed from the union.
>
> Sibling Coverage-pillar gates:
> [`mode-ui-coverage.md`](./mode-ui-coverage.md)
> (`AuthoredModuleMode` value → 3-axis UI consumer),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (`JOURNEY_SETTINGS` storagePath → transform reader),
> [`parameter-coverage.md`](./parameter-coverage.md) (Parameter row →
> runtime consumer).
>
> Born of the 2026-06-21 audit which found `ASSESSMENT` and
> `TEXT_CHAT` declared on epic #1338's unified Session model alongside
> `ENROLLMENT` / `VOICE_CALL` / `SIM_CALL`, with full counterFlags
> branches in `session-rules.ts::initialCounterFlags`. But no code
> path ever calls `createSession({ kind: "ASSESSMENT" })` or
> `createSession({ kind: "TEXT_CHAT" })`. Both are type-only ghosts.
> The convention "if it's in the union it must be reachable" was not
> structurally enforced — this gate closes that.

## Rule

When you add a value to `SessionKindString`:

1. **Add the value to `SESSION_KIND_VALUES`** in
   `apps/admin/tests/lib/voice/sessionkind-reader-coverage.test.ts`.
   The source-vs-matrix sanity test fires if the union diverges from
   the test data.
2. **Implement the writer** — at least one code path must
   `createSession({ kind: "<value>", ... })` (or equivalent
   data/where shape on `prisma.session`). If you can't ship the
   writer in the same PR, list the cell in `SESSIONKIND_AXIS_EXEMPT`
   with a reason describing what's pending (e.g., "reserved for
   epic #X").
3. **Implement the reader** — at least one business-logic surface
   must branch on the kind value via `=== "<value>"` or
   `kind: "<value>"` (Prisma where/data field). The
   type-exhaustiveness switch at
   `session-rules.ts::initialCounterFlags` does NOT count — it's type
   plumbing, not consumption.
4. **Bump ratchets** if you legitimately add an exemption. The test
   fails on ratchet drift.

When you REMOVE a value, also remove its rows from the test
matrix and the exempt list, plus drop the ratchet counts accordingly.

## How matching works

For each (kind, axis) cell:

**Writer match** — kind appears as the value of a `kind:` field:
```
kind: "<value>"
kind = "<value>"
kind:"<value>"
kind="<value>"
```

**Reader match** — kind appears in any of:
```
kind === "<value>"
kind !== "<value>"
.kind === "<value>"
.kind !== "<value>"
kind: "<value>"   (Prisma where { kind: "X" })
```

Switch-case branches (`case "<value>":`) are **deliberately NOT
matched** — every union member appears as a case label in the
type-exhaustiveness switch at `lib/voice/session-rules.ts`, which is
not a business-logic consumer. Ghost kinds will pass type-checking
but fail this Coverage test.

## Axis source-directory map

| Axis | Directories |
|---|---|
| writer | `lib/voice`, `lib/intake`, `lib/test-harness`, `app/api`, `lib/curriculum` |
| reader | `lib/voice`, `lib/pipeline`, `lib/curriculum`, `lib/prompt`, `app/api`, `app/x`, `components` |

## Today's incumbent matrix (2026-06-21 baseline)

| Kind | writer | reader |
|---|---|---|
| `ENROLLMENT` | covered | covered (`resolve-used-prompt.ts`, `stamp-enrollment-session-prompt.ts`) |
| `VOICE_CALL` | covered (voice webhooks) | covered (`poll-stale-calls.ts`, pipeline runners) |
| `SIM_CALL` | covered (`sim-runner.ts`, `/api/callers/[id]/calls`) | covered |
| `ASSESSMENT` | **exempt-ghost** | **exempt-ghost** |
| `TEXT_CHAT` | **exempt-ghost** | **exempt-ghost** |

Ratchet baseline: `EXPECTED_EXEMPT_COUNT = 4`, `EXPECTED_GAP_COUNT = 0`.

## Ghost-kind resolution paths

For each ghost (ASSESSMENT, TEXT_CHAT), one of these must happen:

1. **Implement** — wire a writer in the appropriate intake / harness
   route, wire a reader in the appropriate consumer dir. Drop the
   exempt entries; drop the ratchet by 2 each.
2. **Remove from the union** — if no use case materialises, delete
   the value from `SessionKindString`, remove its case branch from
   `initialCounterFlags` (the exhaustive switch enforces this — the
   `const exhaustive: never = kind` line will fire on the next member
   added). Drop the exempt entries; drop the ratchet by 2 each.

The decision is operator-level, not coder-level. The exempt entries
carry the reason so the decision is auditable; the ratchet pins the
count so the question can't be silently deferred forever.

## When NOT to apply

This rule covers `SessionKindString` specifically. Other Session-
level enums (e.g. `Session.status`, `Session.outcome`) have their own
type-exhaustiveness consumers in `session-rules.ts` and don't carry
the ghost risk because every status/outcome has a business-logic
path (status flips drive UI rendering; outcomes feed counter flags).

## Related

- [`tests/lib/voice/sessionkind-reader-coverage.test.ts`](../../apps/admin/tests/lib/voice/sessionkind-reader-coverage.test.ts) — the test
- [`apps/admin/lib/voice/session-rules.ts`](../../apps/admin/lib/voice/session-rules.ts) — `SessionKindString` source-of-truth + exhaustive switch
- [`apps/admin/lib/voice/create-session.ts`](../../apps/admin/lib/voice/create-session.ts) — canonical Session writer (epic #1338)
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling Coverage-pillar test
- Epic [#1338](https://github.com/WANDERCOLTD/HF/issues/1338) — unified Session model (origin of the 5-value union)

# Caller-erasure delete-chain Coverage (Lattice Coverage-pillar member)

> Every FK relation pointing at `Caller` whose `onDelete` is `Restrict`
> — or is left unspecified, which Prisma renders as `Restrict` — MUST be
> deleted by the canonical erasure chokepoint
> [`lib/gdpr/delete-caller-data.ts::deleteCallerData`](../../apps/admin/lib/gdpr/delete-caller-data.ts)
> before it calls `caller.delete()`. Postgres refuses the delete
> otherwise, and caller erasure fails with `P2003`.
>
> Relations declared `Cascade` or `SetNull` are resolved by Postgres and
> are deliberately NOT required.
>
> Sibling Coverage-pillar gates:
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md)
> (storagePath → transform reader),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md)
> (SessionKind → writer + reader),
> [`parameter-coverage.md`](./parameter-coverage.md) (Parameter →
> runtime consumer). Same enumerate→classify→ratchet shape, applied to
> the schema-to-chokepoint surface.
>
> Sibling discipline: [`data-retention.md`](./data-retention.md)
> (write-side regulatory-expiry stamping) and
> [`privacy-redaction.md`](./privacy-redaction.md) (read-side tier
> projection). This file holds the **erasure-completeness** half.
>
> Born 2026-09-23. Epic [#1338](https://github.com/WANDERCOLTD/HF/issues/1338)
> added `Session.callerId` with `onDelete: Restrict`; the chokepoint was
> never updated and nothing caught it.

## Rule

When you add a model with a FK to `Caller`:

1. **Prefer `onDelete: Cascade`** when the rows are pure children of the
   Caller and carry no independent lifecycle. Postgres then handles
   erasure and no chokepoint change is needed.
2. **If the relation is `Restrict`** (explicitly, or by omitting
   `onDelete`), add a matching `deleteMany` to `deleteCallerData`
   **before** its `caller.delete()` call — in the same PR.
3. **If the new model has its own Restrict-FK children**, clear those
   first. `CohortGroup` is the worked example: `Invite` holds a
   Restrict FK to it, so invites are deleted before the cohorts.
4. **Never hand-roll a parallel delete chain.** Call `deleteCallerData`.
   Duplicated chains are what caused this rule to exist — five seed
   scripts each maintained their own copy and all five drifted.

The structural enforcement is
[`tests/lib/gdpr/caller-delete-coverage.test.ts`](../../apps/admin/tests/lib/gdpr/caller-delete-coverage.test.ts).

## Why this exists

`deleteCallerData` is the sole path behind three production surfaces:

| Surface | Route |
|---|---|
| GDPR Art.17 erasure | `DELETE /api/callers/[callerId]` |
| Retention cleanup cron | `POST /api/admin/retention/cleanup` |
| Bulk delete | `POST /api/admin/bulk-delete` |

It deleted 22 tables and grew by hand. Epic #1338 added a 23rd relation
with `onDelete: Restrict` and the chain was not updated, so
`caller.delete()` began throwing for any caller that had ever held a
session. Measured 2026-09-23 by running the real helper inside a
rolled-back transaction:

```
hf_sandbox   160 callers,  44 un-erasable (28%)
hf_staging   159 callers,  50 un-erasable (31%)
RESULT: P2003 — constraint `Session_callerId_fkey`
```

A careful manual survey found `Session`. It missed `CohortGroup.ownerId`,
which blocks erasure identically. The gate found both on its first run.
That gap between "a reviewer looked" and "the schema was enumerated" is
precisely what this pillar exists to close.

The failure mode is unusually quiet: erasure is exercised rarely, the
error surfaces at request time rather than at deploy, and nothing about
adding a model to `schema.prisma` hints that an unrelated GDPR helper
needs editing.

## How matching works

The test parses `prisma/schema.prisma` directly — there is no Prisma AST
parser in this repo, and `@prisma/internals` is not a public API.

1. Split into `model X { ... }` blocks.
2. Within each (skipping `Caller` itself), find
   `<field> Caller[?] @relation(...)` and read `onDelete`.
3. Absent `onDelete` is recorded as `UNSPECIFIED` and treated as
   **blocking** — this is the Prisma default and the case that bit us.
4. For each blocking relation, look for `.<modelCamelCase>.delete` in
   the helper source (matches both `delete` and `deleteMany`).
5. Classify `covered` / `exempt` / `gap`.

Matching is by **model**, not FK field name — `CohortGroup` is reached
through `ownerId`, not `callerId`.

A `MIN_EXPECTED_CALLER_RELATIONS` floor guards the parse itself: if a
schema refactor breaks the regex, the enumeration would silently return
nothing and every assertion would pass vacuously. The floor turns that
into a failure.

## Second-order edges

Clearing everything that points at `Caller` is not sufficient. The helper
also deletes OTHER rows — owned `CohortGroup`s, `CallerIdentity` rows —
and those have their own inbound FKs. A `Restrict` FK into one of them
blocks erasure just as hard, and a scan that only walks edges into
`Caller` structurally cannot see it.

Two real gaps of this shape were found the day the gate shipped, both
after the first-order scan already read 0 gaps:

| Edge | Why it blocks |
|---|---|
| `Caller.cohortGroupId → CohortGroup` | The deprecated single-membership scalar. Erasing a cohort owner threw P2003 on behalf of *other* callers still pointing at that cohort — 20 such callers existed on both hf_sandbox and hf_staging. |
| `BehaviorTarget.callerIdentityId → CallerIdentity` | CALLER-scope behaviour tuning pinned the identity rows the helper was trying to delete. |

The second-order block walks every model the helper deletes (inferred
from `.<accessor>.delete` in its source), enumerates blocking inbound
FKs, and requires each to be either deleted outright or **severed** —
`updateMany({ data: { <fkField>: null } })`.

Severing is the right move when the referencing rows belong to someone
else. Deleting another caller's row to erase this one would be a
different bug.

## Ratchets

| Constant | Value at birth | Meaning |
|---|---|---|
| `EXPECTED_GAP_COUNT` | 0 | Blocking relations with no delete. Must stay 0. |
| `EXPECTED_EXEMPT_COUNT` | 0 | Documented exceptions. |

`EXPECTED_GAP_COUNT` is 0 rather than an incumbent count because the
population was fully closed in the same PR. Do not raise it — a gap here
means caller erasure is broken for real people.

## On exempting

`CALLER_DELETE_EXEMPT` is empty by design, and an entry is nearly always
the wrong answer. An exemption asserts *erasure still succeeds*, which
can only be true if the relation has also stopped being `Restrict`. If
rows must legally survive erasure (audit, retention), the correct shape
is to **anonymise** them — sever the `callerId` and strip the PII — not
to leave a Restrict FK in place and document it. A row here that does not
also change the schema is a bug with a comment attached.

## When NOT to apply

- Relations declared `Cascade` or `SetNull` — Postgres handles them.
- Models with no FK to `Caller`.
- Read paths. This gate is about deletion completeness only; tier
  redaction on reads is [`privacy-redaction.md`](./privacy-redaction.md).

## When adding a new Caller-referencing model

Author checklist, same PR:

1. Decide `onDelete`. Prefer `Cascade` for pure children.
2. If `Restrict` (or unspecified), add the `deleteMany` to
   `deleteCallerData` before `caller.delete()`.
3. Clear any Restrict-FK children of that model first.
4. Add the field to `DeletionCounts` and its initialiser so the erasure
   receipt reports it.
5. Run `npx vitest run tests/lib/gdpr/caller-delete-coverage.test.ts`.
   Green → ship.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/gdpr/caller-delete-coverage.test.ts` (born 2026-09-23) | 8 vitests: parse-floor sanity, chokepoint-still-deletes-Caller, gap check, exempt ratchet, non-empty reason, non-stale exempt, no-contradiction, distribution sanity | A new Restrict FK to `Caller` silently breaking erasure — the #1338 fingerprint |
| `lib/gdpr/delete-caller-data.ts` | The single chokepoint | Drift between the three erasure surfaces |
| `.claude/rules/data-retention.md` | Write-side regulatory-expiry stamping | Rows with no deletion deadline |
| `.claude/rules/privacy-redaction.md` | Read-side tier projection | Over-disclosure on reads |

## Related

- [`tests/lib/gdpr/caller-delete-coverage.test.ts`](../../apps/admin/tests/lib/gdpr/caller-delete-coverage.test.ts) — the gate
- [`lib/gdpr/delete-caller-data.ts`](../../apps/admin/lib/gdpr/delete-caller-data.ts) — the chokepoint
- [`.claude/rules/lattice-survey.md`](./lattice-survey.md) — pre-coding survey discipline
- [`.claude/rules/data-retention.md`](./data-retention.md) — sibling privacy rule (write side)
- [`.claude/rules/privacy-redaction.md`](./privacy-redaction.md) — sibling privacy rule (read side)
- Epic [#1338](https://github.com/WANDERCOLTD/HF/issues/1338) — unified Session model; origin of the drift

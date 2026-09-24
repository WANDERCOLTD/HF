# Scalar-list `@default` coverage (Lattice Coverage-pillar member)

> Every scalar-list field in `apps/admin/prisma/schema.prisma` — `String[]`,
> `Int[]`, and siblings — MUST declare `@default(...)`. A scalar list without
> one is a column whose database default Prisma is free to delete on the next
> migrate diff, silently.
>
> Relation lists (`Session[]`, `CallScore[]`) are out of scope — Prisma
> forbids `@default` on them. Enum lists too: a sensible default there is
> domain-specific.
>
> Sibling Coverage-pillar gates:
> [`caller-delete-coverage.md`](./caller-delete-coverage.md),
> [`registry-consumer-coverage.md`](./registry-consumer-coverage.md),
> [`sessionkind-reader-coverage.md`](./sessionkind-reader-coverage.md).
>
> Born 2026-09-24 of the `CurriculumModule.coversModules` incident.
> Story [#2332](https://github.com/WANDERCOLTD/HF/issues/2332).

## Rule

When you add a scalar list to a model:

1. **Declare `@default([])`** on the field. Almost always the empty array; a
   populated default (`@default(["content"])` on `PlaybookSource.tags`) is
   fine where it is meaningful.
2. **If you also write a migration granting a DB default**, the schema
   declaration is what keeps it. Without it, the next diff drops it.
3. Never leave a scalar list bare.

Enforced by
[`tests/lib/schema/scalar-list-default-coverage.test.ts`](../../apps/admin/tests/lib/schema/scalar-list-default-coverage.test.ts).

## Why this exists

Migration `20260519_494_module_progression_fields` created
`CurriculumModule.coversModules` as `NOT NULL DEFAULT ARRAY[]::TEXT[]`.
schema.prisma declared a bare `String[]`. A later `prisma migrate dev` diff
saw "schema has no default, database does" and emitted `DROP DEFAULT`.

The column was left `NOT NULL` with no default. Every writer that omitted it
then failed with `P2011` — `lib/curriculum/sync-modules.ts`,
`app/api/curricula/[curriculumId]/modules/route.ts`, and
`prisma/seed-demo-course.ts`, where it surfaced as a seed failure months
later. Confirmed on hf_sandbox *and* hf_staging.

The audit that followed found **23 more** scalar lists in the same state.
All are fixed in the same PR as this rule; the gate sits at zero rather than
ratcheting debt.

## Severity is not uniform

Worth understanding before triaging a failure:

| Column shape | Omitting the field | Severity |
|---|---|---|
| `NOT NULL`, no default | throws `P2011` | breaks writes — the `coversModules` case |
| nullable, no default | inserts `NULL` | NULL-vs-empty-array inconsistency; reads may not expect it |

The 23 found in the #2332 audit were all **nullable**, so they degraded
quietly rather than failing. Same drift class, lower severity. Do not assume
a gap here is as urgent as `coversModules` was — check nullability first.

## Why this invariant, and not migration-SQL parsing

The obvious gate is "cross-reference migration DDL against the schema". It is
brittle: defaults appear inline in `CREATE TABLE`, in `ADD COLUMN`, and in
`ALTER COLUMN SET DEFAULT`, and can be legitimately dropped later.

The root cause is simpler and lives in one file. A scalar list with no
`@default` is a column whose database default Prisma may delete. Requiring
the declaration fixes the cause instead of detecting the symptom, and the
check is a single pass over schema.prisma.

## On exempting

`SCALAR_LIST_DEFAULT_EXEMPT` is empty by design. An entry means "this column
may lose its database default without warning", which is rarely what anyone
wants. "We haven't got to it" is not a reason — the fix is one line.

## When a gap appears

1. Add `@default([])` to the field in schema.prisma.
2. Write a migration re-asserting `ALTER COLUMN ... SET DEFAULT` so existing
   databases are repaired — the schema change alone fixes future diffs but
   not databases already drifted.
3. Do **not** change nullability in the same pass. `SET NOT NULL` requires
   proving no NULL rows exist first; that is a separate decision.
4. Run `npx vitest run tests/lib/schema/scalar-list-default-coverage.test.ts`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `tests/lib/schema/scalar-list-default-coverage.test.ts` (2026-09-24) | 8 vitests: parse floor, relation-list exclusion, gap check, exempt ratchet, non-empty reason, non-stale exempt, no-contradiction, distribution | A scalar list shipping without a default, so Prisma drops its DB default at the next diff |
| `prisma/migrations/20260924100000_2332_scalar_list_defaults` | Restores `SET DEFAULT` on 23 already-drifted columns | Databases that drifted before the schema was fixed |
| `prisma/migrations/20260923150000_2331_restore_coversmodules_default` | Same, for the two columns that surfaced the class | The original incident |

## Related

- [`tests/lib/schema/scalar-list-default-coverage.test.ts`](../../apps/admin/tests/lib/schema/scalar-list-default-coverage.test.ts) — the gate
- [`apps/admin/prisma/schema.prisma`](../../apps/admin/prisma/schema.prisma) — source of truth
- [`.claude/rules/caller-delete-coverage.md`](./caller-delete-coverage.md) — sibling Coverage gate
- Story [#2332](https://github.com/WANDERCOLTD/HF/issues/2332)
- PR #2331 — the `coversModules` incident that exposed the class

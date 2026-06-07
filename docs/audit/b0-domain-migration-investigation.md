# B0 — Domain table migration debt: investigation findings

Status: investigation only. No implementation.

Context: `.github/workflows/test.yml` line 188 currently runs `npx prisma migrate deploy` with `continue-on-error: true`. The flag exists because migration `20260213_expand_user_roles` adds a FK from `User.assignedDomainId` to `Domain.id`, but `Domain` has no `CREATE TABLE` migration anywhere — it was originally created by `prisma db push` on long-running envs. On a fresh CI DB the FK fails because Domain doesn't exist, which cascades into every subsequent migration not running. The PR-level pain is real: integration tests then run against a partial schema. Removing the flag is the goal of B0.

## How many migrations touch Domain?

8 migrations reference `Domain` or `DomainKind`. All are ALTER / ADD COLUMN / ADD CONSTRAINT — **none CREATE the table**. Chronological order, with what each does:

| Migration | Operation |
|---|---|
| `20260213_expand_user_roles` | FK `User.assignedDomainId → Domain.id` (where the cascade fails on fresh DB) |
| `20260214_add_caller_roles_and_cohorts` | FK `CohortGroup.domainId → Domain.id` |
| `20260215_add_media_delivery` | FK `ChannelConfig.domainId → Domain.id` |
| `20260220_add_institution_type_table` | `CREATE TYPE "DomainKind"` (enum) + `InstitutionType.defaultDomainKind` column |
| `20260222_add_domain_kind_column` | `ALTER TABLE "Domain" ADD COLUMN "kind"` |
| `20260225_community_config` | `ALTER TABLE "Domain" ADD COLUMN "config"` |
| `20260302_add_lesson_plan_defaults` | `ALTER TABLE "Domain" ADD COLUMN "lessonPlanDefaults"` |
| `20260525_825_compose_inputs_updated_at` | `ALTER TABLE "Domain" ADD COLUMN "composeInputsUpdatedAt"` |

## What Domain looked like at 2026-02-13 (the FK reference point)

By back-subtracting the four later `ADD COLUMN` migrations from the current schema, Domain at the moment `20260213_expand_user_roles` runs needs to have:

```
id                          TEXT PRIMARY KEY
slug                        TEXT UNIQUE NOT NULL
name                        TEXT NOT NULL
description                 TEXT NULL
isDefault                   BOOLEAN NOT NULL DEFAULT false
isActive                    BOOLEAN NOT NULL DEFAULT true
onboardingWelcome           TEXT NULL
onboardingIdentitySpecId    TEXT NULL                   -- ⚠ FK target may not exist yet (see below)
onboardingFlowPhases        JSONB NULL
onboardingDefaultTargets    JSONB NULL
institutionId               TEXT NULL                   -- ⚠ FK target does not exist yet (see below)
createdAt                   TIMESTAMP NOT NULL DEFAULT NOW()
updatedAt                   TIMESTAMP NOT NULL
```

Indexes that subsequent code/schema assumes exist by then: `slug`, `isDefault`, `isActive`, `onboardingIdentitySpecId`, `institutionId`. (The `kind` index comes later with the column.)

## FK ordering landmines

Two of Domain's fields point at tables whose own `CREATE TABLE` is later than 20260213:

| Domain field | Target | First CREATE TABLE migration |
|---|---|---|
| `onboardingIdentitySpecId` | `AnalysisSpec.id` | **no CREATE TABLE anywhere** — also `db push`'d, same class of debt |
| `institutionId` | `Institution.id` | `20260215_add_institution_branding` (2 days after) |

Neither FK exists in the current schema as enforced — both fields are declared as plain `String?` in `prisma/schema.prisma` and the `@relation` is the only thing that knows about them. Prisma will only emit the FK constraint when generating a migration that adds it; no such migration was ever generated. So **the backfill just needs the columns, not the FK constraints**. Existing envs (where Domain was `db push`'d) don't have those FKs either, which is consistent.

## Recommended fix shape (not implementing yet)

One new migration named `20260212_backfill_create_domain` (sorts immediately before `20260213_expand_user_roles`). All SQL idempotent via `IF NOT EXISTS`:

```sql
-- 20260212_backfill_create_domain/migration.sql
CREATE TABLE IF NOT EXISTS "Domain" (
  "id"                       TEXT NOT NULL,
  "slug"                     TEXT NOT NULL,
  "name"                     TEXT NOT NULL,
  "description"              TEXT,
  "isDefault"                BOOLEAN NOT NULL DEFAULT false,
  "isActive"                 BOOLEAN NOT NULL DEFAULT true,
  "onboardingWelcome"        TEXT,
  "onboardingIdentitySpecId" TEXT,
  "onboardingFlowPhases"     JSONB,
  "onboardingDefaultTargets" JSONB,
  "institutionId"            TEXT,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Domain_slug_key"               ON "Domain"("slug");
CREATE INDEX        IF NOT EXISTS "Domain_isDefault_idx"          ON "Domain"("isDefault");
CREATE INDEX        IF NOT EXISTS "Domain_isActive_idx"           ON "Domain"("isActive");
CREATE INDEX        IF NOT EXISTS "Domain_onboardingIdentitySpecId_idx" ON "Domain"("onboardingIdentitySpecId");
CREATE INDEX        IF NOT EXISTS "Domain_institutionId_idx"      ON "Domain"("institutionId");
```

### Why this is safe on existing envs

- `_prisma_migrations` table on hf_sandbox / hf_dev / hf_staging / pilot / prod does NOT have `20260212_backfill_create_domain`. `prisma migrate deploy` will try to apply it.
- Domain already exists (was `db push`'d). `CREATE TABLE IF NOT EXISTS` is a no-op, and so are all the `CREATE INDEX IF NOT EXISTS` lines.
- `_prisma_migrations` gains a row recording the migration as applied. Future `migrate deploy` runs are idempotent.

### Why this works on CI (the fresh-DB case)

- `prisma migrate deploy` applies migrations in directory-name lex order.
- `20260212_backfill_create_domain` runs first, creates Domain.
- `20260213_expand_user_roles` runs next, the `User.assignedDomainId → Domain.id` FK resolves.
- Every subsequent migration that ALTERs Domain finds the table waiting.

### Why we do NOT need to touch the FKs to Institution / AnalysisSpec

The current schema doesn't declare those FKs as physical constraints — Prisma never generated them, so they're not in any migration. The backfill just creates the columns. If a future PR wants the FKs, that's a separate migration after Institution exists.

## After the backfill lands

Remove `continue-on-error: true` from `.github/workflows/test.yml` line 188 (the `Run Prisma migrations` step). Also consider the same for line 192 (`Seed specs`) — seeds will only succeed if migrate succeeds, so the flag is redundant once migrate is real. Leave line 196 (`Run integration tests`) alone for now — the existing test debt that produces those failures is outside B0 scope.

## Risk summary

| Risk | Severity | Mitigation |
|---|---|---|
| Existing env disagrees with `IF NOT EXISTS` (column drift between db-push'd state and the backfill SQL) | Low | Run `prisma db pull` against hf_sandbox before drafting the SQL, diff against the recommended shape above, adjust if drift exists |
| `_prisma_migrations` ordering check rejects the early-dated migration | Low | Prisma applies missing-from-DB migrations without strict order verification; sequence guarantees only matter for fresh applies, where this works |
| Future `prisma migrate diff` confused by the inserted history | Low | The schema doesn't change — just adds a migration that brings history in line with what `prisma db push` did. Schema and migrations align after this lands. |
| Side effect on `prisma migrate dev` workflows | Low | `migrate dev` re-applies all from scratch — backfill creates Domain cleanly. |
| AnalysisSpec missing CREATE TABLE migration (same debt class) | Medium | **Not in B0 scope** — B0 is specifically about unblocking `migrate deploy` for CI. AnalysisSpec is referenced by Domain.onboardingIdentitySpecId as a column-only, no FK constraint. CI doesn't fail on AnalysisSpec today. Track as separate debt. |

## Verification plan (before merging the eventual fix)

1. Run `prisma db pull` against hf_sandbox, diff Domain shape against the recommended SQL, reconcile.
2. On a fresh local Postgres: `prisma migrate deploy` from scratch — confirm exit 0, confirm schema matches `prisma db pull` output.
3. On a clone of hf_sandbox: `prisma migrate deploy` — confirm idempotent (no errors, `_prisma_migrations` gains exactly one row).
4. CI: remove `continue-on-error: true` from `Run Prisma migrations` step in `.github/workflows/test.yml`. Confirm subsequent CI runs go green on migrate.
5. Smoke: confirm integration tests still run (they were continue-on-error too, but seed had to succeed).

## Estimated cost

- 1 new migration file, ~30 lines of SQL
- 1 line removed from test.yml
- Verification = run prisma db pull + diff + clone-and-test (~1h)
- Total: ~2h, low blast radius

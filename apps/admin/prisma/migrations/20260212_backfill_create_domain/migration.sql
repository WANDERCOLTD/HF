-- B0 / audit-fix Track A retroactive: backfill the CREATE TABLE for "Domain".
--
-- Domain was originally created via `prisma db push` on long-running envs,
-- so no migration here ever produced the table. On a fresh CI Postgres,
-- migration `20260213_expand_user_roles` tries to add the FK
-- `User.assignedDomainId → Domain.id` and fails because the target table
-- doesn't exist. That cascade is why `npx prisma migrate deploy` runs with
-- `continue-on-error: true` in `.github/workflows/test.yml` — the lint
-- job's tsc step inherits a partially-migrated schema. This migration
-- closes the hole.
--
-- Schema reconstructed from `\d "Domain"` against hf_sandbox, SUBTRACTING
-- columns added later by:
--   20260222_add_domain_kind_column         → `kind`
--   20260225_community_config               → `config`
--   20260302_add_lesson_plan_defaults       → `lessonPlanDefaults`
--   20260525_825_compose_inputs_updated_at  → `composeInputsUpdatedAt`
-- Those later ALTERs continue to apply unchanged after this lands.
--
-- FK constraints intentionally omitted:
--   * `Domain_institutionId_fkey` → Institution: Institution is created in
--     20260215_add_institution_branding, AFTER this migration runs. The
--     column exists; the constraint is added on existing envs only via
--     the original db push. Existing envs keep the FK; fresh envs don't
--     get one. No code path depends on FK enforcement here.
--   * `Domain_onboardingIdentitySpecId_fkey` → BddFeature/AnalysisSpec:
--     same reasoning. The table was renamed in
--     20260119193551_rename_bdd_to_analysis_spec but the live-DB FK
--     constraint still references "BddFeature" (pre-existing artifact
--     of the rename not propagating to the constraint name+target).
--     Out of scope for this backfill.
--
-- All statements idempotent (IF NOT EXISTS). Existing envs replay this
-- as a no-op and just gain a `_prisma_migrations` row.

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

CREATE UNIQUE INDEX IF NOT EXISTS "Domain_slug_key"                    ON "Domain"("slug");
CREATE INDEX        IF NOT EXISTS "Domain_slug_idx"                    ON "Domain"("slug");
CREATE INDEX        IF NOT EXISTS "Domain_isDefault_idx"               ON "Domain"("isDefault");
CREATE INDEX        IF NOT EXISTS "Domain_isActive_idx"                ON "Domain"("isActive");
CREATE INDEX        IF NOT EXISTS "Domain_onboardingIdentitySpecId_idx" ON "Domain"("onboardingIdentitySpecId");
CREATE INDEX        IF NOT EXISTS "Domain_institutionId_idx"           ON "Domain"("institutionId");

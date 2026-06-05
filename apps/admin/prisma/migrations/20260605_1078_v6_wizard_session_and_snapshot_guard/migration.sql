-- #1078 — V6 Wizard Phase 1 spike
--
-- Two things in one migration (they ship together because rollback as a unit):
--   1. WizardSession table + WizardSessionStatus enum
--   2. Trigger guarding Playbook.config.__v6 writes
--
-- The trigger is the third layer of the structural-guard defence
-- (ESLint → application-layer assertion → DB trigger). It fires only
-- when the row's `config.__v6` key changes, and only rejects writes
-- that are missing the `hf.v6_projector` session marker set by
-- `lib/wizard-v6/projector.ts` via `SET LOCAL` inside `prisma.$transaction`.
--
-- Writes to other parts of `config` are not affected (no marker required).
-- The existing `add_playbook_count_triggers.sql` trigger on PlaybookItem
-- does not touch this code path.
--
-- See ADR docs/decisions/2026-06-02-v6-wizard-on-crawcusspec.md
-- and issue #1078 § "B — Structural guards: three-layer defence".

-- ─────────────────────────────────────────────────────────────────────
-- 1. WizardSession table + enum
-- ─────────────────────────────────────────────────────────────────────

CREATE TYPE "WizardSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

CREATE TABLE "WizardSession" (
  "id"          TEXT NOT NULL,
  "playbookId"  TEXT NOT NULL,
  "specKey"     TEXT NOT NULL,
  "specVersion" INTEGER NOT NULL,
  "status"      "WizardSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WizardSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WizardSession_playbookId_status_idx"
  ON "WizardSession"("playbookId", "status");

CREATE INDEX "WizardSession_specKey_specVersion_idx"
  ON "WizardSession"("specKey", "specVersion");

ALTER TABLE "WizardSession"
  ADD CONSTRAINT "WizardSession_playbookId_fkey"
  FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Playbook.config.__v6 write guard trigger
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_v6_snapshot_write() RETURNS TRIGGER AS $$
DECLARE
  marker TEXT;
BEGIN
  -- Short-circuit: if neither old nor new touches __v6, this trigger
  -- has nothing to enforce. Lets the non-V6 PlaybookConfig write path
  -- (95% of `Playbook.config` traffic today) continue without a marker.
  IF NEW."config" -> '__v6' IS NULL THEN
    RETURN NEW;
  END IF;

  -- current_setting(name, missing_ok) — `true` returns NULL if the GUC
  -- is unset for this transaction. `SET LOCAL` is transaction-scoped,
  -- so a marker set via `tx.$executeRawUnsafe('SET LOCAL hf.v6_projector = ...')`
  -- inside `prisma.$transaction` is visible here for the duration of
  -- that transaction.
  marker := current_setting('hf.v6_projector', true);

  IF marker IS NULL OR marker = '' THEN
    RAISE EXCEPTION
      'V6 snapshot write outside projector — call lib/wizard-v6/projector.ts'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER playbook_v6_snapshot_guard
  BEFORE UPDATE ON "Playbook"
  FOR EACH ROW
  WHEN (NEW."config" IS DISTINCT FROM OLD."config")
  EXECUTE FUNCTION enforce_v6_snapshot_write();

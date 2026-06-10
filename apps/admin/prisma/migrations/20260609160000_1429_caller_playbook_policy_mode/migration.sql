-- #1429 — CallerPlaybook.policyMode
--
-- Additive: existing rows get the column default 'production' on apply.
-- Allowed values are a TS literal string union ("demo" | "production"),
-- intentionally NOT a Prisma enum — keeps a future "evaluation" / "pilot"
-- mode as a one-line schema diff, not a follow-on enum-add migration.
--
-- The composite index `(playbookId, policyMode, status)` matches the hot
-- read path of `lib/compose/eager-reprompt-on-bump.ts::triggerDemoRepromptFanout`
-- (and the new `staleness-aggregate` route): filter ACTIVE demo callers
-- for a single playbookId. Without it, fan-out would seq-scan
-- CallerPlaybook every time an educator hits Save.
ALTER TABLE "CallerPlaybook"
  ADD COLUMN "policyMode" TEXT NOT NULL DEFAULT 'production';

CREATE INDEX IF NOT EXISTS "CallerPlaybook_playbookId_policyMode_status_idx"
  ON "CallerPlaybook" ("playbookId", "policyMode", "status");

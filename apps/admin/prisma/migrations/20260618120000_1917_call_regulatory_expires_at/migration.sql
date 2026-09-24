-- #1917 (epic #1915 §6a I-PR3) — regulatory expiry column on Call.
--
-- Adds Call.regulatoryExpiresAt as a NULLABLE timestamp. Future writes
-- through `lib/privacy/stamp-regulatory-expiry.ts` populate it from the
-- preset in effect (or `RETENTION_CALLER_DATA_DAYS` env fallback). The
-- retention cleanup cron (`POST /api/admin/retention/cleanup`) extends
-- its WHERE clause to delete rows where regulatoryExpiresAt <= NOW().
--
-- Backfill = NULL (intentional, per TL guidance):
--   1. The preset-in-effect at original call-time is unknowable for
--      historical rows. Computing `createdAt + RETENTION_CALLER_DATA_DAYS`
--      picks the WRONG retention window for any caller enrolled before
--      the env var was set or who was on a different preset cohort.
--   2. If the preset later changes (e.g., domain switches to GDPR-EU
--      from Basic), already-stamped retroactive dates create reconciliation
--      drift — some rows expire under one policy, others under another.
--   3. DSR-pending callers who requested deletion get their data
--      EXTENDED by a retroactive stamp.
--
-- NULL is the safe identity element. The existing caller-level cleanup
-- in `POST /api/admin/retention/cleanup` still applies to legacy rows
-- (deletes the entire caller after activity goes dormant past the env
-- threshold). Row-level expiry purge applies only to rows with a
-- non-NULL `regulatoryExpiresAt`.
--
-- Naming discipline: column is `regulatoryExpiresAt`, NOT `retentionExpiry`
-- or `expiresAt`. `CallerMemory.expiresAt` already exists for content
-- decay ("traveling next week") — silent conflation is the failure mode
-- this naming explicitly prevents (CHAIN-CONTRACTS.md §6a I-PR3).

ALTER TABLE "Call"
  ADD COLUMN "regulatoryExpiresAt" TIMESTAMP(3);

-- Indexed for the retention-cleanup WHERE filter. Partial index
-- (WHERE column IS NOT NULL) keeps the index small — NULL rows are
-- the historical / unstamped majority during the rollout window.
CREATE INDEX "Call_regulatoryExpiresAt_idx"
  ON "Call" ("regulatoryExpiresAt")
  WHERE "regulatoryExpiresAt" IS NOT NULL;

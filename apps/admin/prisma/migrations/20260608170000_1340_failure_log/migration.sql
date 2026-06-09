-- #1340 (epic #1338 Slice 1) — FailureLog table for ghost-detection
-- and outbound-dial error branches.
--
-- Additive on Slice 0 (`20260608165135_1341_session_schema`). The new
-- table is empty on apply; the back-relation on Session ships in the
-- Prisma schema only (no DDL change to the Session table itself).
--
-- Idempotency: every CREATE / CREATE INDEX is gated on
-- `IF NOT EXISTS` so a partial re-run is safe.

-- =================================================================
-- FailureLog parent table (child of Session, cascade on session delete).
-- =================================================================
CREATE TABLE IF NOT EXISTS "FailureLog" (
    "id"            TEXT NOT NULL,
    "sessionId"     TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "errorPayload"  JSONB NOT NULL,
    "occurredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailureLog_pkey" PRIMARY KEY ("id")
);

-- Three indexes for the three observed read shapes:
--   sessionId — "what failed for this Session?" (Tune tab card)
--   kind      — "how many GHOST_NEVER_CONNECTED in the last 24h?" (ops)
--   occurredAt — chain-of-custody hash-chain ordering (audit-bundle)
CREATE INDEX IF NOT EXISTS "FailureLog_sessionId_idx"  ON "FailureLog"("sessionId");
CREATE INDEX IF NOT EXISTS "FailureLog_kind_idx"       ON "FailureLog"("kind");
CREATE INDEX IF NOT EXISTS "FailureLog_occurredAt_idx" ON "FailureLog"("occurredAt");

-- FK to Session. ON DELETE CASCADE: pruning a Session drops its failure
-- log children — they are valueless without the parent. ON UPDATE
-- CASCADE matches the rest of the schema's FK conventions.
ALTER TABLE "FailureLog"
    ADD CONSTRAINT "FailureLog_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

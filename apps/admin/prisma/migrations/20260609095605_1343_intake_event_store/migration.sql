-- #1343 (epic #1338 Slice 2) — Intake event store + Session.intentId cross-link.
--
-- ADDITIVE migration. Two changes:
--   1. CREATE TABLE `intake_event` — durable hash-chained event log for
--      the Tallyseal intake spike. Owned by
--      `lib/intake/prisma-event-store.ts::PrismaEventStore`.
--   2. ADD COLUMN `Session.intentId` (TEXT NULL) — soft FK linking a
--      committed `Session(kind=ENROLLMENT)` row to the `IntakeEvent`
--      chain that produced it. Read by the Tune tab to render Q&A.
--
-- Idempotency: pure CREATE / ADD on new structure, no data writes — safe
-- to re-run via `_prisma_migrations` (Prisma's contract).

-- =================================================================
-- Step 1 — CREATE TABLE `intake_event`.
-- =================================================================
CREATE TABLE "intake_event" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "prevHash" TEXT,
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_event_pkey" PRIMARY KEY ("id")
);

-- Monotonic per-intent version. (intentId, version) is the natural key.
CREATE UNIQUE INDEX "intake_event_intentId_version_key"
    ON "intake_event" ("intentId", "version");

-- Fast `readChain(intentId)` scan.
CREATE INDEX "intake_event_intentId_idx" ON "intake_event" ("intentId");

-- =================================================================
-- Step 2 — ADD COLUMN `Session.intentId` (soft FK).
-- =================================================================
ALTER TABLE "Session" ADD COLUMN "intentId" TEXT;

CREATE INDEX "Session_intentId_idx" ON "Session" ("intentId");

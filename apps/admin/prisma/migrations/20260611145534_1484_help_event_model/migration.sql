-- #1484 (Epic #1442 Layer 3 Slice 3) — HelpEvent telemetry model.
--
-- Lightweight operator help-surface telemetry: doc views, cascade-inspector
-- open/close, Cmd+K /demo fires. Drives Slice 4 favourites + future Cmd+K
-- prioritisation; no UI depends on this table existing before the migration
-- lands (the API route's fire-and-forget writer swallows DB errors, and the
-- admin telemetry aggregate view renders an empty table when zero rows).
--
-- Additive only — no NOT-NULL backfills, no FK constraints to existing
-- tables. `userId` / `callerId` are correlation hints only and intentionally
-- have NO foreign keys so a telemetry row survives the deletion of the user
-- or caller it was recorded against. `role` is stored as TEXT (not the
-- `UserRole` enum) to decouple from future role renames.
--
-- The two composite indexes match the two hot read paths:
--   1. last-7d aggregate by (type, target) — driven by `(type, createdAt)`
--   2. per-user history rendered on a future "your activity" view —
--      driven by `(userId, createdAt)`.
CREATE TABLE "HelpEvent" (
  "id"         TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "target"     TEXT NOT NULL,
  "role"       TEXT,
  "userId"     TEXT,
  "callerId"   TEXT,
  "success"    BOOLEAN,
  "durationMs" INTEGER,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HelpEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HelpEvent_type_createdAt_idx"
  ON "HelpEvent" ("type", "createdAt");

CREATE INDEX "HelpEvent_userId_createdAt_idx"
  ON "HelpEvent" ("userId", "createdAt");

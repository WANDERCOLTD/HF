-- Drop legacy `CallScore_callId_parameterId_key` unique INDEX.
--
-- Slice 1.2 (`20260519_491_callscore_module_id`) intended to drop the
-- old `@@unique([callId, parameterId])` enforcement as part of
-- migrating to `@@unique([callId, parameterId, moduleId])`. That
-- migration used `DROP CONSTRAINT IF EXISTS` — but on some upgrade
-- paths the original uniqueness was created as a plain unique INDEX
-- (not a CONSTRAINT). `DROP CONSTRAINT IF EXISTS` silently skipped
-- those rows.
--
-- Observed on hf-dev DB on 2026-05-20: per-segment CallScore writes
-- for Mock-style calls (#550 Slice 1.5) failed with P2002 because
-- the legacy `(callId, parameterId)` unique index still rejected
-- the second skill_* row even when the new (callId, parameterId,
-- moduleId) row would have been distinct.
--
-- This migration is idempotent — it's a no-op on any DB where the
-- legacy index was correctly dropped via the Slice 1.2 path.

DROP INDEX IF EXISTS "CallScore_callId_parameterId_key";

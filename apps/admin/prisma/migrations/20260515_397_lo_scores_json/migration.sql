-- #397 Phase 1 — per-LO running average for module mastery.
--
-- Adds a nullable JSONB column to CallerModuleProgress storing per-LO
-- accumulated mastery so the module-level `mastery` value can be derived
-- from real LO progress rather than overwritten by the AI's per-call snapshot.
--
-- Shape:
--   { [loRef: string]: { mastery: number, callCount: number } }
--
-- Phase 1 is additive only. Existing rows keep NULL; the rollup falls back
-- to the existing AI-snapshot `mastery` value until the first post-deploy
-- call populates the column. No data migration, no row UPDATEs.
--
-- See https://github.com/WANDERCOLTD/HF/issues/397 for the full plan.

ALTER TABLE "CallerModuleProgress" ADD COLUMN "loScoresJson" JSONB;

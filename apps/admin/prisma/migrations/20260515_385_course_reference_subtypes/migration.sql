-- #385 Slice 1 — DocumentType subtypes for COURSE_REFERENCE.
--
-- Splits the coarse COURSE_REFERENCE type into three audience-scoped
-- subtypes so the projection / loaders / classifier can route content
-- by source provenance rather than relying on AI classification alone.
-- See https://github.com/WANDERCOLTD/HF/issues/385 for the full design.
--
-- Phase 1: additive only. No row UPDATEs in this migration.
-- Existing COURSE_REFERENCE rows remain valid. Classifier producers and
-- reader sweep land in subsequent phases.
--
-- Postgres requires ALTER TYPE ADD VALUE to be its own statement (not
-- in a transaction with subsequent uses of the new value). Each ADD
-- runs as its own implicit transaction. The IF NOT EXISTS clause makes
-- this migration idempotent for re-runs.

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'COURSE_REFERENCE_CANONICAL';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'COURSE_REFERENCE_TUTOR_BRIEFING';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'COURSE_REFERENCE_ASSESSOR_RUBRIC';

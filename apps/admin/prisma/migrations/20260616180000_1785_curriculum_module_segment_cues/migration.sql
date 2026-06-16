-- #1785 — Course-agnostic Mock segmentation cues.
--
-- `CurriculumModule.segmentCues` is a per-sub-module array of tutor cue
-- phrases (or regex fragments) used by `lib/curriculum/segment-mock-transcript.ts`
-- to detect where THIS sub-module's segment begins in a multi-part Mock
-- transcript. Default `[]` so the reader's fallback (`\bslug\b` regex)
-- governs every existing row until a seed populates the column.
--
-- Additive + safe-default. No rewrites of existing rows; no unique-key
-- changes; no CHECK constraints. Matches the #494 `coversModules`
-- column pattern.

ALTER TABLE "CurriculumModule"
  ADD COLUMN IF NOT EXISTS "segmentCues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

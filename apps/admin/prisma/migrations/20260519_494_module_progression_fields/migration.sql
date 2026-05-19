-- #494 E2 Slice 2.4 — per-module progression fields.
--
-- Adds two new columns to CurriculumModule so module-mastery progression
-- (terminal-module course-complete + Mock-covers-part1/2/3 attribution) is
-- backed by real columns instead of defensive `(module as any)` reads:
--
--   * `terminal`       — course-complete trigger when
--                        Playbook.config.completionMode === "terminal-only".
--   * `coversModules`  — slug list of modules whose evidence this module's
--                        calls ALSO count toward (Mock covers part1/2/3).
--
-- `masteryThreshold` (Float?) and `prerequisites` (text[]) already exist on
-- CurriculumModule from earlier slices — only the two new columns are added
-- here.
--
-- Safe to run on a populated prod DB:
--   * Both columns use IF NOT EXISTS.
--   * `terminal` is NOT NULL with a literal default (false), so existing
--     rows backfill to false without a separate UPDATE.
--   * `coversModules` is NOT NULL with default `{}::text[]` — Prisma's
--     standard pattern for String[] columns. Existing rows backfill to []
--     automatically.

ALTER TABLE "CurriculumModule"
  ADD COLUMN IF NOT EXISTS "terminal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CurriculumModule"
  ADD COLUMN IF NOT EXISTS "coversModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

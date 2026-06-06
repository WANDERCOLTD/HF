-- Drop dead Curriculum JSON columns (#306).
--
-- HISTORY: restored 2026-06-06 (chore/ci-greening). Created in feat
-- commit 78e9aa25 on May 8 2026 and applied to long-running hf-dev
-- and hf-sandbox DBs at that time, but the migration file was lost
-- when Part B of #306 squash-merged into main (the schema.prisma
-- changes shipped, the migration directory didn't). Restoring the
-- file makes prisma migrate status drift-clean on those DBs.
-- Idempotent — every DROP uses IF EXISTS, so safe to re-apply on
-- fresh databases as well as existing ones where columns are gone.
--
-- These columns were written by `prisma/seed-from-specs.ts` and the lab
-- feature-activate route, but read by nothing in the prompt pipeline,
-- API, or UI. Module structure and discussion content are held in
-- first-class CurriculumModule + LearningObjective rows; misconceptions
-- and case studies were never surfaced to learners.
--
-- Reversible: re-add the columns and re-run the writers if needed.
-- Data is not preserved (the columns weren't read, so no information is lost
-- from the user-facing system).

ALTER TABLE "Curriculum" DROP COLUMN IF EXISTS "coreArgument";
ALTER TABLE "Curriculum" DROP COLUMN IF EXISTS "caseStudies";
ALTER TABLE "Curriculum" DROP COLUMN IF EXISTS "discussionQuestions";
ALTER TABLE "Curriculum" DROP COLUMN IF EXISTS "critiques";

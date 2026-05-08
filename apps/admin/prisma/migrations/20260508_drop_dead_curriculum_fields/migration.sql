-- Drop dead Curriculum JSON columns (#306).
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

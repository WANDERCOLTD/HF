-- Issue #317 follow-up — add TEACHING_INSTRUCTION to LoSystemRole.
--
-- Captures LOs that are tutor-strategic moves / diagnostics / intervention
-- rules. They join the courseInstructions channel (alongside the
-- ContentAssertion-sourced rules from COURSE_REFERENCE docs) rather than
-- the rubric or score-explainer surfaces.
--
-- Additive enum value — safe for existing rows. No data migration needed
-- until the next reclassify pass runs.

-- AlterEnum
ALTER TYPE "LoSystemRole" ADD VALUE 'TEACHING_INSTRUCTION';

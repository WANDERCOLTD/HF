-- #155 scheduler v1: per-LO mastery threshold override.
-- Null = inherit from CurriculumModule.masteryThreshold.
ALTER TABLE "LearningObjective" ADD COLUMN "masteryThreshold" DOUBLE PRECISION;

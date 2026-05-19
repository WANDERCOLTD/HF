-- #500 PR-1: add structured config bag to Parameter
-- Holds bandThresholds map (band number → descriptor text) for SKILL
-- parameters that wrap a graded rubric (IELTS, CEFR, NHS AfC, etc.).
-- Future-proofed as a JSON column so additional config keys can be added
-- without further migrations. Pattern mirrors AnalysisSpec.config,
-- Playbook.config, Goal.assessmentConfig. See lib/types/json-fields.ts::ParameterConfig.
-- Nullable, no default — backfill is not required.
ALTER TABLE "Parameter" ADD COLUMN IF NOT EXISTS "config" JSONB;

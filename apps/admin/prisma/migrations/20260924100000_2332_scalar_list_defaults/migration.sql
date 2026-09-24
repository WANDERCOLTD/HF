-- #2332 — restore array defaults on every Prisma scalar-list column.
--
-- Root cause, same as the `CurriculumModule.coversModules` incident:
-- a migration grants a column `DEFAULT ARRAY[]::TEXT[]`, but schema.prisma
-- declares the field as a bare `String[]` with no `@default([])`. The next
-- Prisma diff sees "schema has no default, DB does" and emits DROP DEFAULT.
-- The column is then left with no default and nothing warns.
--
-- Measured on hf_sandbox 2026-09-24 via information_schema: all columns
-- below had `column_default = NULL`. `PlaybookSource.tags` did NOT — it is
-- the one scalar list that already carried `@default(["content"])` in
-- schema.prisma, which is exactly the mechanism this migration restores.
--
-- Severity note: unlike `coversModules` (NOT NULL, so omitting it threw
-- P2011), every column below is NULLABLE. Omitting them inserted NULL
-- rather than failing. This is the same drift CLASS at lower severity —
-- a NULL-vs-empty-array inconsistency, not a write error.
--
-- Nullability is deliberately NOT touched here. Setting NOT NULL would
-- require proving no NULL rows exist first; that is a separate decision.
--
-- Idempotent: SET DEFAULT is a no-op when the default already matches.
-- Paired with `@default([])` on all 29 scalar lists in schema.prisma, which
-- is what stops the next diff dropping them again.

ALTER TABLE "Parameter" ALTER COLUMN "enrichmentChunkIds" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ContentSource" ALTER COLUMN "authors" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ContentSource" ALTER COLUMN "moduleCoverage" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CurriculumModule" ALTER COLUMN "prerequisites" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CurriculumModule" ALTER COLUMN "keyTerms" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CurriculumModule" ALTER COLUMN "assessmentCriteria" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ContentAssertion" ALTER COLUMN "figureRefs" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MediaAsset" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ContentQuestion" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ContentVocabulary" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "BehaviorMeasurement" ALTER COLUMN "evidence" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Session" ALTER COLUMN "skipStages" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CallScore" ALTER COLUMN "evidence" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Curriculum" ALTER COLUMN "authors" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ParameterScoringAnchor" ALTER COLUMN "positiveSignals" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ParameterScoringAnchor" ALTER COLUMN "negativeSignals" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PipelineStep" ALTER COLUMN "sectionsActivated" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PipelineStep" ALTER COLUMN "sectionsSkipped" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Ticket" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UserTask" ALTER COLUMN "completedSteps" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UserTask" ALTER COLUMN "blockers" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ContentAssertion" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ConversationArtifact" ALTER COLUMN "contentAssertionIds" SET DEFAULT ARRAY[]::TEXT[];

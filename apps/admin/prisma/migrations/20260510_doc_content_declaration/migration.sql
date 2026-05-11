-- Front-matter content declarations on ContentSource.
--
-- Adds a JSONB column `contentDeclaration` for storing parsed markdown
-- front-matter declarations (hf-document-type, hf-audience, hf-lo-system-role,
-- hf-default-category, hf-question-assessment-use) at upload time. The
-- declaration is consulted at extraction + LO classification + question
-- creation as an override on top of AI inference.
--
-- Additive only — existing rows get NULL, all current callers tolerate
-- the field being absent. No data migration needed.
--
-- See lib/content-trust/parse-content-declaration.ts for the in-memory
-- shape and docs/CONTENT-PIPELINE.md §3 + §6 for how declarations slot
-- into the classification taxonomy.

ALTER TABLE "ContentSource" ADD COLUMN "contentDeclaration" JSONB;

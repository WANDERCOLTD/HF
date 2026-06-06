-- #1192 — drop redundant Curriculum.slug index.
--
-- Curriculum.slug already has @unique (line 2385), which creates an implicit
-- unique index. The explicit @@index([slug]) was creating a second, redundant
-- non-unique index on the same column. Drop it.
--
-- Idempotent.
DROP INDEX IF EXISTS "Curriculum_slug_idx";

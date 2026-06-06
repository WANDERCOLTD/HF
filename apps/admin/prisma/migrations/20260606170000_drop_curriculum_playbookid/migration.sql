-- #1177 Slice 6 / #1038 — drop the deprecated Curriculum.playbookId column.
--
-- Ownership of a Curriculum by a Playbook is now expressed exclusively
-- through `PlaybookCurriculum` (role: 'primary' | 'linked'). The
-- 20260606152557 backfill ensured every historical Curriculum has a
-- canonical primary join row; all read sites have been migrated to use
-- it (Slices 1-5); all write sites have stopped setting the column in
-- this same PR.
--
-- Drops in order:
--   1. The FK constraint (Curriculum_playbookId_fkey)
--   2. The @@index([playbookId]) we declared in the Prisma model
--   3. The column itself
--
-- All operations are idempotent via IF EXISTS so re-application is a no-op.

ALTER TABLE "Curriculum"
  DROP CONSTRAINT IF EXISTS "Curriculum_playbookId_fkey";

DROP INDEX IF EXISTS "Curriculum_playbookId_idx";

ALTER TABLE "Curriculum"
  DROP COLUMN IF EXISTS "playbookId";

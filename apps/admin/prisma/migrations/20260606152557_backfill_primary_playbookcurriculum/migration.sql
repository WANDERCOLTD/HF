-- Batch 2 / Step 1 — backfill missing PlaybookCurriculum(role:'primary') rows.
--
-- After #1212 (orphan-create fix) all NEW Curriculum.create calls land with
-- the canonical primary join row in the same transaction. This migration
-- closes the gap for HISTORICAL rows minted by the (now-fixed) routes that
-- only wrote the deprecated Curriculum.playbookId FK.
--
-- Idempotent: NOT EXISTS guard skips any pair already linked. Safe to re-run.
-- Skips rows whose playbookId points at a Playbook that no longer exists
-- (would otherwise fail the FK).
--
-- Companion to:
--   - issues #1202/#1203/#1204 (orphan-create routes fixed)
--   - docs/CONTRACTS-PLAYBOOK-CURRICULUM.md §3 (canonical pattern)
--   - lib/curriculum/ensure-primary-playbook-link.ts (the helper)
-- PlaybookCurriculum has no updatedAt column (only createdAt with @default(now())).
INSERT INTO "PlaybookCurriculum" (id, "playbookId", "curriculumId", role, "createdAt")
SELECT gen_random_uuid(), c."playbookId", c.id, 'primary'::"PlaybookCurriculumRole", NOW()
FROM "Curriculum" c
WHERE c."playbookId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Playbook" p WHERE p.id = c."playbookId")
  AND NOT EXISTS (
    SELECT 1 FROM "PlaybookCurriculum" pc
    WHERE pc."curriculumId" = c.id
      AND pc."playbookId" = c."playbookId"
  );

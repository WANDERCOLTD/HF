-- #408 P0 data triage — repair 3 CallerModuleProgress + 4 Call.curriculumModuleId
-- rows that point at a module from a different playbook's curriculum.
--
-- Root cause was unscoped `findFirst({where:{slug}})` at two FK-write sites
-- (fixed in #409). Three callers ended up routed to module `83341354...`
-- (part1 in playbook 9a646417 "IELTS Speaking v1") even though none of them
-- are enrolled in that playbook.
--
-- This migration is data-only (no schema change) and idempotent — re-running
-- it is a no-op once the rows are repaired.
--
-- Per-caller plan:
--   Opal Jensen (b9ad0217-...) — enrolled in playbook a8f44d48-... (IELTS
--     Speaking Practice v8). UPDATE moduleId → 6fd8c9c6-... (correct part1
--     in her curriculum accacea2). Her loScoresJson `{"OUT-01": {...}}` is
--     preserved by the UPDATE.
--   Freya Valdez (2c512e96-...) — no active CallerPlaybook enrollment, so
--     there is no per-playbook curriculum to repoint to. DELETE her corrupt
--     CMP row; next call after she re-enrolls will create a clean one.
--   Tessa Xiong (c06e332c-...) — enrolled in playbook 1b7dabe3-... but that
--     playbook has NO Curriculum attached (separate pre-existing data
--     issue). DELETE her corrupt CMP row.
--
-- Call.curriculumModuleId:
--   Opal's 2 Call rows — UPDATE to the correct part1 UUID.
--   Freya's + Tessa's 1 Call row each — SET to NULL (no valid repoint
--     target; the FK is nullable).

BEGIN;

-- ── CallerModuleProgress ──────────────────────────────────────────────────

-- Opal: repoint moduleId to the part1 in her enrolled playbook's curriculum.
UPDATE "CallerModuleProgress"
SET "moduleId" = '6fd8c9c6-1f59-4d19-a2b6-a75d4ef3ed14',
    "updatedAt" = NOW()
WHERE "callerId" = 'b9ad0217-9202-4f32-b358-6a79783170ef'
  AND "moduleId" = '83341354-3d38-4f62-a9e5-72c9b9dd2ac5';

-- Freya: no enrollment to repoint against — delete the corrupt row.
DELETE FROM "CallerModuleProgress"
WHERE "callerId" = '2c512e96-1082-4194-a59b-3973996f632a'
  AND "moduleId" = '83341354-3d38-4f62-a9e5-72c9b9dd2ac5';

-- Tessa: enrolled playbook has no curriculum — delete the corrupt row.
DELETE FROM "CallerModuleProgress"
WHERE "callerId" = 'c06e332c-3e73-4bab-9ded-3c81b33f0c94'
  AND "moduleId" = '83341354-3d38-4f62-a9e5-72c9b9dd2ac5';

-- ── Call.curriculumModuleId ───────────────────────────────────────────────

-- Opal's 2 Call rows: repoint to the correct part1 UUID.
UPDATE "Call"
SET "curriculumModuleId" = '6fd8c9c6-1f59-4d19-a2b6-a75d4ef3ed14'
WHERE "callerId" = 'b9ad0217-9202-4f32-b358-6a79783170ef'
  AND "curriculumModuleId" = '83341354-3d38-4f62-a9e5-72c9b9dd2ac5';

-- Freya's + Tessa's Call rows: no valid repoint target → NULL the FK.
UPDATE "Call"
SET "curriculumModuleId" = NULL
WHERE "curriculumModuleId" = '83341354-3d38-4f62-a9e5-72c9b9dd2ac5'
  AND "callerId" IN (
    '2c512e96-1082-4194-a59b-3973996f632a',
    'c06e332c-3e73-4bab-9ded-3c81b33f0c94'
  );

COMMIT;

-- ── Verification (run manually after migration) ───────────────────────────
--
-- Both queries below MUST return 0 rows.
--
-- 1. CallerModuleProgress leak:
--   SELECT cmp.* FROM "CallerModuleProgress" cmp
--   JOIN "CurriculumModule" cm ON cm.id = cmp."moduleId"
--   JOIN "Curriculum" cur ON cur.id = cm."curriculumId"
--   LEFT JOIN "CallerPlaybook" cp ON cp."callerId" = cmp."callerId" AND cp.status='ACTIVE'
--   WHERE cur."playbookId" IS DISTINCT FROM cp."playbookId";
--
-- 2. Call.curriculumModuleId leak:
--   SELECT c.id FROM "Call" c
--   JOIN "CurriculumModule" cm ON cm.id = c."curriculumModuleId"
--   JOIN "Curriculum" cur ON cur.id = cm."curriculumId"
--   WHERE cur."playbookId" IS DISTINCT FROM c."playbookId";

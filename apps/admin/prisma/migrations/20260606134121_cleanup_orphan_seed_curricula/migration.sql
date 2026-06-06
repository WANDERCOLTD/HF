-- #1192 — cleanup orphan seed Curricula.
--
-- These 3 Curriculum rows were created by legacy CONTENT spec seeds (WNF-CONTENT-001,
-- QM-CONTENT-001, CURR-FS-L2-001) that have been removed from
-- docs-archive/bdd-specs/. The DB rows have:
--   - 0 CurriculumModule children
--   - 0 PlaybookCurriculum links
--   - 0 referencing Calls
--
-- The NOT EXISTS guards make this idempotent and refuse to drop any curriculum
-- that has been retroactively attached to content or a playbook.
--
-- Note: there is no Call→Curriculum direct FK. Calls reference Curriculum
-- transitively via Call.curriculumModuleId → CurriculumModule.curriculumId
-- (landmine §8.5 in docs/CONTRACTS-PLAYBOOK-CURRICULUM.md). The first NOT EXISTS
-- on CurriculumModule already guarantees no Call can reach this Curriculum.
DELETE FROM "Curriculum"
WHERE slug IN ('wnf-content-001', 'qm-content-001', 'curr-fs-l2-001')
  AND NOT EXISTS (SELECT 1 FROM "CurriculumModule" WHERE "curriculumId" = "Curriculum"."id")
  AND NOT EXISTS (SELECT 1 FROM "PlaybookCurriculum" WHERE "curriculumId" = "Curriculum"."id");

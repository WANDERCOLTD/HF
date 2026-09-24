-- Restore the array defaults on `CurriculumModule` list columns.
--
-- `coversModules` was created by 20260519_494_module_progression_fields as
-- NOT NULL DEFAULT ARRAY[]::TEXT[]. The Prisma schema declared it as a bare
-- `String[]` with no `@default([])`, so a later Prisma diff saw "schema has
-- no default, db does" and emitted DROP DEFAULT. The column was left NOT NULL
-- with no default, and every writer that omits the field fails with P2011.
--
-- Observed 2026-09-23 on BOTH hf_sandbox and hf_staging:
--   coversModules  nullable=NO  default=NULL   <-- drift
--   segmentCues    nullable=NO  default=ARRAY[]::text[]
--
-- Blast radius: any CurriculumModule create that omits the column --
-- `lib/curriculum/sync-modules.ts`, `app/api/curricula/[curriculumId]/modules`,
-- and `prisma/seed-demo-course.ts` (where it surfaced).
--
-- `segmentCues` still holds its default but has the identical schema gap, so
-- it is re-asserted here too -- the next diff would otherwise drop it the same
-- way. Both columns now carry `@default([])` in schema.prisma, which is what
-- stops the drift recurring.
--
-- Idempotent: SET DEFAULT is a no-op when the default already matches.

ALTER TABLE "CurriculumModule"
  ALTER COLUMN "coversModules" SET DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "CurriculumModule"
  ALTER COLUMN "segmentCues" SET DEFAULT ARRAY[]::TEXT[];

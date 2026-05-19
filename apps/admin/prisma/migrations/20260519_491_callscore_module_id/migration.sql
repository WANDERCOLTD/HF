-- #491 Slice 1.2 — multi-attribute attribution for CallScore.
--
-- Mock-style calls cover multiple sub-modules (Part 1 + Part 2 + Part 3) in
-- one transcript. The pipeline writes a CallScore PER skill PER sub-module
-- (so 4 skills × 3 sub-parts = 12 scores from one Mock). The existing
-- `@@unique([callId, parameterId])` constraint prevented this — adding
-- moduleId to the key allows the same skill parameter to be scored multiple
-- times within one call, once per attributed module.
--
-- Postgres treats NULLs as distinct in unique constraints by default. Legacy
-- single-module calls have moduleId=NULL; the constraint must STILL enforce
-- one-score-per-(callId, parameterId) for those, OR risk duplicate writes
-- from pipeline force-reruns. A partial unique index covers that case.

-- 1. Add the nullable moduleId column + FK
ALTER TABLE "CallScore" ADD COLUMN IF NOT EXISTS "moduleId" TEXT;

ALTER TABLE "CallScore"
  ADD CONSTRAINT "CallScore_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "CurriculumModule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "CallScore_moduleId_idx" ON "CallScore"("moduleId");

-- 2. Drop the old (callId, parameterId) unique constraint.
ALTER TABLE "CallScore" DROP CONSTRAINT IF EXISTS "CallScore_callId_parameterId_key";

-- 3. New unique constraint includes moduleId. Postgres' default NULL handling
--    means rows with moduleId=NULL won't collide against each other under this
--    constraint, so we add a partial index to preserve legacy uniqueness.
ALTER TABLE "CallScore"
  ADD CONSTRAINT "CallScore_callId_parameterId_moduleId_key"
  UNIQUE ("callId", "parameterId", "moduleId");

-- Partial index: enforce one-score-per-(callId, parameterId) when moduleId IS NULL
-- (legacy + single-module calls). Without this, a pipeline force-rerun could
-- write two rows with the same (callId, parameterId, NULL) and both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS "CallScore_callId_parameterId_null_module_key"
  ON "CallScore"("callId", "parameterId")
  WHERE "moduleId" IS NULL;

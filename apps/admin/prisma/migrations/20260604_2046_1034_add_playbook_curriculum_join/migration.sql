-- #1034 — PlaybookCurriculum join table for Course Variant
--
-- Adds many-to-many between Playbook and Curriculum so that sibling
-- Variant Playbooks can share a Curriculum with their parent. Backfills
-- one `primary` row per existing Curriculum.playbookId. The legacy
-- Curriculum.playbookId column is kept as a deprecated owner pointer
-- for one release and is dropped in follow-up #1038.
--
-- Chain contracts (see docs/chain-contracts.md):
--   CC-A: Playbook → Curriculum linkage (this table is the data shape)
--   CC-B: Curriculum mutation fanout (index on curriculumId enables fast read)

-- CreateEnum
CREATE TYPE "PlaybookCurriculumRole" AS ENUM ('primary', 'linked');

-- CreateTable
CREATE TABLE "PlaybookCurriculum" (
    "id" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "curriculumId" TEXT NOT NULL,
    "role" "PlaybookCurriculumRole" NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybookCurriculum_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookCurriculum_playbookId_curriculumId_key" ON "PlaybookCurriculum"("playbookId", "curriculumId");

-- CreateIndex
CREATE INDEX "PlaybookCurriculum_curriculumId_idx" ON "PlaybookCurriculum"("curriculumId");

-- CreateIndex
CREATE INDEX "PlaybookCurriculum_playbookId_idx" ON "PlaybookCurriculum"("playbookId");

-- AddForeignKey
ALTER TABLE "PlaybookCurriculum"
  ADD CONSTRAINT "PlaybookCurriculum_playbookId_fkey"
  FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — RESTRICT: a Curriculum cannot be dropped while a Playbook
-- still links to it; the operator must explicitly unlink (or drop the
-- Playbook side first) so siblings don't lose their shared content silently.
ALTER TABLE "PlaybookCurriculum"
  ADD CONSTRAINT "PlaybookCurriculum_curriculumId_fkey"
  FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one PlaybookCurriculum{role:'primary'} row per existing
-- Curriculum where playbookId IS NOT NULL. Idempotent under the unique
-- constraint, so safe to re-run if the migration is replayed.
INSERT INTO "PlaybookCurriculum" ("id", "playbookId", "curriculumId", "role", "createdAt")
SELECT
  gen_random_uuid()::TEXT,
  "playbookId",
  "id",
  'primary'::"PlaybookCurriculumRole",
  CURRENT_TIMESTAMP
FROM "Curriculum"
WHERE "playbookId" IS NOT NULL
ON CONFLICT ("playbookId", "curriculumId") DO NOTHING;

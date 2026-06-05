-- #1081 Slice 2B.1: add qualificationAnchor labelling field on Curriculum.
-- NOT a mastery-sharing mechanism (sharing comes from PlaybookCurriculum
-- role=linked, one shared Curriculum). This field labels sibling Curricula
-- so the upcoming CI guard (Slice 2B.3) can detect slug/ref set divergence
-- within an anchor family, and admin rollups can group by qualification.
--
-- See lib/curriculum/qualification-anchor.ts for the derive helper and
-- scripts/backfill-curriculum-anchors.ts for the one-shot operator backfill.

-- AlterTable
ALTER TABLE "Curriculum" ADD COLUMN "qualificationAnchor" TEXT;

-- CreateIndex
CREATE INDEX "Curriculum_qualificationAnchor_idx" ON "Curriculum"("qualificationAnchor");

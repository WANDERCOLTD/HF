-- Issue #338 Phase 2 — projection provenance FK on Goal, BehaviorTarget, CurriculumModule.
--
-- Adds nullable sourceContentId FK to three tables, enabling the idempotent
-- COURSE_REFERENCE → DB projection contract documented in:
--   docs/CONTENT-PIPELINE.md §4 Phase 2.5
--   docs/ENTITIES.md §6 invariant I7
--
-- Scope: NEW courses created on/after 2026-05-12. Pre-existing rows have
-- NULL sourceContentId and are NOT backfilled. The projection's idempotent
-- applier (apply-projection.ts, Phase 4) diffs by
--   (playbookId, sourceContentId, slug/name)
-- so re-runs against the same source produce empty diffs.
--
-- onDelete: SET NULL — direct source-delete leaves projected rows with null
-- provenance (treated as legacy). The applier owns the explicit deletion
-- path on doc replace/edit so cascading from the FK isn't needed.
--
-- Additive only — no existing data is rewritten. Safe under concurrent writes.

-- Goal
ALTER TABLE "Goal" ADD COLUMN "sourceContentId" TEXT;
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_sourceContentId_fkey"
  FOREIGN KEY ("sourceContentId") REFERENCES "ContentSource"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Goal_sourceContentId_idx" ON "Goal"("sourceContentId");

-- BehaviorTarget
ALTER TABLE "BehaviorTarget" ADD COLUMN "sourceContentId" TEXT;
ALTER TABLE "BehaviorTarget" ADD CONSTRAINT "BehaviorTarget_sourceContentId_fkey"
  FOREIGN KEY ("sourceContentId") REFERENCES "ContentSource"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "BehaviorTarget_sourceContentId_idx" ON "BehaviorTarget"("sourceContentId");

-- CurriculumModule
ALTER TABLE "CurriculumModule" ADD COLUMN "sourceContentId" TEXT;
ALTER TABLE "CurriculumModule" ADD CONSTRAINT "CurriculumModule_sourceContentId_fkey"
  FOREIGN KEY ("sourceContentId") REFERENCES "ContentSource"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CurriculumModule_sourceContentId_idx" ON "CurriculumModule"("sourceContentId");

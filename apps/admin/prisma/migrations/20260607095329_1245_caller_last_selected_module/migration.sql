-- #1245 — Per-Caller "last picked module" durability.
--
-- Pre-fix the picker wrote the choice to `Call.curriculumModuleId`
-- only at call-create from a URL param; when the learner came back to
-- /x/sim without the param the rail re-rendered "Pick a module" — they
-- had to re-pick on every visit. Adding `Caller.lastSelectedModuleId`
-- so the sim landing can pre-fill the URL param + rail with the last
-- pick. ON DELETE SET NULL because a deleted CurriculumModule must not
-- cascade-delete the Caller row.
--
-- Safe on hf_sandbox + production: additive column, nullable, no
-- backfill required (existing callers get NULL = no prior pick — the
-- picker UI handles NULL identically to "first visit").

-- AlterTable
ALTER TABLE "Caller" ADD COLUMN "lastSelectedModuleId" TEXT;

-- AddForeignKey
ALTER TABLE "Caller"
  ADD CONSTRAINT "Caller_lastSelectedModuleId_fkey"
  FOREIGN KEY ("lastSelectedModuleId")
  REFERENCES "CurriculumModule"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- CreateIndex (light index for sim landing's FK lookup on /x/sim mount)
CREATE INDEX "Caller_lastSelectedModuleId_idx" ON "Caller"("lastSelectedModuleId");

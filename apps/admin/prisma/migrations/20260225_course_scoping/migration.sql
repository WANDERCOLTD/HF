-- Course Scoping: Thread playbookId through sessions so each call belongs to one course.

-- 1. Call → Playbook (which course this call belongs to)
ALTER TABLE "Call" ADD COLUMN "playbookId" TEXT;
ALTER TABLE "Call" ADD CONSTRAINT "Call_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Call_playbookId_idx" ON "Call"("playbookId");

-- 2. ComposedPrompt → Playbook (which course this prompt was composed for)
ALTER TABLE "ComposedPrompt" ADD COLUMN "playbookId" TEXT;
ALTER TABLE "ComposedPrompt" ADD CONSTRAINT "ComposedPrompt_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ComposedPrompt_playbookId_idx" ON "ComposedPrompt"("playbookId");

-- 3. CallerPlaybook.isDefault (default course for phone-in callers)
ALTER TABLE "CallerPlaybook" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- 4. Invite → Playbook (invite to a specific course)
ALTER TABLE "Invite" ADD COLUMN "playbookId" TEXT;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Invite_playbookId_idx" ON "Invite"("playbookId");

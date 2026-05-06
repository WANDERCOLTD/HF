-- AlterTable: Call gains requestedModuleId so the picker's pre-call pick
-- can override the scheduler-selected module when computing mastery.
-- See #242 Slice 2.

ALTER TABLE "Call" ADD COLUMN "requestedModuleId" TEXT;

-- CreateIndex
CREATE INDEX "Call_requestedModuleId_idx" ON "Call"("requestedModuleId");

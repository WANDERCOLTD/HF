-- #1191 — quick-launch retire.
--
-- The quick-launch flow is being removed. Any in-flight UserTask rows with
-- taskType = 'quick_launch' would render as un-resumable orphans on the Jobs
-- page and JobsPopup once /x/quick-launch is gone. Archive them by switching
-- status from 'in_progress' → 'abandoned' so the Jobs surfaces simply hide them.
--
-- Idempotent. Safe to run on hf-dev, staging, prod.
UPDATE "UserTask"
SET "status" = 'abandoned',
    "updatedAt" = NOW()
WHERE "taskType" = 'quick_launch'
  AND "status" = 'in_progress';

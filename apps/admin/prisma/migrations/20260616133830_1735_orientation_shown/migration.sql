-- #1735 (epic #1700 Theme 1 G8 consumer D) — orientation-shown gate column.
--
-- Adds the `orientationShown` flag to `CallerModuleProgress`. Default false
-- so existing rows pre-#1735 backfill cleanly (every prior caller is
-- treated as "hasn't seen orientation yet", which is acceptable — the
-- orientation line will fire once and never again).
--
-- Read by the composer (`transforms/instructions.ts::resolveModuleOrientationLine`)
-- gated by `HF_FLAG_IELTS_MODULE_SETTINGS`. Written by `endSession`'s
-- `evaluateOrientationShown` block on first successful completion of a
-- module that has `moduleFirstTimeOrientationLine` set.

ALTER TABLE "CallerModuleProgress"
  ADD COLUMN "orientationShown" BOOLEAN NOT NULL DEFAULT false;

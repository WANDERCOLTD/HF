-- #444 Spec-driven goal-progress strategies
--
-- Adds `Goal.progressStrategy` — a free-text strategy key resolved at goal
-- creation time (apply-projection or instantiate-goals) and consumed by
-- trackGoalProgress via STRATEGY_REGISTRY dispatch. NULL is treated as
-- manual_only at runtime; the wizard's validateCourseStrategies guard prevents
-- a course from being marked Ready while any Goal has a NULL strategy.
--
-- No backfill — fresh-start agreement with user (existing courses will be
-- deleted before this ships). Pre-existing rows survive with NULL strategy,
-- which dispatches to manual_only (progress=0 + "awaiting evidence" banner).

ALTER TABLE "Goal" ADD COLUMN "progressStrategy" TEXT;

CREATE INDEX "Goal_progressStrategy_idx" ON "Goal"("progressStrategy");

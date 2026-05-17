-- #417 Phase A — schema for per-skill scoring pipeline.
--
-- Adds:
--   BehaviorTarget.skillRef     — provenance anchor "SKILL-01" .. "SKILL-NN"
--   CallerTarget.currentScore   — EMA-decayed running per-skill score
--   CallerTarget.lastScoredAt   — high-water mark for idempotency guard
--
-- Backwards-safe: all three columns are nullable, no existing rows changed.
-- The values are populated by:
--   • Phase B (apply-projection.ts persists skillRef when projecting from
--     a COURSE_REFERENCE doc's Skills Framework)
--   • Phase C (aggregate-runner.ts writes currentScore + lastScoredAt
--     after each MEASURE pass for `skill_*` params)

BEGIN;

ALTER TABLE "BehaviorTarget" ADD COLUMN "skillRef" TEXT;
CREATE INDEX "BehaviorTarget_skillRef_idx" ON "BehaviorTarget"("skillRef");

ALTER TABLE "CallerTarget" ADD COLUMN "currentScore" DOUBLE PRECISION;
ALTER TABLE "CallerTarget" ADD COLUMN "lastScoredAt" TIMESTAMP(3);

COMMIT;

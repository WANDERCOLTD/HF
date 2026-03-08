-- Goal: Assessment target support
ALTER TABLE "Goal" ADD COLUMN "isAssessmentTarget" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Goal" ADD COLUMN "assessmentConfig" JSONB;

-- Goal: Composite index for assessment target queries
CREATE INDEX "Goal_callerId_isAssessmentTarget_status_idx" ON "Goal"("callerId", "isAssessmentTarget", "status");

-- RewardScore: Goal progress component
ALTER TABLE "RewardScore" ADD COLUMN "goalProgressScore" DOUBLE PRECISION;

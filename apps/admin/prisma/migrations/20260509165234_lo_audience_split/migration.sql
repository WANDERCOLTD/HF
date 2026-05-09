-- Issue #317 — LO audience split foundation.
-- All changes are additive and safe for existing data:
--   * `learnerVisible` defaults true → existing rows render unchanged on the learner page.
--   * `systemRole` defaults NONE → existing rows have no system role.
--   * `originalText`, `performanceStatement`, `humanOverriddenAt` start NULL on existing rows.
--   * `LoClassification` is empty until the classifier runs.

-- CreateEnum
CREATE TYPE "LoSystemRole" AS ENUM ('ASSESSOR_RUBRIC', 'ITEM_GENERATOR_SPEC', 'SCORE_EXPLAINER', 'NONE');

-- AlterTable
ALTER TABLE "LearningObjective"
    ADD COLUMN "originalText" TEXT,
    ADD COLUMN "learnerVisible" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "performanceStatement" TEXT,
    ADD COLUMN "systemRole" "LoSystemRole" NOT NULL DEFAULT 'NONE',
    ADD COLUMN "humanOverriddenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LoClassification" (
    "id" TEXT NOT NULL,
    "loId" TEXT NOT NULL,
    "classifierVersion" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedLearnerVisible" BOOLEAN NOT NULL,
    "proposedPerformanceStatement" TEXT,
    "proposedSystemRole" "LoSystemRole" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningObjective_learnerVisible_systemRole_idx" ON "LearningObjective"("learnerVisible", "systemRole");

-- CreateIndex
CREATE INDEX "LoClassification_loId_runAt_idx" ON "LoClassification"("loId", "runAt");

-- CreateIndex
CREATE INDEX "LoClassification_applied_confidence_idx" ON "LoClassification"("applied", "confidence");

-- AddForeignKey
ALTER TABLE "LoClassification" ADD CONSTRAINT "LoClassification_loId_fkey" FOREIGN KEY ("loId") REFERENCES "LearningObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- #1118 — SpeechAssessmentProvider DB table. Parallel pattern to
-- VoiceProvider (#1031). Multi-vendor scoring registry for SpeechAce +
-- SpeechSuper. Adapter resolution via `adapterKey`; stable identifier
-- via `slug` (immutable post-creation). Architecture note:
-- docs-memory/project_voice_chain_contracts_boundary.md.
--
-- Seeded with two unconfigured rows (speechace, speechsuper; enabled:false,
-- empty credentials) by prisma/seed-speech-assessment-providers.ts.

-- CreateTable
CREATE TABLE "SpeechAssessmentProvider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeechAssessmentProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeechAssessmentProvider_slug_key" ON "SpeechAssessmentProvider"("slug");
CREATE INDEX "SpeechAssessmentProvider_slug_idx" ON "SpeechAssessmentProvider"("slug");
CREATE INDEX "SpeechAssessmentProvider_isDefault_idx" ON "SpeechAssessmentProvider"("isDefault");

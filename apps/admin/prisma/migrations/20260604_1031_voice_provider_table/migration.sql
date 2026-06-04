-- AnyVoice #1031: VoiceProvider DB table + supersede the VoiceProviderSlug
-- enum approach from #1025.
--
-- This migration runs AFTER 20260604_1025_add_call_voice_provider (which
-- created the enum + Call.voiceProvider column). It:
--   1. Creates the new VoiceProvider table (data-driven provider registry)
--   2. Adds Caller.voiceProvider as TEXT (per-caller override, supersedes
--      the in-flight #1027 migration which was never deployed)
--   3. Converts Call.voiceProvider from the enum type to TEXT, mapping
--      'VAPI' → 'vapi' to match VoiceProvider.slug convention
--   4. Drops the now-unused VoiceProviderSlug enum
--
-- The VAPI seed row is inserted by prisma/seeds/voice-providers.ts at
-- /vm-cpp time so the factory has data to read on first request.

-- CreateTable
CREATE TABLE "VoiceProvider" (
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

    CONSTRAINT "VoiceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceProvider_slug_key" ON "VoiceProvider"("slug");
CREATE INDEX "VoiceProvider_slug_idx" ON "VoiceProvider"("slug");
CREATE INDEX "VoiceProvider_isDefault_idx" ON "VoiceProvider"("isDefault");

-- AddColumn: per-caller voice-provider override (supersedes the unshipped
-- 20260604_1027_add_caller_voice_provider migration — that file should be
-- deleted from the working tree before next /vm-cpp).
ALTER TABLE "Caller" ADD COLUMN "voiceProvider" TEXT;

-- Convert Call.voiceProvider from VoiceProviderSlug enum to TEXT.
-- USING clause + lower() maps 'VAPI' → 'vapi' to align with the new
-- VoiceProvider.slug convention.
ALTER TABLE "Call" ALTER COLUMN "voiceProvider" DROP DEFAULT;
ALTER TABLE "Call" ALTER COLUMN "voiceProvider" TYPE TEXT USING lower("voiceProvider"::TEXT);
ALTER TABLE "Call" ALTER COLUMN "voiceProvider" SET DEFAULT 'vapi';

-- Drop the now-unused enum. IF EXISTS guards against the type already
-- being absent (e.g. fresh DB where the new schema was applied directly).
DROP TYPE IF EXISTS "VoiceProviderSlug";

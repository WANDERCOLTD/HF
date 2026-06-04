-- AnyVoice #1025: Add VoiceProviderSlug enum + Call.voiceProvider column
-- Foundational story for epic #1015. Replaces the implicit
-- `isVapiCall = !!externalId` coupling at app/api/vapi/tools/route.ts:720
-- with an explicit enum so adapter dispatch and per-caller routing (#1027)
-- have a typed source of truth.

-- CreateEnum
CREATE TYPE "VoiceProviderSlug" AS ENUM ('VAPI');

-- AlterTable
ALTER TABLE "Call" ADD COLUMN "voiceProvider" "VoiceProviderSlug" NOT NULL DEFAULT 'VAPI';

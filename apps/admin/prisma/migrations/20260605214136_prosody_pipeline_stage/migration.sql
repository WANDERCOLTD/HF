-- #1119 — PROSODY pipeline stage. Three additive changes:
--   1. Call.voiceProsody Json? — forensic receipt of the normalised
--      VoiceProsodyFeatures envelope (live signal is the
--      VOICE_PROSODY_V1 DataContract).
--   2. AnalysisOutputType.PROSODY enum value — so PIPELINE-001 can
--      declare the new stage's outputType.
--   3. VoiceSystemSettings.vendorTimeoutMs — vendor scoring call timeout
--      (default 30s; tunable per-installation without code deploy).
--
-- All three are additive — no destructive change. Existing rows get
-- NULL for voiceProsody (or DEFAULT 30000 for vendorTimeoutMs).

-- 1. Call.voiceProsody
ALTER TABLE "Call" ADD COLUMN "voiceProsody" JSONB;

-- 2. AnalysisOutputType.PROSODY enum value
ALTER TYPE "AnalysisOutputType" ADD VALUE IF NOT EXISTS 'PROSODY';

-- 3. VoiceSystemSettings.vendorTimeoutMs
ALTER TABLE "VoiceSystemSettings" ADD COLUMN "vendorTimeoutMs" INTEGER NOT NULL DEFAULT 30000;

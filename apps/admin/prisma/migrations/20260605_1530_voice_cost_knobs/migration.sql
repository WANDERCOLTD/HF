-- Voice cost-safety knobs: per-call config injected into the inline
-- assistant payload built for VAPI (Web SDK and PSTN). Operators tune
-- without a code deploy. Defaults reflect safe values; existing rows
-- inherit them via column defaults at ALTER TABLE time.

ALTER TABLE "VoiceSystemSettings"
  ADD COLUMN "silenceTimeoutSeconds"   INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "maxDurationSeconds"      INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN "voicemailDetectionEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "endCallPhrases"          TEXT[]  NOT NULL DEFAULT
    ARRAY['goodbye','bye','talk to you later','see you later','have a nice day']::TEXT[];

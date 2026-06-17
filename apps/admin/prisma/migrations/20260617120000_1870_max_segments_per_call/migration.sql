-- #1870 — Per-call cap on segmented PROSODY scoring.
--
-- `VoiceSystemSettings.maxSegmentsPerCall` bounds the number of vendor
-- invocations a single call's segmented PROSODY scoring may produce.
-- When `Session.metadata.phaseBoundaries.length` exceeds this value,
-- the runner falls back to whole-call scoring (one vendor invocation)
-- and logs `voice.prosody.segments_capped`.
--
-- Default 5 covers IELTS Mock (Part 1 / Part 2 prep / Part 2 monologue
-- / Part 3 = 4 phases) plus headroom. Additive + safe-default — no
-- behaviour change for existing rows (the field reads as default until
-- a phaseBoundaries population exists).

ALTER TABLE "VoiceSystemSettings"
  ADD COLUMN IF NOT EXISTS "maxSegmentsPerCall" INTEGER NOT NULL DEFAULT 5;

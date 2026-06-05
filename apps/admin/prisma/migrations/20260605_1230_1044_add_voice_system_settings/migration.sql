-- AnyVoice #1044: cross-provider voice settings (single-row).
--
-- Holds cost cap, default provider slug, audit retention, and the
-- fallback-on-adapter-error policy that the cost-cap watcher (#1080)
-- and the route-layer dispatch consume.
--
-- Single row, `id` defaults to "singleton" so the app-side helper
-- upserts without needing a discovery step. No FK relationships.

CREATE TABLE "VoiceSystemSettings" (
  "id"                      TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
  "fallbackOnAdapterError"  TEXT NOT NULL DEFAULT 'throw',
  "maxCostPerCallUsd"       DOUBLE PRECISION,
  "auditRetentionDays"      INTEGER NOT NULL DEFAULT 90,
  "defaultProviderSlug"     TEXT NOT NULL DEFAULT '',
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL
);

-- Seed the singleton row so the helper's findUnique returns it without
-- the app needing to upsert on first read.
INSERT INTO "VoiceSystemSettings" ("id", "updatedAt")
VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

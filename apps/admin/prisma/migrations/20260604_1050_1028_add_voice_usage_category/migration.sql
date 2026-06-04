-- AnyVoice #1028: add VOICE to UsageCategory enum so voice-call ledger
-- writes (per-minute billing) don't have to be force-fit under EXTERNAL
-- (which is per-call count). DEFAULT_COST_RATES gets matching VOICE:vapi
-- entries in the same PR; calculateCost gains "minutes" + "seconds" arms.
--
-- ALTER TYPE ADD VALUE on Postgres is metadata-only on recent versions,
-- safe under load. Does not require concurrent operations.

ALTER TYPE "UsageCategory" ADD VALUE IF NOT EXISTS 'VOICE';

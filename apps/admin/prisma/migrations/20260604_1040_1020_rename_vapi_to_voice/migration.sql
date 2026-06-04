-- AnyVoice #1020: rename vapi*-prefixed Call columns to canonical voice*
-- + add voiceProviderRaw Json for provider-specific extras.
--
-- Closes the I-VP3 invariant in CHAIN-CONTRACTS.md Link 3 sub-contract:
-- canonical Call columns MUST NOT carry provider-specific vocabulary.
-- The columns themselves stay typed (duration / cost / endedReason /
-- analysisSummary / structuredData / successEvaluation) — only the
-- prefix changes. Extras blob is the new escape hatch for genuinely
-- provider-shaped fields that don't fit a canonical column.
--
-- ALTER ... RENAME COLUMN is metadata-only on Postgres — no row rewrite,
-- no lock-escalation, safe under load. Migration-checker validated.
-- Existing test fixture (vapi-end-of-call-report.json) is unchanged
-- because it stores the VAPI payload shape, not the DB column names.

ALTER TABLE "Call" RENAME COLUMN "vapiDurationSeconds"   TO "voiceDurationSeconds";
ALTER TABLE "Call" RENAME COLUMN "vapiEndedReason"       TO "voiceEndedReason";
ALTER TABLE "Call" RENAME COLUMN "vapiCostUsd"           TO "voiceCostUsd";
ALTER TABLE "Call" RENAME COLUMN "vapiAnalysisSummary"   TO "voiceAnalysisSummary";
ALTER TABLE "Call" RENAME COLUMN "vapiStructuredData"    TO "voiceStructuredData";
ALTER TABLE "Call" RENAME COLUMN "vapiSuccessEvaluation" TO "voiceSuccessEvaluation";

ALTER TABLE "Call" ADD COLUMN "voiceProviderRaw" JSONB;

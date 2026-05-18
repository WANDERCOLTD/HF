-- Story A — Capture VAPI end-of-call-report payload on the Call record.
--
-- Adds 8 nullable typed columns to Call for fields VAPI sends in its
-- `end-of-call-report` webhook event. All optional / nullable so SIM, manual,
-- and legacy Call creation paths are unaffected — every column defaults to
-- NULL when unset by the writer.
--
-- Wired from app/api/vapi/webhook/route.ts only. No consumer reads them
-- today; this is Phase 0 plumbing for the deferred voice-analysis pipeline
-- (see apps/admin/docs/PLAN-voice-analysis.md).
--
-- Backwards-safe: additive only, no existing rows touched.

BEGIN;

ALTER TABLE "Call" ADD COLUMN "recordingUrl"          TEXT;
ALTER TABLE "Call" ADD COLUMN "stereoRecordingUrl"    TEXT;
ALTER TABLE "Call" ADD COLUMN "vapiDurationSeconds"   DOUBLE PRECISION;
ALTER TABLE "Call" ADD COLUMN "vapiEndedReason"       TEXT;
ALTER TABLE "Call" ADD COLUMN "vapiCostUsd"           DOUBLE PRECISION;
ALTER TABLE "Call" ADD COLUMN "vapiAnalysisSummary"   TEXT;
ALTER TABLE "Call" ADD COLUMN "vapiStructuredData"    JSONB;
ALTER TABLE "Call" ADD COLUMN "vapiSuccessEvaluation" TEXT;

COMMIT;

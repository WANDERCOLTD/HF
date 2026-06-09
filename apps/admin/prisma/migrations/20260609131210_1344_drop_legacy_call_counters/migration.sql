-- #1344 (epic #1338) Slice 4 — single-counter cutover.
--
-- The legacy `Call.callSequence` counter is replaced by
-- `Session.learnerFacingNumber` (assigned atomically by
-- `createSession` via `CallerSequenceCounter`). The dual-FK
-- transition window from #1341 Slice 0
-- (`ComposedPrompt.triggerCallId` + `ComposedPrompt.triggerSessionId`)
-- is complete; this migration drops the legacy column + index + FK
-- relation.
--
-- Operational sequence captured in the PR body:
--   1. CI green
--   2. `/vm-cppd` applies this migration on hf_sandbox
--   3. `npx tsx scripts/backfill-learner-facing-number.ts` runs
--      idempotently to fill `Session.learnerFacingNumber` and
--      `Session.countsTowardLearnerNumber` against per-Caller class
--      rules (#1338)
--   4. `npx tsx scripts/proof-1344-cutover.ts` confirms
--      gap-free / NULL-free / Bertie's drift case
--   5. `HF_FLAG_SESSION_MODEL_V2` default is already true (see
--      `lib/voice/session-flag.ts` from this PR)
--
-- This migration is intentionally destructive on `Call.callSequence` —
-- the value is preserved on the Session row by the Slice 0
-- migration's backfill (`SELECT c.callSequence AS learnerFacingNumber`
-- on the lateral join). The backfill script in #1344 reconciles any
-- per-Caller rows that drifted between Slice 0 and Slice 4.

-- 1. Drop the legacy FK + relation. The `ComposedPrompt.triggerCallId`
--    column carried the pre-#1341 trigger Call id; every reader is now
--    on `triggerSessionId` (#1344 Slice 4 swap).
ALTER TABLE "ComposedPrompt"
  DROP CONSTRAINT IF EXISTS "ComposedPrompt_triggerCallId_fkey";

DROP INDEX IF EXISTS "ComposedPrompt_triggerCallId_idx";

ALTER TABLE "ComposedPrompt"
  DROP COLUMN IF EXISTS "triggerCallId";

-- 2. Drop the legacy `Call.callSequence` column. The Session parent row
--    owns the per-Caller learner-facing counter
--    (`Session.learnerFacingNumber`) and the per-(callerId, kind)
--    sequencer (`Session.sequenceNumber`).
ALTER TABLE "Call"
  DROP COLUMN IF EXISTS "callSequence";

-- 3. The `Call_callSequence_idx` index never existed in the schema
--    (Slice 0 verification confirmed). The `DROP INDEX IF EXISTS` here
--    is defence-in-depth for environments that hand-rolled it during
--    earlier debugging.
DROP INDEX IF EXISTS "Call_callSequence_idx";

-- #1241 — Call.endSource for natural end-of-call flow analytics + UI labelling.
--
-- Tags which path closed a Call:
--   "sdk"     VAPI Web SDK call-end event (browser hangup, Talk Here)
--   "sse"     SSE call-ended from server (PSTN hangup → webhook)
--   "manual"  User clicked the End Call sheet button (operator path)
--   "drop"    30s silence watchdog / stale-resume-on-mount sealed the call
--   "poll"    90s server-side poll-stale-calls reconciler
--   "discard" Future "discard without pipeline" path
--
-- Nullable — existing rows have NULL (unknown). Writers populate where the
-- end source is unambiguous. Drives the wrap-marker copy on SimChat
-- ("ended on phone" vs "connection lost" vs "discarded").
--
-- Plain TEXT column rather than a Postgres enum: keeps the migration cheap,
-- avoids the type-add-then-column-add two-step, and lets us evolve the set
-- without ALTER TYPE. Validity is documented in the TS const at
-- `apps/admin/lib/voice/end-source.ts`.

ALTER TABLE "Call" ADD COLUMN "endSource" TEXT;

-- #661 — Add TUNING_CHAT value to BehaviorTargetSource enum.
--
-- New source for BehaviorTarget rows written by the Cmd+K Tuning chat
-- assistant. Distinguishes chat-driven writes from sidebar/API "MANUAL"
-- writes in the audit trail.
--
-- Pure additive — no rows are rewritten, no defaults change.

ALTER TYPE "BehaviorTargetSource" ADD VALUE 'TUNING_CHAT';

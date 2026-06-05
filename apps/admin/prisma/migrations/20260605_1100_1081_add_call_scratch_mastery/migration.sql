-- #1081 Slice 1: per-call scratch mastery for Playbook.config.useFreshMastery.
--
-- Routes mastery writes from Exam Assessment (and any future playbook with
-- useFreshMastery: true) into Call.scratchMastery JSON instead of the
-- long-term CallerAttribute.lo_mastery:* store. AGGREGATE writes; ADAPT/COMPOSE
-- read. Shape: { [key: string]: number | string } where key is the same
-- `lo_mastery:{moduleSlug}:{loRef}` form used in CallerAttribute.key.
--
-- Nullable, no default — existing Call rows stay null (no data backfill
-- needed). New writes populate only when the call's Playbook opts in.

ALTER TABLE "Call" ADD COLUMN "scratchMastery" JSONB;

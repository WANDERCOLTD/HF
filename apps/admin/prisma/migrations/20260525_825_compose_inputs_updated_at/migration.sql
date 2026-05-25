-- #825 — Compose-input staleness markers.
--
-- Adds a nullable timestamp column to each scope (Playbook, Caller, Domain)
-- that flows into the composed prompt. Null = epoch (never-stale). Bumped by
-- Stories 2–6 writer helpers; read by lib/compose/staleness.ts::isPromptStale
-- at COMPOSE-stage call-start.
--
-- Non-destructive: nullable column, no backfill required. Default null
-- preserves byte-identical compose OUTPUT before any writers are migrated
-- (null treated as epoch < every real composedAt → not stale → cached
-- prompt served instead of recomposed; compose is deterministic so output
-- text is identical).

ALTER TABLE "Playbook" ADD COLUMN "composeInputsUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Caller"   ADD COLUMN "composeInputsUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Domain"   ADD COLUMN "composeInputsUpdatedAt" TIMESTAMP(3);

-- #566 Step 1: add nullable evidence-aware fields to CallScore.
--
-- Shadow fields populated by the batched scorer when the LLM returns the
-- new `he` / `eq` keys. Legacy code paths (mock engine, segment runner with
-- old prompt shape) leave them null. Step 3 of the mode-kill epic uses
-- these fields to route IELTS-listed playbooks through an evidence-driven
-- gate instead of the legacy mode-based gate.
--
-- Pure additive migration — no defaults, no backfill, no constraint
-- changes. Safe under concurrent writes.

ALTER TABLE "CallScore"
  ADD COLUMN "hasLearnerEvidence" BOOLEAN,
  ADD COLUMN "evidenceQuality" DOUBLE PRECISION;

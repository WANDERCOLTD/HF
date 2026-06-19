-- #1948 — DomainGroup taxonomy clean-up (epic #1946 S3).
--
-- Consolidates the 18 distinct `Parameter.domainGroup` spellings into
-- 10 canonical group names per docs/PARAMETER-TAXONOMY.md v1.0.
--
-- Pre-migration distribution (verified 2026-06-18 against the registry):
--   curriculum-adaptation  : 25
--   learning-adaptation    : 24
--   companion              : 15
--   learning               : 15
--   supervision            : 12
--   engagement             : 10
--   personality-adaptation : 9
--   curriculum             : 7
--   style                  : 6
--   onboarding             : 5
--   personality            : 5
--   reinforcement          : 5
--   interaction_adaptation : 4
--   learning_adaptation    : 4
--   engagement_adaptation  : 3
--   companion-behavior     : 2
--   pacing_adaptation      : 2
--   feedback_adaptation    : 1
--
-- Post-migration: 10 canonical groups. `voice-delivery` is reserved as
-- a placeholder for S5's voice-surface promotion (epic #1946 S5 / #1952).
--
-- Idempotency: the WHERE clauses only match the legacy variant
-- spellings. Re-running this migration on a rows-already-normalised
-- DB is a no-op. The canonical destination spellings never appear in
-- any WHERE clause.
--
-- No `BehaviorTarget` migration is needed — that table joins through
-- `parameterId`, not `domainGroup` (verified by TL in the epic grooming).

-- ── learning-adaptation cluster (49 entries total post-merge) ──────────
UPDATE "Parameter"
SET "domainGroup" = 'learning-adaptation'
WHERE "domainGroup" IN (
  'learning_adaptation',
  'learning',
  'interaction_adaptation',
  'pacing_adaptation'
);

-- ── curriculum-adaptation cluster (32 entries) ────────────────────────
UPDATE "Parameter"
SET "domainGroup" = 'curriculum-adaptation'
WHERE "domainGroup" = 'curriculum';

-- ── personality-adaptation cluster (14 entries) ───────────────────────
UPDATE "Parameter"
SET "domainGroup" = 'personality-adaptation'
WHERE "domainGroup" = 'personality';

-- ── companion cluster (17 entries) ─────────────────────────────────────
UPDATE "Parameter"
SET "domainGroup" = 'companion'
WHERE "domainGroup" = 'companion-behavior';

-- ── engagement cluster (13 entries) ────────────────────────────────────
UPDATE "Parameter"
SET "domainGroup" = 'engagement'
WHERE "domainGroup" = 'engagement_adaptation';

-- ── reinforcement cluster (6 entries) ──────────────────────────────────
-- `feedback_adaptation` (1 entry) folds into `reinforcement` — feedback
-- IS reinforcement; the underscore-suffixed split was historical drift.
UPDATE "Parameter"
SET "domainGroup" = 'reinforcement'
WHERE "domainGroup" = 'feedback_adaptation';

-- ── behavior-core cluster (6 entries) ──────────────────────────────────
-- `style` becomes `behavior-core` — formality/warmth/directness are core
-- tutor behaviour, not a separate "style" axis. Several of these are
-- `*_actual` measured-value siblings of canonical BEH-* params and may
-- be deprecated by S1 (#1949) dedup; this migration only addresses the
-- group label, not the deprecation status.
UPDATE "Parameter"
SET "domainGroup" = 'behavior-core'
WHERE "domainGroup" = 'style';

-- ── unchanged canonical groups (no UPDATE needed) ──────────────────────
-- supervision         : 12 entries
-- onboarding          : 5 entries
-- voice-delivery      : 0 entries (placeholder for #1952 / S5)

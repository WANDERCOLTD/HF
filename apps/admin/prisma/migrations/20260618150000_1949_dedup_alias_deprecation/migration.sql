-- #1949 — Parameter conceptual dedup + VARK deprecation.
--
-- See docs/PARAMETER-DEDUP-DECISIONS.md for the full per-cluster
-- rationale + pedagogy review sign-off.
--
-- This migration:
--   1. Re-points BehaviorTarget rows from loser → winner parameterId
--      per cluster (warmth, pace, formality, directness, empathy)
--   2. Marks the 14 loser rows + 4 VARK rows as deprecated
--   3. Adds the loser ids to the winner's aliases[] so the resolver
--      at lib/registry/resolve.ts can follow them
--   4. Expires existing BehaviorTarget rows on the 4 VARK params
--      (no canonical replacement — they're dead IP)
--
-- Idempotency: all UPDATEs are scoped by the SOURCE parameterId. Once
-- run, the loser id no longer exists on any BehaviorTarget row, so the
-- WHERE clause matches zero rows on re-run. The Parameter deprecation
-- UPDATE is similarly scoped to non-deprecated source rows. Safe to
-- re-run.
--
-- Sibling-writer survey result: BehaviorTarget unique constraint is
-- (parameterId, scope, playbookId, callerId, effectiveUntil).
-- Re-pointing loser → winner can cause UNIQUE collisions when the
-- winner already has a row at the same scope. The migration handles
-- this with a TWO-PASS pattern: first delete colliding-source rows
-- (preserving the winner's existing value via the MAX semantics
-- the cascade reader applies), then re-key the remaining non-colliding
-- losers.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
-- Cluster 1: Warmth
-- Winner: BEH-WARMTH
-- Losers: warmth_actual, BEH-CONVERSATIONAL-TONE
-- ──────────────────────────────────────────────────────────────────────

-- Pass A: drop loser rows that would collide with the winner. The
-- winner's existing value stays — it's the canonical scope's value.
DELETE FROM "BehaviorTarget"
WHERE "parameterId" IN ('warmth_actual', 'BEH-CONVERSATIONAL-TONE')
AND EXISTS (
  SELECT 1 FROM "BehaviorTarget" w
  WHERE w."parameterId" = 'BEH-WARMTH'
  AND w."scope" = "BehaviorTarget"."scope"
  AND COALESCE(w."playbookId", '') = COALESCE("BehaviorTarget"."playbookId", '')
  AND COALESCE(w."callerId", '') = COALESCE("BehaviorTarget"."callerId", '')
  AND w."effectiveUntil" IS NULL
  AND "BehaviorTarget"."effectiveUntil" IS NULL
);

-- Pass B: re-key surviving losers → winner
UPDATE "BehaviorTarget"
SET "parameterId" = 'BEH-WARMTH'
WHERE "parameterId" IN ('warmth_actual', 'BEH-CONVERSATIONAL-TONE');

-- Pass C: deprecate the loser Parameter rows + record aliases on winner
UPDATE "Parameter"
SET "deprecatedAt" = NOW()
WHERE "parameterId" IN ('warmth_actual', 'BEH-CONVERSATIONAL-TONE')
AND "deprecatedAt" IS NULL;

UPDATE "Parameter"
SET "aliases" = ARRAY(
  SELECT DISTINCT unnest("aliases" || ARRAY['warmth_actual', 'BEH-CONVERSATIONAL-TONE'])
)
WHERE "parameterId" = 'BEH-WARMTH';

-- ──────────────────────────────────────────────────────────────────────
-- Cluster 2: Pace
-- Winner: BEH-PACE-MATCH
-- Losers: CONV_PACE, adapt_to_pace_preference, pace_indicators, pacing_actual
-- ──────────────────────────────────────────────────────────────────────

DELETE FROM "BehaviorTarget"
WHERE "parameterId" IN ('CONV_PACE', 'adapt_to_pace_preference', 'pace_indicators', 'pacing_actual')
AND EXISTS (
  SELECT 1 FROM "BehaviorTarget" w
  WHERE w."parameterId" = 'BEH-PACE-MATCH'
  AND w."scope" = "BehaviorTarget"."scope"
  AND COALESCE(w."playbookId", '') = COALESCE("BehaviorTarget"."playbookId", '')
  AND COALESCE(w."callerId", '') = COALESCE("BehaviorTarget"."callerId", '')
  AND w."effectiveUntil" IS NULL
  AND "BehaviorTarget"."effectiveUntil" IS NULL
);

UPDATE "BehaviorTarget"
SET "parameterId" = 'BEH-PACE-MATCH'
WHERE "parameterId" IN ('CONV_PACE', 'adapt_to_pace_preference', 'pace_indicators', 'pacing_actual');

UPDATE "Parameter"
SET "deprecatedAt" = NOW()
WHERE "parameterId" IN ('CONV_PACE', 'adapt_to_pace_preference', 'pace_indicators', 'pacing_actual')
AND "deprecatedAt" IS NULL;

UPDATE "Parameter"
SET "aliases" = ARRAY(
  SELECT DISTINCT unnest(
    "aliases" || ARRAY['CONV_PACE', 'adapt_to_pace_preference', 'pace_indicators', 'pacing_actual']
  )
)
WHERE "parameterId" = 'BEH-PACE-MATCH';

-- ──────────────────────────────────────────────────────────────────────
-- Cluster 3: Formality
-- Winner: BEH-FORMALITY
-- Losers: formality-level, formality_actual
-- ──────────────────────────────────────────────────────────────────────

DELETE FROM "BehaviorTarget"
WHERE "parameterId" IN ('formality-level', 'formality_actual')
AND EXISTS (
  SELECT 1 FROM "BehaviorTarget" w
  WHERE w."parameterId" = 'BEH-FORMALITY'
  AND w."scope" = "BehaviorTarget"."scope"
  AND COALESCE(w."playbookId", '') = COALESCE("BehaviorTarget"."playbookId", '')
  AND COALESCE(w."callerId", '') = COALESCE("BehaviorTarget"."callerId", '')
  AND w."effectiveUntil" IS NULL
  AND "BehaviorTarget"."effectiveUntil" IS NULL
);

UPDATE "BehaviorTarget"
SET "parameterId" = 'BEH-FORMALITY'
WHERE "parameterId" IN ('formality-level', 'formality_actual');

UPDATE "Parameter"
SET "deprecatedAt" = NOW()
WHERE "parameterId" IN ('formality-level', 'formality_actual')
AND "deprecatedAt" IS NULL;

UPDATE "Parameter"
SET "aliases" = ARRAY(
  SELECT DISTINCT unnest("aliases" || ARRAY['formality-level', 'formality_actual'])
)
WHERE "parameterId" = 'BEH-FORMALITY';

-- ──────────────────────────────────────────────────────────────────────
-- Cluster 4: Directness
-- Winner: BEH-DIRECTNESS
-- Loser: directness_actual
-- ──────────────────────────────────────────────────────────────────────

DELETE FROM "BehaviorTarget"
WHERE "parameterId" = 'directness_actual'
AND EXISTS (
  SELECT 1 FROM "BehaviorTarget" w
  WHERE w."parameterId" = 'BEH-DIRECTNESS'
  AND w."scope" = "BehaviorTarget"."scope"
  AND COALESCE(w."playbookId", '') = COALESCE("BehaviorTarget"."playbookId", '')
  AND COALESCE(w."callerId", '') = COALESCE("BehaviorTarget"."callerId", '')
  AND w."effectiveUntil" IS NULL
  AND "BehaviorTarget"."effectiveUntil" IS NULL
);

UPDATE "BehaviorTarget"
SET "parameterId" = 'BEH-DIRECTNESS'
WHERE "parameterId" = 'directness_actual';

UPDATE "Parameter"
SET "deprecatedAt" = NOW()
WHERE "parameterId" = 'directness_actual'
AND "deprecatedAt" IS NULL;

UPDATE "Parameter"
SET "aliases" = ARRAY(SELECT DISTINCT unnest("aliases" || ARRAY['directness_actual']))
WHERE "parameterId" = 'BEH-DIRECTNESS';

-- ──────────────────────────────────────────────────────────────────────
-- Cluster 5: Empathy
-- Winner: BEH-EMPATHY-RATE
-- Losers: empathy_expression, response_empathy_score
-- ──────────────────────────────────────────────────────────────────────

DELETE FROM "BehaviorTarget"
WHERE "parameterId" IN ('empathy_expression', 'response_empathy_score')
AND EXISTS (
  SELECT 1 FROM "BehaviorTarget" w
  WHERE w."parameterId" = 'BEH-EMPATHY-RATE'
  AND w."scope" = "BehaviorTarget"."scope"
  AND COALESCE(w."playbookId", '') = COALESCE("BehaviorTarget"."playbookId", '')
  AND COALESCE(w."callerId", '') = COALESCE("BehaviorTarget"."callerId", '')
  AND w."effectiveUntil" IS NULL
  AND "BehaviorTarget"."effectiveUntil" IS NULL
);

UPDATE "BehaviorTarget"
SET "parameterId" = 'BEH-EMPATHY-RATE'
WHERE "parameterId" IN ('empathy_expression', 'response_empathy_score');

UPDATE "Parameter"
SET "deprecatedAt" = NOW()
WHERE "parameterId" IN ('empathy_expression', 'response_empathy_score')
AND "deprecatedAt" IS NULL;

UPDATE "Parameter"
SET "aliases" = ARRAY(
  SELECT DISTINCT unnest("aliases" || ARRAY['empathy_expression', 'response_empathy_score'])
)
WHERE "parameterId" = 'BEH-EMPATHY-RATE';

-- ──────────────────────────────────────────────────────────────────────
-- VARK / Learning Styles deprecation (4 params, no replacement)
--
-- These four parameters are based on the VARK matching hypothesis,
-- which has no empirical support (Pashler 2008 + 2024 meta-analysis
-- d = 0.04). Deprecated without a canonical replacement — dead IP.
-- See docs/PARAMETER-TAXONOMY.md "Note on learning styles" + the
-- pedagogy review comment on PR #1959.
--
-- BehaviorTarget rows on these are EXPIRED (set effectiveUntil = NOW),
-- not re-pointed, since there's no winner. Operators who tuned them
-- will see those tunes stop flowing into the cascade after the
-- migration; the values stay queryable for audit.
-- ──────────────────────────────────────────────────────────────────────

UPDATE "BehaviorTarget"
SET "effectiveUntil" = NOW()
WHERE "parameterId" IN (
  'adapt_to_learning_style',
  'auditory_adaptation',
  'kinesthetic_adaptation',
  'visual_adaptation'
)
AND "effectiveUntil" IS NULL;

UPDATE "Parameter"
SET "deprecatedAt" = NOW()
WHERE "parameterId" IN (
  'adapt_to_learning_style',
  'auditory_adaptation',
  'kinesthetic_adaptation',
  'visual_adaptation'
)
AND "deprecatedAt" IS NULL;

COMMIT;

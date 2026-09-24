-- #2039 — S3b: Parameter.domainGroup data migration (epic #2031).
--
-- Applies the canonical mapping ratified in docs/decisions/2026-06-19-
-- parameter-domain-group-mapping.md (PR #2044, S3a). Brings every live
-- Parameter row into the canonical 12-tuple at
-- apps/admin/lib/registry/canonical-domain-group.ts.
--
-- Operator ratifications (2026-06-19, ADR PR #2044):
--   - C: ratify  (3 single-row clusters mapped as proposed)
--   - D: populate (4 LEARNER-SIDE clusters → learner-model placeholder)
--   - E: a       (Path (a) — deprecate + force-bucket to supervision)
--
-- Audit data (PR #2036, both DBs combined):
--   - hf_sandbox : 96 of 211 rows off-canonical across 19 distinct values
--   - hf_staging : 145 of 206 rows off-canonical across 28 distinct values
--   - Combined  : 29 distinct off-canonical values → 220 rows reclassified
--
-- Idempotency: every WHERE clause names ONLY off-canonical (legacy) values.
-- Re-running on a clean DB is a no-op. Canonical destinations never appear
-- in any WHERE.
--
-- No BehaviorTarget migration needed — that table joins through
-- parameterId, not domainGroup (verified by TL in epic #1948 grooming).
--
-- Sibling-writer survey (Lattice mandatory): no new writers in this PR;
-- pure data migration. Runtime drift channel already closed by S1 (#2034
-- ESLint hf-spec/no-bare-parameter-write) + canonical-helper chokepoints
-- (#2029, #2030). Audit population is incumbent debt only.
--
-- Verification (post-migrate):
--   npm run check:fk   → Query 13 (parameter-domain-group-off-canonical)
--                         expected: 0 rows on both DBs
--   When green on hf_staging + hf_sandbox, unblocks S3c (#2031) CHECK
--   constraint migration as the final structural backstop.


-- ────────────────────────────────────────────────────────────────────────
-- Group A — Mechanical normalisation (12 distinct values → 75 rows)
-- Re-applies the #1948 migration UPDATE clauses for any legacy variants
-- that survived (hf_staging didn't pick up #1948; sandbox did) + adds
-- the new mechanical mapping for `retention`.
-- ────────────────────────────────────────────────────────────────────────

-- learning-adaptation cluster (re-application of #1948)
UPDATE "Parameter"
SET "domainGroup" = 'learning-adaptation'
WHERE "domainGroup" IN (
  'learning_adaptation',
  'learning',
  'interaction_adaptation',
  'pacing_adaptation'
);

-- curriculum-adaptation cluster (re-application + new mechanical mapping)
UPDATE "Parameter"
SET "domainGroup" = 'curriculum-adaptation'
WHERE "domainGroup" IN (
  'curriculum',
  'curriculum_adaptation'  -- NEW: underscore variant absent from #1948 migration
);

-- personality-adaptation cluster (re-application of #1948)
UPDATE "Parameter"
SET "domainGroup" = 'personality-adaptation'
WHERE "domainGroup" = 'personality';

-- companion cluster (re-application of #1948)
UPDATE "Parameter"
SET "domainGroup" = 'companion'
WHERE "domainGroup" = 'companion-behavior';

-- engagement cluster (re-application of #1948)
UPDATE "Parameter"
SET "domainGroup" = 'engagement'
WHERE "domainGroup" = 'engagement_adaptation';

-- reinforcement cluster (re-application of #1948)
UPDATE "Parameter"
SET "domainGroup" = 'reinforcement'
WHERE "domainGroup" = 'feedback_adaptation';

-- behavior-core cluster (re-application of #1948 + NEW mechanical `retention`
-- mapping for the single mis-bucketed BEH_WARMTH row)
UPDATE "Parameter"
SET "domainGroup" = 'behavior-core'
WHERE "domainGroup" IN (
  'style',
  'retention'  -- NEW: 1 mis-bucketed BEH_WARMTH row
);


-- ────────────────────────────────────────────────────────────────────────
-- Group B — Pedagogy-confirmed by row inspection (6 distinct → 47 rows)
-- NEW post-#1948 drift. Each mapping grounded in row content (name +
-- definition) and the v1.0 taxonomy doc (PARAMETER-TAXONOMY.md).
-- ────────────────────────────────────────────────────────────────────────

-- VARK / modality knobs → learning-adaptation
-- (same lineage as #1948's `interaction_adaptation` + `pacing_adaptation`;
--  the wider learning-adaptation cluster; pedagogy doc flags these as
--  S1 #1949 dedup candidates due to lack of empirical support)
UPDATE "Parameter"
SET "domainGroup" = 'learning-adaptation'
WHERE "domainGroup" IN (
  'modality_adaptation',
  'profile_adaptation'
);

-- Tutor-side curriculum-decision rules → curriculum-adaptation
-- (all three rows have "Adjusts X based on Y scores" definitions — textbook
--  curriculum-adaptation per the taxonomy doc's Vygotsky/ZPD framing)
UPDATE "Parameter"
SET "domainGroup" = 'curriculum-adaptation'
WHERE "domainGroup" IN (
  'coaching-adaptation',
  'comprehension-adaptation',
  'discussion-adaptation'
);

-- Prosody knobs (Pace WPM + Hesitation Rate, written by prosody-consumer.ts)
-- → voice-delivery (the textbook S5/#1952 population this placeholder was
--  reserved for in PARAMETER-TAXONOMY.md §10)
UPDATE "Parameter"
SET "domainGroup" = 'voice-delivery'
WHERE "domainGroup" = 'voice';


-- ────────────────────────────────────────────────────────────────────────
-- Group C — Operator-ratified (3 single-row clusters)
-- C: ratify (2026-06-19 ADR sign-off)
-- ────────────────────────────────────────────────────────────────────────

-- Per-Skill EMA Aggregation rule (AGGREGATE pipeline rule) → supervision
UPDATE "Parameter"
SET "domainGroup" = 'supervision'
WHERE "domainGroup" = 'skill-assessment';

-- Strategy Resolution Rules (goal-strategy dispatch config) → supervision
UPDATE "Parameter"
SET "domainGroup" = 'supervision'
WHERE "domainGroup" = 'goal-tracking';

-- Mastery Threshold (Tolerance) override → curriculum-adaptation
-- (threshold gates curriculum-sequencing decisions)
UPDATE "Parameter"
SET "domainGroup" = 'curriculum-adaptation'
WHERE "domainGroup" = 'tolerance';


-- ────────────────────────────────────────────────────────────────────────
-- Group D — Operator-ratified: populate `learner-model` placeholder
-- D: populate (2026-06-19 ADR sign-off — ~80 LEARNER-SIDE skill rows)
--
-- Per PARAMETER-TAXONOMY.md §11, `learner-model` was reserved as an empty
-- placeholder at v1.0 with the note that "a few [parameters] sit in
-- learning-adaptation … and would migrate here in a future curation pass."
-- This migration IS that curation pass — the four large LEARNER-SIDE
-- clusters all share one shape (skill descriptions / competency
-- aggregations) and map cleanly onto the ITS 4-component standard's
-- Student/Learner Model layer.
-- ────────────────────────────────────────────────────────────────────────

UPDATE "Parameter"
SET "domainGroup" = 'learner-model'
WHERE "domainGroup" IN (
  'skill',           -- IELTS speaking skills + Big Five articulation + CIO commercial skills + Cialdini-spotting
  'coaching',        -- goal_clarity + self_awareness + action_commitment + follow_through + competency
  'comprehension',   -- PIRLS/KS2-aligned reading skills (inference / vocabulary / retrieval / etc.)
  'discussion'       -- perspective_diversity + position_shift + reflection_quality + argument_quality + competency
);


-- ────────────────────────────────────────────────────────────────────────
-- Group E — Operator-ratified Path (a): deprecate + force-bucket
-- E: a (2026-06-19 ADR sign-off)
--
-- 12 rows are SYSTEM/CONFIG entries (Activity Catalog, Pipeline Stage
-- Configuration, Launch Steps, Wizard Step Definitions, etc.) that don't
-- belong in the pedagogy taxonomy. Path (a) = deprecate AND force-bucket
-- to `supervision` in the same transaction. Lowest operational risk;
-- preserves the v1.0 taxonomy's pedagogy integrity; the deprecatedAt
-- timestamp flags the 12 rows for proper relocation in a follow-on epic
-- (likely a separate SystemConfig table or seed-driven config).
-- ────────────────────────────────────────────────────────────────────────

UPDATE "Parameter"
SET "domainGroup" = 'supervision',
    "deprecatedAt" = NOW()
WHERE "domainGroup" IN (
  'pedagogy',  -- Activity Catalog + Activity Selection Strategy
  'pipeline',  -- Pipeline Stage Configuration
  'system',    -- Domain Readiness Checks + Launch Steps
  'wizard'     -- Wizard Step Definitions
)
  AND "deprecatedAt" IS NULL;  -- idempotent: don't re-stamp if already deprecated


-- ────────────────────────────────────────────────────────────────────────
-- Post-migration audit (manual verification)
-- ────────────────────────────────────────────────────────────────────────
-- Operator runs after `prisma migrate deploy` on each hosted DB:
--
--   DATABASE_URL=$(gcloud secrets versions access latest \
--     --secret=DATABASE_URL_SANDBOX --project=hf-admin-prod) \
--   npm run check:fk
--
--   Expected output: `✓ parameter-domain-group-off-canonical — 0 rows`
--
-- Repeat with DATABASE_URL_STAGING. When both DBs return 0, S3c (#2031)
-- can land the Postgres CHECK constraint as the final structural backstop.

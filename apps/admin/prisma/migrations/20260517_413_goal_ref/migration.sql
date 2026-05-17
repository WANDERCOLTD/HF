-- #413 P5a — add `Goal.ref` column and backfill from `Playbook.config.goals[*]`.
--
-- The wizard projection (#338) attaches `ref` (e.g. "OUT-01", "SKILL-02") to
-- each `GoalTemplate` in `Playbook.config.goals`. Until now, that ref was
-- silently dropped by `lib/enrollment/instantiate-goals.ts` when creating
-- `Goal` rows. Without `Goal.ref`, downstream derivation (#414 LEARN P5b,
-- #417 ACHIEVE P5b) cannot tell which LO or skill each goal is tracking,
-- so all LEARN goals end up reading the same derived value.
--
-- This migration is backwards-safe — nullable column, no existing rows
-- changed by the schema step. The backfill step is best-effort: it copies
-- `ref` over by matching `Goal.name` against `Playbook.config.goals[*].name`
-- inside the same playbook. Goals without a matching template entry stay
-- NULL (legacy / hand-authored / caller-discovered goals).

BEGIN;

-- ── Schema ────────────────────────────────────────────────────────────────

ALTER TABLE "Goal" ADD COLUMN "ref" TEXT;

CREATE INDEX "Goal_callerId_ref_idx" ON "Goal"("callerId", "ref");

-- ── Backfill ──────────────────────────────────────────────────────────────
--
-- Match Goal.name → Playbook.config.goals[*].name within the same playbook,
-- then copy goalConfig.ref to Goal.ref. Done in a single UPDATE using
-- jsonb_array_elements to expand the goals array.

UPDATE "Goal" g
SET    "ref" = (gc->>'ref')
FROM   "Playbook" p,
       LATERAL jsonb_array_elements(COALESCE(p.config->'goals', '[]'::jsonb)) AS gc
WHERE  g."playbookId" = p.id
  AND  g."ref" IS NULL
  AND  gc->>'name' = g.name
  AND  gc->>'ref' IS NOT NULL;

COMMIT;

-- ── Verification (run manually after migration) ───────────────────────────
--
-- 1. Opal's LEARN goals should have OUT-01..OUT-08 refs after backfill:
--   SELECT id, name, ref, type FROM "Goal"
--   WHERE "callerId" = 'b9ad0217-9202-4f32-b358-6a79783170ef'
--     AND type = 'LEARN'
--   ORDER BY ref NULLS LAST;
--
-- 2. Opal's ACHIEVE goals should have SKILL-01..SKILL-04 refs:
--   SELECT id, name, ref FROM "Goal"
--   WHERE "callerId" = 'b9ad0217-9202-4f32-b358-6a79783170ef'
--     AND type = 'ACHIEVE';
--
-- 3. Goals without a template match remain NULL (legacy / hand-authored):
--   SELECT type, COUNT(*) FROM "Goal" WHERE ref IS NULL GROUP BY type;

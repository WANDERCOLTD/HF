-- Pre/post-deploy audit for #1609 (Reward-loop close).
--
-- Pre-#1609 baseline (hf-dev sandbox 2026-06-14):
--   targetUpdatesApplied IS NULL  : 73 rows  (ALL of them — writer never called)
--   targetUpdatesApplied = []     :  0 rows
--   targetUpdatesApplied populated:  0 rows
--
-- Post-#1609 expectation:
--   NULL count stops growing (historical 73 rows remain unless Slice 3 backfill runs)
--   Empty-array [] grows steadily — every new call where no parameter
--     diffs cross the tolerance threshold leaves a `[]` sentinel
--   Populated grows steadily when learners drift from their targets
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/audit-reward-target-updates.sql
--
-- The (a) bucket should plateau at its pre-deploy count after a few
-- production calls land. The (b) + (c) buckets should grow. If (a)
-- keeps growing for new calls after the deploy, the ADAPT executor's
-- sub-op 8 wire-up is failing silently — check PR #1625's silent-writer
-- detector at /x/system/pipeline-health for the ADAPT.callerTarget pair.

SELECT
  CASE
    WHEN "targetUpdatesApplied" IS NULL THEN '(a) NULL — writer never fired'
    WHEN "targetUpdatesApplied"::text = '[]' THEN '(b) [] sentinel — writer fired, no updates needed'
    ELSE '(c) populated — writer fired with target adjustments'
  END AS state,
  COUNT(*) AS rows,
  MIN("scoredAt"::date) AS earliest_scored,
  MAX("scoredAt"::date) AS latest_scored
FROM "RewardScore"
GROUP BY 1
ORDER BY 1;

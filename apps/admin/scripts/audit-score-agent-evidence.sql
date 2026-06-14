-- Pre/post-deploy audit for #1608 (PR #1613).
--
-- Pre-fix baseline (hf-dev sandbox 2026-06-14):
--   placeholder ["AI analysis"] : 4259 rows
--   mock ["Mock batched..."]    :  450 rows
--   real transcript quote       :    0 rows
--
-- Post-fix expectation:
--   placeholder count stops growing (historical rows remain — NOT backfilled).
--   New BehaviorMeasurement rows written after deploy carry real verbatim
--   learner quotes from the SCORE_AGENT batch prompt's `e` field.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/audit-score-agent-evidence.sql
--
-- Verify post-deploy:
--   The (b) placeholder bucket should plateau at its pre-deploy count.
--   The (f) real-quote bucket should grow as new calls are pipelined.
--   Bonus: spot-check the (f) bucket's evidence content matches transcript
--   excerpts you can find in the corresponding Call row.

SELECT
  CASE
    WHEN array_length(evidence,1) IS NULL THEN '(a) empty array — model returned no evidence (honest fail)'
    WHEN evidence[1] = 'AI analysis' AND array_length(evidence,1)=1 THEN '(b) PRE-FIX placeholder only'
    WHEN evidence[1] LIKE 'Mock %' THEN '(c) mock engine — expected'
    WHEN evidence[1] LIKE 'Segment: %' THEN '(d) per-segment tag — expected'
    WHEN evidence[1] LIKE 'AI analysis%' THEN '(e) placeholder mixed with content — needs investigation'
    ELSE '(f) real verbatim quote — TARGET STATE'
  END AS shape,
  COUNT(*) AS rows,
  MIN(LENGTH(evidence[1])) AS min_len,
  MAX(LENGTH(evidence[1])) AS max_len,
  ROUND(AVG(LENGTH(evidence[1])))::int AS avg_len,
  MAX("createdAt"::date) AS latest_row_date
FROM "BehaviorMeasurement"
GROUP BY 1
ORDER BY 1;

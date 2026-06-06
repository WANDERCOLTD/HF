-- #1167 — backfill ContentQuestion.assessmentUse from NULL → 'BOTH'.
--
-- Operator-applied SQL. Idempotent. Matches the import-time default that
-- save-questions.ts now applies for new rows. Pre-2026-06-06 imports landed
-- with NULL assessmentUse because XAMS XLSX export doesn't carry the field;
-- the pre-test filter `notIn ['POST_TEST','TUTOR_ONLY']` followed Prisma SQL
-- three-valued logic and silently excluded every NULL row.
--
-- Apply on each environment AFTER deploying the #1167 code changes:
--   * sandbox (hf_sandbox) — confirmed 250 rows on CIO/CTO Standard as of 2026-06-06
--   * staging (hf_staging) — TBD
--   * prod    (hf_prod)    — TBD
--
-- Safety:
--   * TUTOR_QUESTION rows are deliberately left alone (their NULL or
--     TUTOR_ONLY semantics are intentional — see save-questions.ts).
--   * Idempotent: a re-run after the code default applies will be a no-op
--     (no rows with NULL assessmentUse remain).

BEGIN;

WITH affected AS (
  SELECT id
  FROM "ContentQuestion"
  WHERE "assessmentUse" IS NULL
    AND "questionType" <> 'TUTOR_QUESTION'
)
UPDATE "ContentQuestion" cq
SET "assessmentUse" = 'BOTH'
FROM affected
WHERE cq.id = affected.id;

-- Report what changed
SELECT
  COUNT(*) FILTER (WHERE "assessmentUse" IS NULL) AS still_null,
  COUNT(*) FILTER (WHERE "assessmentUse" = 'BOTH') AS now_both,
  COUNT(*) AS total
FROM "ContentQuestion"
WHERE "questionType" <> 'TUTOR_QUESTION';

COMMIT;

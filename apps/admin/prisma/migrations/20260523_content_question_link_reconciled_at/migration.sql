-- Add ContentQuestion.linkReconciledAt — TTL marker for the AI MCQ reconciler.
--
-- Background: the reconciler retried every orphan on every scheduled run,
-- repeatedly burning embedding spend on rows the AI had already declined
-- to match. This column records "we last looked at this row at X" so
-- subsequent reconciles can skip rows attempted within the last ~7 days.
--
-- Pure additive — nullable column, no default, no backfill needed. Existing
-- rows stay null and are eligible for one more attempt; from then on the
-- reconciler stamps the timestamp each time it scans a row.

ALTER TABLE "ContentQuestion"
  ADD COLUMN "linkReconciledAt" TIMESTAMP(3);

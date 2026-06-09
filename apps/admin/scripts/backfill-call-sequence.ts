/**
 * #1344 Slice 4 — `Call.callSequence` column has been DROPPED.
 *
 * This script previously backfilled the column. Its work is now obsolete:
 * the parent Session row owns the per-Caller learner-facing counter
 * (`Session.learnerFacingNumber`), assigned atomically by
 * `createSession` via the `CallerSequenceCounter` table.
 *
 * If you're looking to reconcile per-Caller call numbers after a backfill
 * or migration, run:
 *
 *   npx tsx scripts/backfill-learner-facing-number.ts
 *
 * Kept as a noop entry point so any operator runbook that still
 * references this script gets a clear pointer to the replacement.
 */

console.log(
  "[backfill-call-sequence] OBSOLETE — `Call.callSequence` column was dropped in #1344 Slice 4.",
);
console.log(
  "Use: npx tsx scripts/backfill-learner-facing-number.ts",
);
process.exit(0);

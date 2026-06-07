-- A8 / audit-fix Track A: partial index on the hot read path for the
-- CallerAttribute append-only table. The table is append-with-tombstones
-- (validUntil = NULL marks the live row, non-NULL marks superseded), and
-- every adaptive-loop read filters validUntil IS NULL. As tombstone rows
-- accumulate (one per ADAPT mutation per caller per key), the existing
-- B-tree on (callerId, key) reads more tombstones than live rows for
-- long-running learners. Partial index lets Postgres jump straight to
-- the live tip.
--
-- IF NOT EXISTS so reruns and existing-env replays no-op. Not built
-- CONCURRENTLY because Prisma wraps migrations in a transaction and
-- CONCURRENTLY can't run inside one — same pattern as
-- 20260606190000_1225_playbook_curriculum_one_primary.
CREATE INDEX IF NOT EXISTS "CallerAttribute_active_idx"
  ON "CallerAttribute" ("callerId", "key")
  WHERE "validUntil" IS NULL;

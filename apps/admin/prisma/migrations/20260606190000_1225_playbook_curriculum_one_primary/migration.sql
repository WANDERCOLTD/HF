-- #1225 Slice C — structural belt-and-braces for the
-- ensurePrimaryPlaybookLink invariant. The helper at
-- lib/curriculum/ensure-primary-playbook-link.ts enforces "exactly one
-- PlaybookCurriculum(role='primary') per Playbook" at the application
-- layer. This partial unique index enforces it at the DB layer too, so
-- any out-of-band write (a raw SQL fix-up, a new code path that bypasses
-- the helper, a future tool that promotes a second curriculum to primary
-- without demoting the old one) gets refused with P2002 instead of
-- silently producing the orphan-curriculum bug class (#1184/#1202-#1204).
--
-- Partial unique index — Prisma's schema.prisma cannot express the
-- `WHERE role = 'primary'` clause via @@unique, so this is raw SQL.
--
-- Note on the WHERE clause syntax: PostgreSQL requires the partial index
-- condition to be IMMUTABLE. A literal string comparison qualifies.
-- The role column is a String (per Prisma schema), not an enum.
CREATE UNIQUE INDEX IF NOT EXISTS "PlaybookCurriculum_one_primary_per_playbook"
  ON "PlaybookCurriculum" ("playbookId")
  WHERE "role" = 'primary';

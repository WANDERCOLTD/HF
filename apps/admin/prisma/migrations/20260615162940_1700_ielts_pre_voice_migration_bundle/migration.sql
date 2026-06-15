-- Epic #1700 — IELTS Pre-Voice Testing migration bundle (A/B/C/D).
--
-- All four columns are additive + nullable (A/D) or NOT NULL with a safe
-- DEFAULT (B). No rewrites of existing rows; no unique-key widening; no
-- CHECK constraints. Ship together in one /vm-cpp cycle so the four
-- consuming stories (#1701/#1702/#1703/#1704) start from a stable schema.
--
-- Migration C is comment-only — `CallerModuleProgress.status` is a plain
-- String column (no Postgres enum, no Prisma enum). Adding "LOCKED" as a
-- permitted value requires no DDL; documentation lives in
-- `schema.prisma` and the Theme 5 enforcement story.

-- Migration A — Session.metadata (Theme 3 pinned card + Theme 6 segment
-- labels + Theme 11 focus delta / overall band). Shape declared at
-- `lib/types/json-fields.ts::SessionMetadata`.
ALTER TABLE "Session" ADD COLUMN "metadata" JSONB;

-- Migration B — CallerModuleProgress.incompleteAttempts (Theme 9).
-- Story #1703 writer (`markModuleIncomplete`) increments atomically;
-- waiver triggers on second exit. NOT NULL + DEFAULT 0 backfills cleanly.
ALTER TABLE "CallerModuleProgress"
  ADD COLUMN "incompleteAttempts" INTEGER NOT NULL DEFAULT 0;

-- Migration D — CallScore.segmentKey (Theme 6). Free-text annotation
-- column (course-agnostic). NOT part of any unique constraint — see
-- epic #1700 decision 1 for the idempotence-key rationale.
ALTER TABLE "CallScore" ADD COLUMN "segmentKey" TEXT;

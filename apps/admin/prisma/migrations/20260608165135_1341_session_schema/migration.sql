-- #1341 (epic #1338 Slice 0) — Learner Session schema.
--
-- SCHEMA ONLY. No application code reads or writes `Session`
-- after this migration lands — the builders + reconciler ship in
-- Slices 3 + 5. The migration is additive on the live tables:
--
--   1. RENAMES the NextAuth `Session` → `AuthSession` (data preserved).
--      JWT strategy is active (`lib/auth.ts`), so the NextAuth table is
--      effectively dormant. The wrapper in
--      `apps/admin/lib/auth/with-renamed-session-model.ts` redirects
--      PrismaAdapter session methods at `prisma.authSession.*`.
--   2. CREATES the new `Session` / `CallerSequenceCounter` parent tables
--      + `SessionKind` / `SessionStatus` enums.
--   3. ADDS `Call.sessionId` (nullable, @unique) — backfilled in step (6).
--      Slice 4 enforces NOT NULL after dev/test/prod verification.
--   4. ADDS `ComposedPrompt.triggerSessionId` (nullable) — dual-FK
--      alongside the legacy `triggerCallId`. Slice 4 drops the legacy.
--   5. BACKFILLS one `Session` row per existing `Call` row.
--   6. WIRES `Call.sessionId` → the backfilled `Session.id`.
--   7. SEEDS `CallerSequenceCounter` per (callerId, kind) at MAX+1.
--
-- Idempotency: the CREATE statements use bare `CREATE TABLE` (Prisma
-- convention). The BACKFILL steps are gated on `WHERE NOT EXISTS` /
-- `IS NULL` / `ON CONFLICT DO NOTHING` so a partial re-run is safe.
-- The RENAME is destructive on a re-run — re-applying after step (1)
-- already ran will fail at `ALTER TABLE "Session" RENAME` because
-- `Session` is now the new learner table. Use `_prisma_migrations` to
-- guarantee single-application semantics (Prisma's normal contract).

-- =================================================================
-- Step 1 — Rename NextAuth `Session` → `AuthSession` (preserve data).
-- The data is dormant under JWT strategy but kept intact for safety.
-- =================================================================

-- Drop the legacy FK so we can rename without dragging it.
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_userId_fkey";

-- Rename PK / unique-index / index in lockstep with the table.
ALTER TABLE "Session" RENAME CONSTRAINT "Session_pkey" TO "AuthSession_pkey";
ALTER INDEX "Session_sessionToken_key" RENAME TO "AuthSession_sessionToken_key";

ALTER TABLE "Session" RENAME TO "AuthSession";

-- Re-attach the FK with the new constraint name.
ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- =================================================================
-- Step 2 — Enums for the new Session model.
-- =================================================================

CREATE TYPE "SessionKind" AS ENUM (
  'ENROLLMENT',
  'ASSESSMENT',
  'VOICE_CALL',
  'SIM_CALL',
  'TEXT_CHAT'
);

CREATE TYPE "SessionStatus" AS ENUM (
  'STARTED',
  'ACTIVE',
  'COMPLETED',
  'FAILED',
  'GHOST'
);

-- =================================================================
-- Step 3 — Create the canonical learner `Session` parent table.
-- =================================================================

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "playbookId" TEXT,
    "kind" "SessionKind" NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "learnerFacingNumber" INTEGER,
    "requestedModuleId" TEXT,
    "curriculumModuleId" TEXT,
    "voiceProvider" TEXT,
    "voiceConfigSnapshot" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'STARTED',
    "countsTowardLearnerNumber" BOOLEAN NOT NULL DEFAULT true,
    "countsTowardPipelineNumber" BOOLEAN NOT NULL DEFAULT true,
    "skipStages" TEXT[],
    "usedPromptId" TEXT,
    "producedComposedPromptId" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_callerId_kind_sequenceNumber_key"
    ON "Session"("callerId", "kind", "sequenceNumber");

CREATE INDEX "Session_callerId_startedAt_idx"
    ON "Session"("callerId", "startedAt");

CREATE INDEX "Session_playbookId_idx"     ON "Session"("playbookId");
CREATE INDEX "Session_kind_idx"           ON "Session"("kind");
CREATE INDEX "Session_status_idx"         ON "Session"("status");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_callerId_fkey"
  FOREIGN KEY ("callerId") REFERENCES "Caller"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_playbookId_fkey"
  FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_curriculumModuleId_fkey"
  FOREIGN KEY ("curriculumModuleId") REFERENCES "CurriculumModule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =================================================================
-- Step 4 — Create `CallerSequenceCounter` (atomic sequence per kind).
-- =================================================================

CREATE TABLE "CallerSequenceCounter" (
    "callerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallerSequenceCounter_pkey" PRIMARY KEY ("callerId", "kind")
);

-- =================================================================
-- Step 5 — Dual-FK additions on `Call` and `ComposedPrompt`.
-- Nullable so the migration is non-destructive; Slice 4 tightens.
-- =================================================================

ALTER TABLE "Call" ADD COLUMN "sessionId" TEXT;
CREATE UNIQUE INDEX "Call_sessionId_key" ON "Call"("sessionId");

ALTER TABLE "ComposedPrompt" ADD COLUMN "triggerSessionId" TEXT;
CREATE INDEX "ComposedPrompt_triggerSessionId_idx"
    ON "ComposedPrompt"("triggerSessionId");

-- =================================================================
-- Step 6a — Backfill: one Session row per Call row.
-- Sequence assignment uses ROW_NUMBER unconditionally — the legacy
-- `Call.callSequence` is NOT unique per (callerId, source) (sim test
-- loops reset it to 1 repeatedly), so COALESCE(callSequence, …) would
-- violate `Session_callerId_kind_sequenceNumber_key`. The original
-- callSequence value is preserved in `learnerFacingNumber`, which has
-- no unique constraint and may carry duplicates / NULLs.
-- Tie-break (per kind) on createdAt ASC, id ASC for determinism.
-- =================================================================

WITH ranked AS (
  SELECT
    c.id AS call_id,
    c."callerId",
    c."playbookId",
    c."createdAt",
    c."endedAt",
    c."callSequence",
    c."curriculumModuleId",
    c."voiceProvider",
    c."usedPromptId",
    CASE c.source
      WHEN 'vapi' THEN 'VOICE_CALL'::"SessionKind"
      WHEN 'sim'  THEN 'SIM_CALL'::"SessionKind"
      ELSE             'VOICE_CALL'::"SessionKind"
    END AS kind,
    ROW_NUMBER() OVER (
      PARTITION BY c."callerId",
        CASE c.source
          WHEN 'vapi' THEN 'VOICE_CALL'
          WHEN 'sim'  THEN 'SIM_CALL'
          ELSE             'VOICE_CALL'
        END
      ORDER BY c."createdAt", c.id
    )::int AS seq
  FROM "Call" c
  WHERE c."callerId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Session" s WHERE s.id = c."sessionId"
    )
)
INSERT INTO "Session" (
  id,
  "callerId",
  "playbookId",
  kind,
  "sequenceNumber",
  "learnerFacingNumber",
  "curriculumModuleId",
  "voiceProvider",
  "usedPromptId",
  "startedAt",
  "endedAt",
  status,
  "countsTowardLearnerNumber",
  "countsTowardPipelineNumber",
  "skipStages"
)
SELECT
  gen_random_uuid(),
  r."callerId",
  r."playbookId",
  r.kind,
  r.seq,
  r."callSequence", -- learnerFacingNumber == callSequence for legacy rows
  r."curriculumModuleId",
  r."voiceProvider",
  r."usedPromptId",
  r."createdAt",
  r."endedAt",
  CASE
    WHEN r."endedAt" IS NOT NULL THEN 'COMPLETED'::"SessionStatus"
    ELSE 'GHOST'::"SessionStatus"
  END,
  TRUE,
  TRUE,
  ARRAY[]::text[]
FROM ranked r;

-- =================================================================
-- Step 6b — Wire Call.sessionId to the newly-created Session row.
-- Join key: (callerId, startedAt = createdAt) — paired by row-number
-- to handle Calls that share the same createdAt timestamp for the same
-- caller (ghost-row duplicates). We can no longer use sequenceNumber
-- as a join key because Step 6a now always re-numbers via ROW_NUMBER
-- (the old COALESCE assumed callSequence was unique per kind, which
-- doesn't hold — sim test loops produce many callSequence=1 rows).
-- =================================================================

WITH unmatched AS (
  SELECT
    c.id AS call_id,
    c."callerId",
    c."createdAt",
    ROW_NUMBER() OVER (
      PARTITION BY c."callerId", c."createdAt"
      ORDER BY c.id
    ) AS rn
  FROM "Call" c
  WHERE c."sessionId" IS NULL AND c."callerId" IS NOT NULL
),
candidates AS (
  SELECT
    s.id AS session_id,
    s."callerId",
    s."startedAt",
    ROW_NUMBER() OVER (
      PARTITION BY s."callerId", s."startedAt"
      ORDER BY s."sequenceNumber"
    ) AS rn
  FROM "Session" s
  WHERE NOT EXISTS (SELECT 1 FROM "Call" c WHERE c."sessionId" = s.id)
)
UPDATE "Call" c
SET "sessionId" = pick.session_id
FROM (
  SELECT u.call_id, x.session_id
  FROM unmatched u
  JOIN candidates x
    ON x."callerId" = u."callerId"
   AND x."startedAt" = u."createdAt"
   AND x.rn = u.rn
) pick
WHERE c.id = pick.call_id;

-- Last-resort fallback: any Call row whose sessionId is still NULL is
-- linked to its caller's earliest UNLINKED Session by sequenceNumber.
-- Defends against any (callerId, createdAt) where row-counts mismatch
-- between unmatched and candidates (shouldn't happen post-fix; kept
-- for paranoia).
WITH unmatched AS (
  SELECT c.id AS call_id, c."callerId", c."createdAt"
  FROM "Call" c
  WHERE c."sessionId" IS NULL AND c."callerId" IS NOT NULL
),
candidates AS (
  SELECT DISTINCT ON (s."callerId", s."startedAt", s."sequenceNumber")
    s.id AS session_id,
    s."callerId",
    s."startedAt",
    s."sequenceNumber"
  FROM "Session" s
  WHERE NOT EXISTS (SELECT 1 FROM "Call" c WHERE c."sessionId" = s.id)
  ORDER BY s."callerId", s."startedAt", s."sequenceNumber"
),
pairs AS (
  SELECT
    u.call_id,
    c.session_id,
    ROW_NUMBER() OVER (
      PARTITION BY u."callerId" ORDER BY u."createdAt", u.call_id
    ) AS u_rn,
    ROW_NUMBER() OVER (
      PARTITION BY c."callerId" ORDER BY c."startedAt", c."sequenceNumber"
    ) AS c_rn
  FROM unmatched u
  JOIN candidates c ON c."callerId" = u."callerId"
)
UPDATE "Call" c
SET "sessionId" = p.session_id
FROM pairs p
WHERE c.id = p.call_id AND p.u_rn = p.c_rn;

-- =================================================================
-- Step 6c — FK constraint on Call.sessionId (added after backfill so
-- intermediate state can't fail on dangling references).
-- =================================================================

ALTER TABLE "Call"
  ADD CONSTRAINT "Call_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Session.usedPromptId / Session.producedComposedPromptId FKs are added
-- AFTER backfill in case any Session row's usedPromptId points at a
-- ComposedPrompt that has since been deleted. Both columns are nullable
-- with ON DELETE SET NULL — the constraint is added regardless.
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_usedPromptId_fkey"
  FOREIGN KEY ("usedPromptId") REFERENCES "ComposedPrompt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_producedComposedPromptId_fkey"
  FOREIGN KEY ("producedComposedPromptId") REFERENCES "ComposedPrompt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComposedPrompt"
  ADD CONSTRAINT "ComposedPrompt_triggerSessionId_fkey"
  FOREIGN KEY ("triggerSessionId") REFERENCES "Session"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =================================================================
-- Step 7 — Seed CallerSequenceCounter.
-- nextSeq = MAX(sequenceNumber) + 1 per (callerId, kind). The atomic
-- `UPDATE ... RETURNING nextSeq - 1` pattern (Slice 3) consumes from
-- this row. `ON CONFLICT DO UPDATE` keeps the seed idempotent.
-- =================================================================

INSERT INTO "CallerSequenceCounter" ("callerId", "kind", "nextSeq", "updatedAt")
SELECT
  s."callerId",
  s.kind::text,
  MAX(s."sequenceNumber") + 1,
  NOW()
FROM "Session" s
GROUP BY s."callerId", s.kind
ON CONFLICT ("callerId", "kind")
  DO UPDATE SET
    "nextSeq" = GREATEST(
      "CallerSequenceCounter"."nextSeq",
      EXCLUDED."nextSeq"
    ),
    "updatedAt" = NOW();

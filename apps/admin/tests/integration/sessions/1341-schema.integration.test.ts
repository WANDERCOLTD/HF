/**
 * #1341 (epic #1338 Slice 0) — Session schema integration test.
 *
 * Drives the migration's pre/post data proof. Seeds the
 * `tests/fixtures/sessions/1341-schema-pre.json` fixture into the
 * already-migrated DB (the migration has run via Prisma's normal
 * `migrate dev` flow against the test database), then verifies the
 * post-migration shape matches `1341-schema-post.json`.
 *
 * Because the migration runs at DB-init time (not per-test), the test
 * actually exercises the steady-state shape: the new tables exist, the
 * counter is queryable, the dual-FK columns are nullable but can be
 * populated. The backfill logic itself is verified by a separate
 * operator-runnable proof script (`scripts/proof-1341-schema.ts`)
 * against hf_sandbox, where real Calls existed before the migration
 * ran.
 *
 * This test simulates the migration's effect by:
 *   1. Inserting Caller / Playbook / CurriculumModule reference rows
 *      from the pre-fixture.
 *   2. Inserting the Call rows from the pre-fixture (with
 *      `sessionId = NULL`).
 *   3. Running the migration's backfill SQL (steps 6a / 6b / 7) against
 *      these freshly-inserted rows.
 *   4. Asserting the post-fixture shape.
 *
 * Cleans up everything it created.
 *
 * Required env: `DATABASE_URL` — pointed at a hf_sandbox-shaped DB where
 * the 1341 migration has already applied (Prisma's normal contract).
 *
 * Skips with a console warning if `DATABASE_URL` is not set so the test
 * file is import-safe in environments that can't reach a Postgres
 * instance (CI image without DB).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import preFixture from "../../fixtures/sessions/1341-schema-pre.json";
import postFixture from "../../fixtures/sessions/1341-schema-post.json";

interface SessionRow {
  id: string;
  callerId: string;
  playbookId: string | null;
  kind: string;
  sequenceNumber: number;
  learnerFacingNumber: number | null;
  curriculumModuleId: string | null;
  voiceProvider: string | null;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  countsTowardLearnerNumber: boolean;
  countsTowardPipelineNumber: boolean;
  skipStages: string[];
}

const prisma = new PrismaClient();

const hasDb = !!process.env.DATABASE_URL;

// Probe at describe-load time. Vitest evaluates `describe.skipIf` BEFORE
// `beforeAll`, so if we can't reach Postgres at all the entire suite
// skips cleanly — no half-run state. This mirrors the journey/ tests'
// pattern of failing fast outside CI.
let dbReachable = false;
if (hasDb) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    // DB unreachable — skip the suite.
    dbReachable = false;
  }
}

describe.skipIf(!hasDb || !dbReachable)("#1341 Slice 0 — Session schema backfill", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;

    // Sanity: the new tables must exist (migration has run).
    const sessionTable = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'Session'
    `;
    expect(sessionTable).toHaveLength(1);

    const counterTable = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'CallerSequenceCounter'
    `;
    expect(counterTable).toHaveLength(1);

    // Clean any leftover fixture rows from a prior run.
    await cleanup(prisma);

    // Seed parent rows the FKs depend on.
    await seedReferences(prisma);

    // Insert legacy-shaped Call rows. The backfill we run below mirrors
    // the live migration's steps 6a / 6b / 7.
    for (const call of preFixture.calls) {
      await prisma.$executeRaw`
        INSERT INTO "Call" (id, source, "externalId", transcript, "createdAt",
                            "callerId", "playbookId", "curriculumModuleId",
                            "callSequence", "endedAt", "voiceProvider",
                            "requestedModuleId", "usedPromptId")
        VALUES (${call.id}, ${call.source}, ${call.externalId}, ${call.transcript},
                ${new Date(call.createdAt)}::timestamp,
                ${call.callerId}, ${call.playbookId}, ${call.curriculumModuleId},
                ${call.callSequence},
                ${call.endedAt ? new Date(call.endedAt) : null}::timestamp,
                ${call.voiceProvider}, ${call.requestedModuleId},
                ${call.usedPromptId})
      `;
    }

    // Run the migration's backfill SQL on the just-inserted rows.
    await runBackfill(prisma);
  });

  afterAll(async () => {
    await cleanup(prisma);
    await prisma.$disconnect();
  });

  it("creates one Session per Call row, with the expected (callerId, kind, sequenceNumber) shape", async () => {
    const sessions = await prisma.$queryRaw<SessionRow[]>`
      SELECT * FROM "Session"
      WHERE "callerId" = ${preFixture.callerId}
      ORDER BY "sequenceNumber" ASC
    `;
    expect(sessions).toHaveLength(postFixture.expectedSessions.length);

    for (let i = 0; i < sessions.length; i += 1) {
      const got = sessions[i];
      const want = postFixture.expectedSessions[i];
      expect(got.callerId).toBe(want.callerId);
      expect(got.kind).toBe(want.kind);
      expect(got.sequenceNumber).toBe(want.sequenceNumber);
      expect(got.learnerFacingNumber).toBe(want.learnerFacingNumber);
      expect(got.status).toBe(want.status);
      expect(got.countsTowardLearnerNumber).toBe(want.countsTowardLearnerNumber);
      expect(got.countsTowardPipelineNumber).toBe(want.countsTowardPipelineNumber);
      expect(got.skipStages).toEqual(want.skipStages);
    }
  });

  it("backfills Call.sessionId for every Call (zero NULLs)", async () => {
    const nullRows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Call"
      WHERE "callerId" = ${preFixture.callerId} AND "sessionId" IS NULL
    `;
    expect(Number(nullRows[0].count)).toBe(0);
  });

  it("links every Call to its expected Session via sequenceNumber", async () => {
    for (const link of postFixture.expectedCallLinks) {
      const rows = await prisma.$queryRaw<{ sequenceNumber: number; kind: string }[]>`
        SELECT s."sequenceNumber", s.kind::text AS kind
        FROM "Call" c
        JOIN "Session" s ON s.id = c."sessionId"
        WHERE c.id = ${link.callId}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe(link.sessionKey.kind);
      expect(rows[0].sequenceNumber).toBe(link.sessionKey.sequenceNumber);
    }
  });

  it("seeds CallerSequenceCounter at MAX(sequenceNumber) + 1 per (callerId, kind)", async () => {
    const rows = await prisma.$queryRaw<
      { callerId: string; kind: string; nextSeq: number }[]
    >`
      SELECT "callerId", kind, "nextSeq"
      FROM "CallerSequenceCounter"
      WHERE "callerId" = ${preFixture.callerId}
      ORDER BY kind ASC
    `;
    expect(rows).toHaveLength(postFixture.expectedCallerSequenceCounter.length);
    for (let i = 0; i < rows.length; i += 1) {
      expect(rows[i].callerId).toBe(postFixture.expectedCallerSequenceCounter[i].callerId);
      expect(rows[i].kind).toBe(postFixture.expectedCallerSequenceCounter[i].kind);
      expect(rows[i].nextSeq).toBe(postFixture.expectedCallerSequenceCounter[i].nextSeq);
    }
  });

  it("enforces @@unique([callerId, kind, sequenceNumber]) at the DB layer", async () => {
    const existing = await prisma.$queryRaw<SessionRow[]>`
      SELECT * FROM "Session"
      WHERE "callerId" = ${preFixture.callerId}
        AND kind = 'VOICE_CALL'::"SessionKind"
        AND "sequenceNumber" = 1
      LIMIT 1
    `;
    expect(existing).toHaveLength(1);

    // Attempting to insert a duplicate must raise a unique-constraint violation.
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Session"
          (id, "callerId", kind, "sequenceNumber", "skipStages", "updatedAt")
        VALUES (gen_random_uuid(), ${preFixture.callerId},
                'VOICE_CALL'::"SessionKind", 1, ARRAY[]::text[], NOW())
      ` as unknown as Promise<number>
    ).rejects.toBeTruthy();
  });
});

async function seedReferences(client: PrismaClient): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "Caller" (id, role, "createdAt")
    VALUES (${preFixture.callerId}, 'LEARNER'::"CallerRole", NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  // Domain → Playbook → Curriculum → CurriculumModule chain. Use minimal
  // viable rows. The Playbook needs a Domain FK; pre-create a synthetic
  // domain.
  const domainId = "44444444-4444-4444-4444-domBertieSyn44";
  await client.$executeRaw`
    INSERT INTO "Domain" (id, slug, name, "createdAt", "updatedAt")
    VALUES (${domainId}, '1341-test-domain', '1341 test domain',
            NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  await client.$executeRaw`
    INSERT INTO "Playbook" (id, name, status, version, "domainId",
                            "validationPassed", "createdAt", "updatedAt")
    VALUES (${preFixture.playbookId}, '1341 test playbook',
            'DRAFT'::"PlaybookStatus", '1.0', ${domainId},
            false, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  const curriculumId = "55555555-5555-5555-5555-curBertieSyn55";
  await client.$executeRaw`
    INSERT INTO "Curriculum" (id, name, status, version,
                              "createdAt", "updatedAt")
    VALUES (${curriculumId}, '1341 test curriculum',
            'DRAFT'::"CurriculumStatus", '1.0', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  await client.$executeRaw`
    INSERT INTO "CurriculumModule"
      (id, "curriculumId", slug, title, "sortOrder", "isActive",
       "createdAt", "updatedAt")
    VALUES (${preFixture.curriculumModuleId}, ${curriculumId}, 'part1',
            'Part 1', 0, true, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function runBackfill(client: PrismaClient): Promise<void> {
  // Step 6a — Session row per Call.
  await client.$executeRawUnsafe(`
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
        COALESCE(
          c."callSequence",
          ROW_NUMBER() OVER (
            PARTITION BY c."callerId",
              CASE c.source
                WHEN 'vapi' THEN 'VOICE_CALL'
                WHEN 'sim'  THEN 'SIM_CALL'
                ELSE             'VOICE_CALL'
              END
            ORDER BY c."createdAt", c.id
          )::int
        ) AS seq
      FROM "Call" c
      WHERE c."callerId" = '${preFixture.callerId}'
        AND NOT EXISTS (
          SELECT 1 FROM "Session" s WHERE s.id = c."sessionId"
        )
    )
    INSERT INTO "Session" (
      id, "callerId", "playbookId", kind, "sequenceNumber",
      "learnerFacingNumber", "curriculumModuleId", "voiceProvider",
      "usedPromptId", "startedAt", "endedAt", status,
      "countsTowardLearnerNumber", "countsTowardPipelineNumber", "skipStages"
    )
    SELECT gen_random_uuid(), r."callerId", r."playbookId", r.kind, r.seq,
           r."callSequence", r."curriculumModuleId", r."voiceProvider",
           r."usedPromptId", r."createdAt", r."endedAt",
           CASE WHEN r."endedAt" IS NOT NULL THEN 'COMPLETED'::"SessionStatus"
                ELSE 'GHOST'::"SessionStatus" END,
           TRUE, TRUE, ARRAY[]::text[]
    FROM ranked r
  `);

  // Step 6b — Wire Call.sessionId to the matched Session row.
  await client.$executeRawUnsafe(`
    UPDATE "Call" c
    SET "sessionId" = s.id
    FROM "Session" s
    WHERE c."sessionId" IS NULL
      AND s."callerId" = c."callerId"
      AND s."startedAt" = c."createdAt"
      AND s."sequenceNumber" = COALESCE(c."callSequence", s."sequenceNumber")
  `);

  // Last-resort fallback for un-tied rows.
  await client.$executeRawUnsafe(`
    WITH unmatched AS (
      SELECT c.id AS call_id, c."callerId", c."createdAt"
      FROM "Call" c
      WHERE c."sessionId" IS NULL AND c."callerId" IS NOT NULL
    ),
    candidates AS (
      SELECT DISTINCT ON (s."callerId", s."startedAt", s."sequenceNumber")
        s.id AS session_id, s."callerId", s."startedAt", s."sequenceNumber"
      FROM "Session" s
      WHERE NOT EXISTS (SELECT 1 FROM "Call" c WHERE c."sessionId" = s.id)
      ORDER BY s."callerId", s."startedAt", s."sequenceNumber"
    ),
    pairs AS (
      SELECT u.call_id, c.session_id,
             ROW_NUMBER() OVER (PARTITION BY u."callerId" ORDER BY u."createdAt", u.call_id) AS u_rn,
             ROW_NUMBER() OVER (PARTITION BY c."callerId" ORDER BY c."startedAt", c."sequenceNumber") AS c_rn
      FROM unmatched u
      JOIN candidates c ON c."callerId" = u."callerId"
    )
    UPDATE "Call" c
    SET "sessionId" = p.session_id
    FROM pairs p
    WHERE c.id = p.call_id AND p.u_rn = p.c_rn
  `);

  // Step 7 — seed CallerSequenceCounter.
  await client.$executeRawUnsafe(`
    INSERT INTO "CallerSequenceCounter" ("callerId", "kind", "nextSeq", "updatedAt")
    SELECT s."callerId", s.kind::text, MAX(s."sequenceNumber") + 1, NOW()
    FROM "Session" s
    WHERE s."callerId" = '${preFixture.callerId}'
    GROUP BY s."callerId", s.kind
    ON CONFLICT ("callerId", "kind") DO UPDATE
      SET "nextSeq" = GREATEST("CallerSequenceCounter"."nextSeq", EXCLUDED."nextSeq"),
          "updatedAt" = NOW()
  `);
}

async function cleanup(client: PrismaClient): Promise<void> {
  const callIds = preFixture.calls.map((c) => c.id);
  // FK cascade order: Call → Session → CallerSequenceCounter → Caller / Playbook / etc.
  await client.$executeRawUnsafe(
    `UPDATE "Call" SET "sessionId" = NULL WHERE id = ANY($1::text[])`,
    callIds as unknown as Prisma.Sql
  ).catch(() => undefined);
  await client.$executeRaw`
    DELETE FROM "Call" WHERE id = ANY(${callIds}::text[])
  `;
  await client.$executeRaw`
    DELETE FROM "Session" WHERE "callerId" = ${preFixture.callerId}
  `;
  await client.$executeRaw`
    DELETE FROM "CallerSequenceCounter" WHERE "callerId" = ${preFixture.callerId}
  `;
  await client.$executeRaw`
    DELETE FROM "CurriculumModule" WHERE id = ${preFixture.curriculumModuleId}
  `;
  await client.$executeRaw`
    DELETE FROM "Curriculum" WHERE id = '55555555-5555-5555-5555-curBertieSyn55'
  `;
  await client.$executeRaw`
    DELETE FROM "Playbook" WHERE id = ${preFixture.playbookId}
  `;
  await client.$executeRaw`
    DELETE FROM "Domain" WHERE id = '44444444-4444-4444-4444-domBertieSyn44'
  `;
  await client.$executeRaw`
    DELETE FROM "Caller" WHERE id = ${preFixture.callerId}
  `;
}

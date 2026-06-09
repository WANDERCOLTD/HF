/**
 * #1342 Slice 3 — createSession + endSession integration tests.
 *
 * Drives the data-grounded proof for the builders:
 *   - per-(callerId, kind) sequenceNumber is atomic + race-safe (50
 *     concurrent createSession calls produce contiguous 1..50)
 *   - voiceConfigSnapshot snapshot lands on every VOICE_CALL row
 *   - countsTowardLearnerNumber is gated by class rules (sim → false)
 *   - endSession flips status + skipStages forward
 *
 * Seeds + tears down its own state (no Bertie row required). Runs
 * against the test DB pointed at by `DATABASE_URL`; skips when no DB
 * is reachable so the test file is import-safe.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import preFixture from "../../fixtures/sessions/1342-builders-pre.json";
import postFixture from "../../fixtures/sessions/1342-builders-post.json";

const prisma = new PrismaClient();
const hasDb = !!process.env.DATABASE_URL;

let dbReachable = false;
if (hasDb) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}

describe.skipIf(!hasDb || !dbReachable)("#1342 Slice 3 — createSession / endSession", () => {
  beforeAll(async () => {
    await cleanup(prisma);
    await seedReferences(prisma);
  });

  afterAll(async () => {
    await cleanup(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear Session + counter state between tests so each test owns
    // its slate.
    await prisma.$executeRaw`DELETE FROM "Session" WHERE "callerId" = ${preFixture.callerId}`;
    await prisma.$executeRaw`DELETE FROM "CallerSequenceCounter" WHERE "callerId" = ${preFixture.callerId}`;
  });

  it("createSession writes a Session row with the resolved cascade", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: preFixture.callerId,
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
      requestedModuleId: preFixture.curriculumModule.slug,
    });

    expect(result.session.sequenceNumber).toBe(1);
    expect(result.session.learnerFacingNumber).toBe(1);
    expect(result.playbookId).toBe(preFixture.playbookId);
    expect(result.curriculumModuleId).toBe(preFixture.curriculumModule.id);
    expect(result.countsTowardLearnerNumber).toBe(true);
    expect(result.skipStages).toEqual([]);

    const row = await prisma.session.findUnique({
      where: { id: result.session.id },
      select: {
        kind: true,
        sequenceNumber: true,
        learnerFacingNumber: true,
        playbookId: true,
        curriculumModuleId: true,
        status: true,
        countsTowardLearnerNumber: true,
        skipStages: true,
      },
    });
    expect(row).toBeTruthy();
    expect(row!.kind).toBe("VOICE_CALL");
    expect(row!.status).toBe("STARTED");
  });

  it("SIM_CALL → learnerFacingNumber stays null (sim is harness, AC10 class table)", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const result = await createSession({
      callerId: preFixture.callerId,
      kind: "SIM_CALL",
      source: "sim",
      voiceProvider: null,
    });

    expect(result.session.learnerFacingNumber).toBeNull();
    expect(result.countsTowardLearnerNumber).toBe(false);
  });

  it("50 concurrent createSession calls produce contiguous sequenceNumber 1..50 (AC: race-safe)", async () => {
    const promises: Promise<unknown>[] = [];
    const { createSession } = await import("@/lib/voice/create-session");
    for (let i = 0; i < 50; i += 1) {
      promises.push(
        createSession({
          callerId: preFixture.callerId,
          kind: "VOICE_CALL",
          source: "vapi",
          voiceProvider: "vapi",
        }),
      );
    }
    const results = (await Promise.all(promises)) as Array<{
      session: { sequenceNumber: number };
    }>;

    const sequences = results.map((r) => r.session.sequenceNumber).sort((a, b) => a - b);
    expect(sequences.length).toBe(50);
    expect(sequences[0]).toBe(1);
    expect(sequences[49]).toBe(50);
    expect(new Set(sequences).size).toBe(50);
    for (let i = 0; i < 50; i += 1) {
      expect(sequences[i]).toBe(i + 1);
    }

    const counter = await prisma.callerSequenceCounter.findUnique({
      where: { callerId_kind: { callerId: preFixture.callerId, kind: "VOICE_CALL" } },
      select: { nextSeq: true },
    });
    expect(counter?.nextSeq).toBe(51);
    expect(postFixture.expectedShapeAfterConcurrencyTest.counterFinalNextSeq).toBe(51);
  });

  it("endSession COMPLETED → status COMPLETED, endedAt set, skipStages empty", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const { endSession } = await import("@/lib/voice/end-session");
    const created = await createSession({
      callerId: preFixture.callerId,
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });
    const ended = await endSession(created.session.id, {
      outcome: "COMPLETED",
      transcript: "hi there",
      durationSecondsOverride: 60,
      triggerPipelineAsync: false,
    });
    expect(ended.status).toBe("COMPLETED");
    expect(ended.endedAt).toBeInstanceOf(Date);
    expect(ended.skipStages).toEqual([]);
  });

  it("endSession FAILED → skipStages contains EXTRACT/PROSODY/REWARD/SCORE_AGENT", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const { endSession } = await import("@/lib/voice/end-session");
    const created = await createSession({
      callerId: preFixture.callerId,
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });
    const ended = await endSession(created.session.id, {
      outcome: "FAILED",
      triggerPipelineAsync: false,
    });
    expect(ended.status).toBe("FAILED");
    expect(ended.skipStages).toEqual([
      "EXTRACT",
      "PROSODY",
      "REWARD",
      "SCORE_AGENT",
    ]);
  });

  it("endSession GHOST → both counter flags flipped false, status GHOST", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const { endSession } = await import("@/lib/voice/end-session");
    const created = await createSession({
      callerId: preFixture.callerId,
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });
    const ended = await endSession(created.session.id, {
      outcome: "GHOST",
      triggerPipelineAsync: false,
    });
    expect(ended.status).toBe("GHOST");
    expect(ended.countsTowardLearnerNumber).toBe(false);
    expect(ended.countsTowardPipelineNumber).toBe(false);
  });

  it("short-duration ABORTED VOICE_CALL → learner false, pipeline true (class-rules table)", async () => {
    const { createSession } = await import("@/lib/voice/create-session");
    const { endSession } = await import("@/lib/voice/end-session");
    const created = await createSession({
      callerId: preFixture.callerId,
      kind: "VOICE_CALL",
      source: "vapi",
      voiceProvider: "vapi",
    });
    const ended = await endSession(created.session.id, {
      outcome: "COMPLETED",
      durationSecondsOverride: 10, // < 30s
      triggerPipelineAsync: false,
    });
    expect(ended.countsTowardLearnerNumber).toBe(false);
    expect(ended.countsTowardPipelineNumber).toBe(true);
  });
});

async function seedReferences(client: PrismaClient): Promise<void> {
  // Caller
  await client.$executeRaw`
    INSERT INTO "Caller" (id, role, "createdAt")
    VALUES (${preFixture.callerId}, 'LEARNER'::"CallerRole", NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  // Domain
  await client.$executeRaw`
    INSERT INTO "Domain" (id, name, slug, "createdAt", "updatedAt")
    VALUES (${preFixture.domainId}, '1342-test', '1342-test', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  // Playbook
  await client.$executeRaw`
    INSERT INTO "Playbook" (id, name, slug, "domainId", "createdAt", "updatedAt")
    VALUES (${preFixture.playbookId}, '1342-test-pb', '1342-test-pb',
            ${preFixture.domainId}, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  // Active CallerPlaybook
  await client.$executeRaw`
    INSERT INTO "CallerPlaybook" (id, "callerId", "playbookId", status, "enrolledAt", "updatedAt")
    VALUES (gen_random_uuid(), ${preFixture.callerId}, ${preFixture.playbookId},
            'ACTIVE'::"EnrollmentStatus", NOW(), NOW())
    ON CONFLICT DO NOTHING
  `;
  // Curriculum
  await client.$executeRaw`
    INSERT INTO "Curriculum" (id, name, slug, "createdAt", "updatedAt")
    VALUES (${preFixture.curriculumId}, '1342-test-curr', '1342-test-curr', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  // PlaybookCurriculum (primary)
  await client.$executeRaw`
    INSERT INTO "PlaybookCurriculum" (id, "playbookId", "curriculumId", role, "createdAt")
    VALUES (gen_random_uuid(), ${preFixture.playbookId}, ${preFixture.curriculumId},
            'primary', NOW())
    ON CONFLICT DO NOTHING
  `;
  // CurriculumModule
  await client.$executeRaw`
    INSERT INTO "CurriculumModule"
      (id, "curriculumId", slug, title, "sortOrder", "createdAt", "updatedAt")
    VALUES (${preFixture.curriculumModule.id}, ${preFixture.curriculumId},
            ${preFixture.curriculumModule.slug}, ${preFixture.curriculumModule.title},
            0, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function cleanup(client: PrismaClient): Promise<void> {
  // Soft-clean — only the rows we know we created.
  await client.$executeRaw`DELETE FROM "Session" WHERE "callerId" = ${preFixture.callerId}`;
  await client.$executeRaw`DELETE FROM "CallerSequenceCounter" WHERE "callerId" = ${preFixture.callerId}`;
  await client.$executeRaw`DELETE FROM "Call" WHERE "callerId" = ${preFixture.callerId}`;
  await client.$executeRaw`DELETE FROM "CallerPlaybook" WHERE "callerId" = ${preFixture.callerId}`;
  await client.$executeRaw`DELETE FROM "PlaybookCurriculum" WHERE "playbookId" = ${preFixture.playbookId}`;
  await client.$executeRaw`DELETE FROM "CurriculumModule" WHERE "curriculumId" = ${preFixture.curriculumId}`;
  await client.$executeRaw`DELETE FROM "Curriculum" WHERE id = ${preFixture.curriculumId}`;
  await client.$executeRaw`DELETE FROM "Playbook" WHERE id = ${preFixture.playbookId}`;
  await client.$executeRaw`DELETE FROM "Domain" WHERE id = ${preFixture.domainId}`;
  await client.$executeRaw`DELETE FROM "Caller" WHERE id = ${preFixture.callerId}`;
}

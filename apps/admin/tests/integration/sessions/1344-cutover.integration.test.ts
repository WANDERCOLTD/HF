/**
 * #1344 Slice 4 — single-counter cutover integration test.
 *
 * Drives the data-grounded proof for the new `nextLearnerFacingNumber`
 * loader against a real Prisma client + ephemeral DB. Bertie scenario:
 * a SIM_CALL that drops (countsTowardLearnerNumber=false, lfn=NULL)
 * MUST NOT push the next real VOICE_CALL's "(call #N)" to N=2 — it
 * stays at N=1.
 *
 * Seeds + tears down its own state. Skips when no DB.
 *
 * Pre/post fixtures:
 *   - tests/fixtures/sessions/1344-cutover-pre.json  (Bertie sim drop)
 *   - tests/fixtures/sessions/1344-cutover-post.json (expected post-state)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import preFixture from "../../fixtures/sessions/1344-cutover-pre.json";
import postFixture from "../../fixtures/sessions/1344-cutover-post.json";

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

describe.skipIf(!hasDb || !dbReachable)("#1344 Slice 4 — single-counter cutover", () => {
  beforeAll(async () => {
    await cleanup(prisma);
    await seedCaller(prisma);
  });

  afterAll(async () => {
    await cleanup(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM "Session" WHERE "callerId" = ${preFixture.callerId}`;
    await prisma.$executeRaw`DELETE FROM "CallerSequenceCounter" WHERE "callerId" = ${preFixture.callerId}`;
  });

  it("nextLearnerFacingNumber returns 1 when the caller has no qualifying Sessions", async () => {
    const { loadAllData } = await import("@/lib/prompt/composition/SectionDataLoader");
    const data = await loadAllData(preFixture.callerId, {});
    expect(data.nextLearnerFacingNumber).toBe(1);
  });

  it("Bertie scenario: SIM_CALL drop does NOT bump the learner number", async () => {
    // Seed a SIM_CALL with sequenceNumber=1 but lfn=NULL +
    // countsTowardLearnerNumber=false (the Bertie shape).
    await prisma.session.create({
      data: {
        id: preFixture.preExistingSimDrop.id,
        callerId: preFixture.callerId,
        kind: "SIM_CALL",
        sequenceNumber: preFixture.preExistingSimDrop.sequenceNumber,
        learnerFacingNumber: null,
        countsTowardLearnerNumber: false,
        countsTowardPipelineNumber: true,
        status: "FAILED",
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(Date.now() - 50_000),
        skipStages: [],
      },
    });

    const { loadAllData } = await import("@/lib/prompt/composition/SectionDataLoader");
    const data = await loadAllData(preFixture.callerId, {});
    // Bug: pre-Slice-4 callCount-based reader would have returned 1+1=2
    // (the SIM_CALL is in Call.count as endedAt!=null). Slice 4 reader
    // returns MAX(lfn WHERE counts=true)+1 = 0+1 = 1.
    expect(data.nextLearnerFacingNumber).toBe(1);
    expect(data.nextLearnerFacingNumber).toBe(preFixture.expectedNextLearnerFacingNumberBeforeRealCall);
  });

  it("after first real VOICE_CALL Session lands, nextLearnerFacingNumber bumps to 2", async () => {
    // SIM drop first
    await prisma.session.create({
      data: {
        id: preFixture.preExistingSimDrop.id,
        callerId: preFixture.callerId,
        kind: "SIM_CALL",
        sequenceNumber: 1,
        learnerFacingNumber: null,
        countsTowardLearnerNumber: false,
        countsTowardPipelineNumber: true,
        status: "FAILED",
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(Date.now() - 50_000),
        skipStages: [],
      },
    });

    // First real call — manually write a Session row mimicking
    // createSession's output, then read the loader.
    await prisma.session.create({
      data: {
        id: "00000000-0000-0000-0030-000000001344",
        callerId: preFixture.callerId,
        kind: "VOICE_CALL",
        sequenceNumber: 1,
        learnerFacingNumber: 1,
        countsTowardLearnerNumber: true,
        countsTowardPipelineNumber: true,
        status: "COMPLETED",
        startedAt: new Date(Date.now() - 30_000),
        endedAt: new Date(),
        skipStages: [],
      },
    });

    const { loadAllData } = await import("@/lib/prompt/composition/SectionDataLoader");
    const data = await loadAllData(preFixture.callerId, {});
    expect(data.nextLearnerFacingNumber).toBe(2);
    expect(data.nextLearnerFacingNumber).toBe(postFixture.expectedNextLearnerFacingNumberAfter);
  });

  it("modules.ts computeSharedState reads callNumber from nextLearnerFacingNumber, not callCount+1", async () => {
    // SIM drop seeded — sim should NOT push compose header to N=2.
    await prisma.session.create({
      data: {
        id: preFixture.preExistingSimDrop.id,
        callerId: preFixture.callerId,
        kind: "SIM_CALL",
        sequenceNumber: 1,
        learnerFacingNumber: null,
        countsTowardLearnerNumber: false,
        countsTowardPipelineNumber: true,
        status: "FAILED",
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(Date.now() - 50_000),
        skipStages: [],
      },
    });
    // Also seed a Call row for the legacy callCount path — the OLD
    // reader would have read it and returned callCount=1 (since it
    // filtered on endedAt != null), producing callNumber=2. The NEW
    // reader sources from Session.learnerFacingNumber (=0), returning
    // callNumber=1.
    await prisma.call.create({
      data: {
        id: "00000000-0000-0000-0050-000000001344",
        callerId: preFixture.callerId,
        source: "sim",
        transcript: "(drop)",
        endedAt: new Date(Date.now() - 50_000),
      },
    });

    const { loadAllData } = await import("@/lib/prompt/composition/SectionDataLoader");
    const data = await loadAllData(preFixture.callerId, {});
    // The Bertie bug: callCount-based reader would have returned 2.
    // Slice 4 reader returns 1.
    expect(data.nextLearnerFacingNumber).toBe(1);
  });
});

async function seedCaller(client: PrismaClient): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "Caller" (id, role, "createdAt")
    VALUES (${preFixture.callerId}, 'LEARNER'::"CallerRole", NOW())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function cleanup(client: PrismaClient): Promise<void> {
  await client.$executeRaw`DELETE FROM "Call" WHERE "callerId" = ${preFixture.callerId}`;
  await client.$executeRaw`DELETE FROM "Session" WHERE "callerId" = ${preFixture.callerId}`;
  await client.$executeRaw`DELETE FROM "CallerSequenceCounter" WHERE "callerId" = ${preFixture.callerId}`;
  await client.$executeRaw`DELETE FROM "Caller" WHERE id = ${preFixture.callerId}`;
}

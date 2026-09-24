/**
 * #2333 — behavioural integration test for the caller-erasure chokepoint.
 *
 * `lib/gdpr/delete-caller-data.ts::deleteCallerData` backs GDPR Art.17
 * erasure, the retention cleanup cron and bulk-delete. Until this file
 * existed, nothing executed it: `docs/CHAIN-CONTRACTS.md` §6a I-PR6 cited
 * `tests/lib/gdpr/delete-caller-data.test.ts` as an existing test, but that
 * file was never written, and the three suites that DO reference the helper
 * (`tests/lib/bulk-delete.test.ts`, `tests/api/retention-cleanup.test.ts`,
 * `tests/api/callers-detail.test.ts`) all mock it.
 *
 * That is why a real FK constraint went unnoticed: erasure threw P2003 on
 * `Session_callerId_fkey` for 28% of hf_sandbox and 31% of hf_staging
 * callers while every test stayed green.
 *
 * The sibling Coverage gate `tests/lib/gdpr/caller-delete-coverage.test.ts`
 * is STRUCTURAL — it parses schema.prisma and asserts each blocking FK has a
 * matching delete. It never runs the helper, so it cannot catch a wrong
 * delete ORDER, a `where` clause targeting the wrong rows, or transaction
 * behaviour. This file is the behavioural half.
 *
 * Shapes covered — each is a bug that actually occurred:
 *   1. caller with Sessions              (the epic #1338 regression)
 *   2. cohort OWNER whose cohort is referenced by ANOTHER caller's legacy
 *      `Caller.cohortGroupId`            (second-order, found in review)
 *   3. caller with CallerIdentity carrying CALLER-scope BehaviorTargets
 *                                        (second-order, found by the gate)
 *   4. caller with Calls + call children
 *   5. caller with nothing               (no-op path)
 *   6. the batch form, deleting several at once
 *
 * DB-only — no server needed. Follows the `tests/integration/sessions/`
 * pattern: skipped when DATABASE_URL is absent or unreachable.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { deleteCallerData, deleteCallersData } from "@/lib/gdpr/delete-caller-data";

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

// Fixed ids so cleanup is surgical — never a broad DELETE.
const F = {
  domainId: "2333-dom-00000000-0000-0000-0000-000000000001",
  victimId: "2333-vic-00000000-0000-0000-0000-000000000003",
  bystanderId: "2333-bys-00000000-0000-0000-0000-000000000004",
  cohortId: "2333-coh-00000000-0000-0000-0000-000000000005",
  identityId: "2333-idt-00000000-0000-0000-0000-000000000006",
  emptyId: "2333-emp-00000000-0000-0000-0000-000000000007",
  batchAId: "2333-bta-00000000-0000-0000-0000-000000000008",
  batchBId: "2333-btb-00000000-0000-0000-0000-000000000009",
} as const;

const ALL_CALLERS = [F.victimId, F.bystanderId, F.emptyId, F.batchAId, F.batchBId];

describe.skipIf(!hasDb || !dbReachable)("#2333 — caller erasure (behavioural)", () => {
  beforeAll(async () => {
    await cleanup();
    await seedReferences();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupCallerData();
    await seedVictim();
  });

  it("erases a caller that has Sessions (the #1338 regression)", async () => {
    const before = await prisma.session.count({ where: { callerId: F.victimId } });
    expect(before).toBeGreaterThan(0);

    const counts = await deleteCallerData(F.victimId);

    expect(counts.sessions).toBe(before);
    expect(await prisma.caller.count({ where: { id: F.victimId } })).toBe(0);
    expect(await prisma.session.count({ where: { callerId: F.victimId } })).toBe(0);
  });

  it("erases a cohort OWNER, severing another caller's legacy cohortGroupId", async () => {
    // The bystander is NOT being erased, but points at the victim's cohort
    // through the deprecated single-membership scalar. Postgres would reject
    // the cohort delete on their behalf.
    const bystanderBefore = await prisma.caller.findUnique({
      where: { id: F.bystanderId },
      select: { cohortGroupId: true },
    });
    expect(bystanderBefore?.cohortGroupId).toBe(F.cohortId);

    const counts = await deleteCallerData(F.victimId);

    expect(counts.ownedCohortGroups).toBe(1);
    expect(counts.legacyCohortRefsCleared).toBeGreaterThanOrEqual(1);
    expect(await prisma.cohortGroup.count({ where: { id: F.cohortId } })).toBe(0);

    // The bystander SURVIVES — only their dangling reference is severed.
    const after = await prisma.caller.findUnique({
      where: { id: F.bystanderId },
      select: { cohortGroupId: true },
    });
    expect(after).not.toBeNull();
    expect(after?.cohortGroupId).toBeNull();
  });

  it("erases identity-scoped BehaviorTargets before the CallerIdentity", async () => {
    const before = await prisma.behaviorTarget.count({
      where: { callerIdentityId: F.identityId },
    });
    expect(before).toBeGreaterThan(0);

    const counts = await deleteCallerData(F.victimId);

    expect(counts.identityBehaviorTargets).toBe(before);
    expect(await prisma.callerIdentity.count({ where: { id: F.identityId } })).toBe(0);
    expect(
      await prisma.behaviorTarget.count({ where: { callerIdentityId: F.identityId } }),
    ).toBe(0);
  });

  it("erases Calls and their children", async () => {
    const before = await prisma.call.count({ where: { callerId: F.victimId } });
    expect(before).toBeGreaterThan(0);

    const counts = await deleteCallerData(F.victimId);

    expect(counts.calls).toBe(before);
    expect(await prisma.call.count({ where: { callerId: F.victimId } })).toBe(0);
  });

  it("leaves no orphan rows behind (§6a I-PR6 iPR6OrphanPIIRowsPostErasure = 0)", async () => {
    await deleteCallerData(F.victimId);

    const orphans = await Promise.all([
      prisma.session.count({ where: { callerId: F.victimId } }),
      prisma.call.count({ where: { callerId: F.victimId } }),
      prisma.callerIdentity.count({ where: { callerId: F.victimId } }),
      prisma.callerMemory.count({ where: { callerId: F.victimId } }),
      prisma.callerSequenceCounter.count({ where: { callerId: F.victimId } }),
      prisma.cohortGroup.count({ where: { ownerId: F.victimId } }),
    ]);
    expect(orphans).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("is a no-op for a caller with no children", async () => {
    const counts = await deleteCallerData(F.emptyId);
    expect(counts.sessions).toBe(0);
    expect(counts.calls).toBe(0);
    expect(await prisma.caller.count({ where: { id: F.emptyId } })).toBe(0);
  });

  it("batch form erases several callers in one pass", async () => {
    const counts = await deleteCallersData([F.batchAId, F.batchBId]);
    expect(counts.sessions).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.caller.count({ where: { id: { in: [F.batchAId, F.batchBId] } } }),
    ).toBe(0);
  });

  it("empty batch is a no-op and touches nothing", async () => {
    const before = await prisma.caller.count();
    const counts = await deleteCallersData([]);
    expect(counts.calls).toBe(0);
    expect(await prisma.caller.count()).toBe(before);
  });

  it("rolls back cleanly when the surrounding transaction aborts", async () => {
    const SENTINEL = "ROLLBACK_SENTINEL";
    await expect(
      prisma.$transaction(async (tx) => {
        await deleteCallerData(F.victimId, tx);
        throw new Error(SENTINEL);
      }),
    ).rejects.toThrow(SENTINEL);

    // Everything survives — this is the probe shape used to diagnose the
    // original P2003 without mutating hf_sandbox.
    expect(await prisma.caller.count({ where: { id: F.victimId } })).toBe(1);
    expect(await prisma.session.count({ where: { callerId: F.victimId } })).toBeGreaterThan(0);
  });
});

// ── fixtures ───────────────────────────────────────────────────────────────

async function seedReferences(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "Domain" (id, name, slug, "createdAt", "updatedAt")
    VALUES (${F.domainId}, '2333-test', '2333-test', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`;
}

async function seedVictim(): Promise<void> {
  for (const id of ALL_CALLERS) {
    await prisma.$executeRaw`
      INSERT INTO "Caller" (id, role, "createdAt")
      VALUES (${id}, 'LEARNER'::"CallerRole", NOW())
      ON CONFLICT (id) DO NOTHING`;
  }

  // Sessions for victim + both batch callers.
  for (const [i, id] of [F.victimId, F.batchAId, F.batchBId].entries()) {
    await prisma.$executeRaw`
      INSERT INTO "Session" (id, "callerId", kind, "sequenceNumber", "startedAt",
                             status, "skipStages", "countsTowardLearnerNumber",
                             "countsTowardPipelineNumber")
      VALUES (gen_random_uuid(), ${id}, 'SIM_CALL'::"SessionKind", ${i + 1}, NOW(),
              'COMPLETED'::"SessionStatus", ARRAY[]::text[], true, true)`;
  }

  await prisma.$executeRaw`
    INSERT INTO "CallerSequenceCounter" ("callerId", kind, "nextSeq", "updatedAt")
    VALUES (${F.victimId}, 'SIM_CALL', 2, NOW())
    ON CONFLICT ("callerId", kind) DO NOTHING`;

  // `Call.source` and `Call.transcript` are NOT NULL without defaults.
  // Prisma client rather than raw SQL so the enum cast is handled for us.
  await prisma.call.create({
    data: { callerId: F.victimId, source: "SIM", transcript: "2333 fixture transcript" },
  });

  // Identity + a CALLER-scope BehaviorTarget pinned to it.
  await prisma.$executeRaw`
    INSERT INTO "CallerIdentity" (id, "callerId", "createdAt", "updatedAt")
    VALUES (${F.identityId}, ${F.victimId}, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`;
  await prisma.$executeRaw`
    INSERT INTO "BehaviorTarget" (id, "parameterId", scope, "callerId",
                                  "targetValue", "createdAt", "updatedAt")
    SELECT gen_random_uuid(), p."parameterId", 'CALLER'::"BehaviorTargetScope",
           ${F.identityId}, 0.5, NOW(), NOW()
    FROM "Parameter" p LIMIT 1`;

  // Cohort owned by the victim, with the bystander pointing at it through the
  // deprecated legacy scalar.
  await prisma.$executeRaw`
    INSERT INTO "CohortGroup" (id, name, "ownerId", "domainId", "createdAt", "updatedAt")
    VALUES (${F.cohortId}, '2333-cohort', ${F.victimId}, ${F.domainId}, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`;
  await prisma.$executeRaw`
    UPDATE "Caller" SET "cohortGroupId" = ${F.cohortId} WHERE id = ${F.bystanderId}`;
}

async function cleanupCallerData(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Caller" SET "cohortGroupId" = NULL WHERE "cohortGroupId" = ${F.cohortId}`;
  await prisma.$executeRaw`DELETE FROM "BehaviorTarget" WHERE "callerId" = ${F.identityId}`;
  await prisma.$executeRaw`DELETE FROM "CohortGroup" WHERE "ownerId" = ANY(${ALL_CALLERS})`;
  await prisma.$executeRaw`DELETE FROM "CallerIdentity" WHERE "callerId" = ANY(${ALL_CALLERS})`;
  await prisma.$executeRaw`DELETE FROM "Session" WHERE "callerId" = ANY(${ALL_CALLERS})`;
  await prisma.$executeRaw`DELETE FROM "CallerSequenceCounter" WHERE "callerId" = ANY(${ALL_CALLERS})`;
  await prisma.$executeRaw`DELETE FROM "Call" WHERE "callerId" = ANY(${ALL_CALLERS})`;
  await prisma.$executeRaw`DELETE FROM "Caller" WHERE id = ANY(${ALL_CALLERS})`;
}

async function cleanup(): Promise<void> {
  await cleanupCallerData();
  await prisma.$executeRaw`DELETE FROM "Domain" WHERE id = ${F.domainId}`;
}

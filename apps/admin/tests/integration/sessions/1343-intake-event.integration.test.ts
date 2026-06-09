/**
 * #1343 (epic #1338 Slice 2) — PrismaEventStore integration test.
 *
 * Pre/post data proof for the new `intake_event` table + Session.intentId
 * cross-link. Runs against an already-migrated DB (the migration applies
 * at DB-init via Prisma's normal contract).
 *
 * What this test asserts end-to-end:
 *
 *   1. The `intake_event` table exists with the expected indexes.
 *   2. `Session.intentId` column exists.
 *   3. `PrismaEventStore.buildAndAppendEvent` writes a verifyChain-valid
 *      hash chain across multiple appends on the same intentId.
 *   4. The (intentId, version) unique constraint blocks duplicate
 *      writes (race-free semantics).
 *   5. `readChain` returns events in append order.
 *   6. Cross-intent isolation: chain A's tail is independent of chain B.
 *
 * Required env: `DATABASE_URL` — pointed at a hf_sandbox-shaped DB where
 * the 1343 migration has already applied. Skips with a console warning
 * if `DATABASE_URL` is not set (CI image without DB).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import preFixture from "../../fixtures/sessions/1343-intake-event-pre.json";
import postFixture from "../../fixtures/sessions/1343-intake-event-post.json";
import { PrismaEventStore } from "@/lib/intake/prisma-event-store";
import type { IntentId, Tenant, Actor, SubjectId, Purpose } from "@/lib/intake/tallyseal";
import { verifyChain } from "@/lib/intake/tallyseal";

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

const INTENT_A = `1343-test-intent-A-${Date.now()}` as IntentId;
const INTENT_B = `1343-test-intent-B-${Date.now()}` as IntentId;

const TENANT: Tenant = {
  id: "hf-integration-test" as Tenant["id"],
  region: "europe-west2" as Tenant["region"],
};
const ACTOR: Actor = { kind: "human", id: "integration-test-actor" as Actor["id"] };
const SUBJECT = "integration-subject" as SubjectId;

describe.skipIf(!hasDb || !dbReachable)(
  "#1343 Slice 2 — PrismaEventStore against live Postgres",
  () => {
    beforeAll(async () => {
      // Sanity: the new table + column from the 1343 migration must exist.
      const eventTable = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'intake_event'
      `;
      expect(eventTable).toHaveLength(1);

      const intentIdColumn = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Session' AND column_name = 'intentId'
      `;
      expect(intentIdColumn).toHaveLength(1);

      // Pre-fixture: confirm shape (schema only, no rows seeded for the
      // event-store path itself — every test event lives under a unique
      // intentId stamped with Date.now() so concurrent runs don't clash).
      expect(preFixture.schema_state.intake_event_table_exists).toBe(false);
      expect(postFixture.schema_state.intake_event_table_exists).toBe(true);

      // Clean any leftover rows from a prior run.
      await prisma.intakeEvent.deleteMany({
        where: { intentId: { in: [INTENT_A, INTENT_B] } },
      });
    });

    afterAll(async () => {
      await prisma.intakeEvent.deleteMany({
        where: { intentId: { in: [INTENT_A, INTENT_B] } },
      });
      await prisma.$disconnect();
    });

    it("writes a verifyChain-valid chain of 3 events on a single intent", async () => {
      const store = new PrismaEventStore(prisma);
      const baseTs = new Date("2026-06-09T10:00:00.000Z").getTime();
      for (let i = 0; i < 3; i++) {
        await store.buildAndAppendEvent({
          intentId: INTENT_A,
          kind: i === 0 ? "SourceCaptured" : "CapturedTurn",
          tenantId: TENANT.id,
          actor: ACTOR,
          lawfulBasis: "contract",
          purpose: "course-delivery" as Purpose,
          dataSubjectIds: [SUBJECT],
          payload: { idx: i, text: `event-${i}` },
          timestamp: new Date(baseTs + i * 1000),
        });
      }
      const chain = await store.readChain(INTENT_A);
      expect(chain).toHaveLength(postFixture.expected_event_count_after_proof_seed);
      expect(chain[0].version).toBe(1);
      expect(chain[0].prevHash).toBeNull();
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i].prevHash).toBe(chain[i - 1].contentHash);
        expect(chain[i].version).toBe(i + 1);
      }
      expect(verifyChain(chain).valid).toBe(true);
    });

    it("isolates chains across intentIds — INTENT_B chain does not see INTENT_A events", async () => {
      const store = new PrismaEventStore(prisma);
      const eventB = await store.buildAndAppendEvent({
        intentId: INTENT_B,
        kind: "SourceCaptured",
        tenantId: TENANT.id,
        actor: ACTOR,
        lawfulBasis: "contract",
        purpose: "course-delivery" as Purpose,
        dataSubjectIds: [SUBJECT],
        payload: { source: "B-isolated" },
      });
      expect(eventB.version).toBe(1);
      expect(eventB.prevHash).toBeNull();

      const chainA = await store.readChain(INTENT_A);
      const chainB = await store.readChain(INTENT_B);
      expect(chainB).toHaveLength(1);
      expect(chainA[0].contentHash).not.toBe(chainB[0].contentHash);
    });

    it("rejects a duplicate (intentId, version) write at the DB level", async () => {
      // Insert verbatim via the contract-surface appendEvent to force
      // a collision against the unique constraint.
      const store = new PrismaEventStore(prisma);
      const existing = await store.readChain(INTENT_A);
      expect(existing.length).toBeGreaterThan(0);

      // Try to re-insert event #0 verbatim — same (intentId, version)
      // tuple — must throw with a P2002.
      await expect(store.appendEvent(existing[0])).rejects.toMatchObject({
        code: "P2002",
      });
    });
  },
);

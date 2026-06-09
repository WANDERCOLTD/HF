// PrismaEventStore unit + contract tests (epic #1338 Slice 2 / #1343).
//
// Strategy: drive the store against an in-memory stub of the Prisma
// `intakeEvent` delegate + `$transaction`. The stub keeps a Map keyed
// by row id and a list keyed by `(intentId, version)` so the contract
// test's tail-read + read-back queries return the right shape.
//
// Why a stub rather than a real Prisma client: this file is a unit
// test (no DB required for CI to run it). A sibling
// `tests/integration/intake/prisma-event-store.integration.test.ts`
// runs the same contract against a real ephemeral Postgres, gated on
// `DATABASE_URL_TEST`.

import { describe, it, expect } from "vitest";
import { runHashChainContract, TCK_RESULT_PASS } from "@tallyseal/crawcus-tck";
import type { Prisma } from "@prisma/client";
import { PrismaEventStore } from "@/lib/intake/prisma-event-store";
import type { IntentId, Tenant, Actor, SubjectId, Purpose } from "@/lib/intake/tallyseal";
import { verifyChain } from "@/lib/intake/tallyseal";

const TENANT: Tenant = {
  id: "hf-test" as Tenant["id"],
  region: "europe-west2" as Tenant["region"],
};
const ACTOR: Actor = { kind: "human", id: "test-actor" as Actor["id"] };
const SUBJECT = "subject-1" as SubjectId;

describe("PrismaEventStore — Tallyseal hash-chain contract", () => {
  it("matches runHashChainContract against an in-memory Prisma stub", async () => {
    const stub = makePrismaStub();
    const result = await runHashChainContract({
      storeFactory: () => new PrismaEventStore(stub) satisfies object,
      intentId: "tck-golden-intent" as IntentId,
    });

    if (result.ok !== true) {
      throw new Error(`Hash-chain contract failed: ${result.code} — ${result.message}`);
    }
    expect(result).toEqual(TCK_RESULT_PASS);
  });
});

describe("PrismaEventStore — writer overload (buildAndAppendEvent)", () => {
  it("derives version + prevHash from the chain tail and persists a verifiable chain", async () => {
    const stub = makePrismaStub();
    const store = new PrismaEventStore(stub);
    const intentId = "intent-writer-test" as IntentId;

    const FIXED_TS_BASE = new Date("2026-06-09T00:00:00.000Z").getTime();
    for (let i = 0; i < 4; i++) {
      await store.buildAndAppendEvent({
        intentId,
        kind: "CapturedTurn",
        tenantId: TENANT.id,
        actor: ACTOR,
        lawfulBasis: "contract",
        purpose: "course-delivery" as Purpose,
        dataSubjectIds: [SUBJECT],
        payload: { role: i % 2 === 0 ? "user" : "assistant", text: `turn-${i}` },
        timestamp: new Date(FIXED_TS_BASE + i * 1000),
      });
    }

    const chain = await store.readChain(intentId);
    expect(chain.length).toBe(4);
    expect(chain[0].version).toBe(1);
    expect(chain[0].prevHash).toBeNull();
    for (let i = 1; i < 4; i++) {
      expect(chain[i].version).toBe(i + 1);
      expect(chain[i].prevHash).toBe(chain[i - 1].contentHash);
    }
    expect(verifyChain(chain).valid).toBe(true);
  });

  it("isolates chains by intentId — two intents don't share counters or prevHashes", async () => {
    const stub = makePrismaStub();
    const store = new PrismaEventStore(stub);
    const intentA = "intent-A" as IntentId;
    const intentB = "intent-B" as IntentId;

    await store.buildAndAppendEvent({
      intentId: intentA,
      kind: "SourceCaptured",
      tenantId: TENANT.id,
      actor: ACTOR,
      lawfulBasis: "contract",
      purpose: "course-delivery" as Purpose,
      dataSubjectIds: [SUBJECT],
      payload: { source: "A-1" },
    });
    await store.buildAndAppendEvent({
      intentId: intentB,
      kind: "SourceCaptured",
      tenantId: TENANT.id,
      actor: ACTOR,
      lawfulBasis: "contract",
      purpose: "course-delivery" as Purpose,
      dataSubjectIds: [SUBJECT],
      payload: { source: "B-1" },
    });
    await store.buildAndAppendEvent({
      intentId: intentA,
      kind: "CapturedTurn",
      tenantId: TENANT.id,
      actor: ACTOR,
      lawfulBasis: "contract",
      purpose: "course-delivery" as Purpose,
      dataSubjectIds: [SUBJECT],
      payload: { role: "user", text: "A-2" },
    });

    const chainA = await store.readChain(intentA);
    const chainB = await store.readChain(intentB);
    expect(chainA.length).toBe(2);
    expect(chainB.length).toBe(1);
    expect(chainA[0].version).toBe(1);
    expect(chainA[1].version).toBe(2);
    expect(chainB[0].version).toBe(1);
    // Cross-intent prevHash isolation: A's second event must NOT link
    // to B's tail.
    expect(chainA[1].prevHash).toBe(chainA[0].contentHash);
    expect(chainA[1].prevHash).not.toBe(chainB[0].contentHash);
  });
});

describe("PrismaEventStore — dev-server restart simulation", () => {
  it("preserves events across two PrismaEventStore instances sharing one Prisma client", async () => {
    // Vitest can't actually restart the dev server. We simulate
    // durability by instantiating PrismaEventStore TWICE against the
    // same Prisma stub — anything the first writes must be readable
    // by the second, which is exactly what survives a Next.js HMR
    // cycle (or a real prod restart) in the live Prisma path.
    const stub = makePrismaStub();
    const intentId = "intent-restart-test" as IntentId;

    const storeBeforeRestart = new PrismaEventStore(stub);
    await storeBeforeRestart.buildAndAppendEvent({
      intentId,
      kind: "SourceCaptured",
      tenantId: TENANT.id,
      actor: ACTOR,
      lawfulBasis: "contract",
      purpose: "course-delivery" as Purpose,
      dataSubjectIds: [SUBJECT],
      payload: { source: "before-restart" },
    });
    await storeBeforeRestart.buildAndAppendEvent({
      intentId,
      kind: "CapturedTurn",
      tenantId: TENANT.id,
      actor: ACTOR,
      lawfulBasis: "contract",
      purpose: "course-delivery" as Purpose,
      dataSubjectIds: [SUBJECT],
      payload: { role: "user", text: "first turn" },
    });

    // "Restart" — new store instance, same backing client.
    const storeAfterRestart = new PrismaEventStore(stub);
    const chain = await storeAfterRestart.readChain(intentId);
    expect(chain.length).toBe(2);
    expect(chain[0].payload).toEqual({ source: "before-restart" });
    expect(chain[1].payload).toEqual({ role: "user", text: "first turn" });

    // Append a third event after the "restart" — chain must continue
    // from the existing tail, not start a new genesis.
    const third = await storeAfterRestart.buildAndAppendEvent({
      intentId,
      kind: "CapturedTurn",
      tenantId: TENANT.id,
      actor: ACTOR,
      lawfulBasis: "contract",
      purpose: "course-delivery" as Purpose,
      dataSubjectIds: [SUBJECT],
      payload: { role: "assistant", text: "after-restart" },
    });
    expect(third.version).toBe(3);
    expect(third.prevHash).toBe(chain[1].contentHash);

    const finalChain = await storeAfterRestart.readChain(intentId);
    expect(finalChain.length).toBe(3);
    expect(verifyChain(finalChain).valid).toBe(true);
  });
});

// ── In-memory Prisma stub ──────────────────────────────────────────

interface StubRow {
  id: string;
  intentId: string;
  version: number;
  kind: string;
  prevHash: string | null;
  contentHash: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * Minimal stub of the Prisma `intakeEvent` delegate + `$transaction`.
 * Backs a single in-memory Map; survives between PrismaEventStore
 * instantiations because we hold the stub by reference (the "restart"
 * simulation). Provides the structural surface PrismaEventStore needs
 * — `findFirst`, `findMany`, `create`, `deleteMany`, `$transaction`.
 *
 * Unique-constraint enforcement: `create` throws when (intentId, version)
 * already exists, matching Prisma's P2002 semantics. The TCK test
 * relies on read-back order being correct; we ensure that with the
 * `orderBy` argument honoured.
 */
function makePrismaStub(): {
  readonly intakeEvent: ConstructorParameters<typeof PrismaEventStore>[0]["intakeEvent"];
  readonly $transaction: ConstructorParameters<typeof PrismaEventStore>[0]["$transaction"];
} {
  const rows: StubRow[] = [];

  const intakeEvent = {
    findFirst: async ({
      where,
      orderBy,
      select: _select,
    }: {
      where?: { intentId?: string };
      orderBy?: { version?: "asc" | "desc" };
      select?: object;
    }): Promise<StubRow | null> => {
      void _select;
      let candidates = rows.filter((r) => (where?.intentId !== undefined ? r.intentId === where.intentId : true));
      if (orderBy?.version === "desc") {
        candidates = [...candidates].sort((a, b) => b.version - a.version);
      } else if (orderBy?.version === "asc") {
        candidates = [...candidates].sort((a, b) => a.version - b.version);
      }
      return candidates[0] ?? null;
    },
    findMany: async ({
      where,
      orderBy,
    }: {
      where?: { intentId?: string };
      orderBy?: { version?: "asc" | "desc" };
    }): Promise<StubRow[]> => {
      let out = rows.filter((r) => (where?.intentId !== undefined ? r.intentId === where.intentId : true));
      if (orderBy?.version === "asc") out = [...out].sort((a, b) => a.version - b.version);
      else if (orderBy?.version === "desc") out = [...out].sort((a, b) => b.version - a.version);
      return out;
    },
    create: async ({ data }: { data: Prisma.IntakeEventCreateInput }): Promise<StubRow> => {
      // Enforce the (intentId, version) unique constraint that the
      // real Prisma schema declares — this is what makes
      // PrismaEventStore race-free.
      const conflict = rows.find(
        (r) => r.intentId === data.intentId && r.version === data.version,
      );
      if (conflict) {
        const err = new Error(
          `Unique constraint failed on intake_event_intentId_version_key`,
        ) as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
      const row: StubRow = {
        id: typeof data.id === "string" ? data.id : `cuid-${rows.length}`,
        intentId: data.intentId,
        version: data.version,
        kind: data.kind,
        prevHash: (data.prevHash as string | null | undefined) ?? null,
        contentHash: data.contentHash as string,
        payload: data.payload,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    deleteMany: async (): Promise<{ count: number }> => {
      const n = rows.length;
      rows.splice(0, rows.length);
      return { count: n };
    },
  };

  const $transaction = async <T>(
    fn: (tx: { readonly intakeEvent: typeof intakeEvent }) => Promise<T>,
  ): Promise<T> => fn({ intakeEvent });

  return {
    intakeEvent: intakeEvent as unknown as ConstructorParameters<typeof PrismaEventStore>[0]["intakeEvent"],
    $transaction: $transaction as unknown as ConstructorParameters<typeof PrismaEventStore>[0]["$transaction"],
  };
}

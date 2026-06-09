/**
 * #1345 Integration Test — Ghost-row dedup against a real DB.
 *
 * Replays Bertie Tallstaff's 2026-06-08 10:06:02 → 10:06:49 sequence
 * directly against the active Postgres database via persistEndOfCall.
 * No mocked Prisma client — the live `prisma.call.*` writes verify the
 * dedup query and adoption path produce ONE Call row, not two.
 *
 * Run prerequisites:
 *   - Database migrated (prisma migrate dev)
 *   - DATABASE_URL points at a test-safe DB (sandbox, dev, or local)
 *   - No server running required — this hits Prisma directly
 *
 * Skipped automatically if DATABASE_URL is unreachable (CI without DB).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { PrismaClient } from "@prisma/client";

import { persistEndOfCall } from "@/lib/voice/route-handlers";
import type { NormalisedEndOfCallEvent } from "@/lib/voice/types";

const TAG = "1345-ghost-dedup-test";
const prisma = new PrismaClient();

// Track ids we create so we can clean up.
const createdCallerIds: string[] = [];
const createdCallIds: string[] = [];

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch (err) {
    console.warn(
      `[1345-integration] DB unreachable (${err instanceof Error ? err.message : String(err)}) — tests will be skipped`,
    );
    dbReachable = false;
  }
});

afterAll(async () => {
  if (!dbReachable) {
    await prisma.$disconnect().catch(() => undefined);
    return;
  }
  // Clean up Call rows then Caller rows we minted.
  if (createdCallIds.length > 0) {
    await prisma.call
      .deleteMany({ where: { id: { in: createdCallIds } } })
      .catch(() => undefined);
  }
  if (createdCallerIds.length > 0) {
    await prisma.caller
      .deleteMany({ where: { id: { in: createdCallerIds } } })
      .catch(() => undefined);
  }
  await prisma.$disconnect();
});

beforeEach(() => {
  // Reset the env override before each test.
  delete process.env.GHOST_ROW_DEDUP_WINDOW_SECONDS;
});

afterEach(async () => {
  if (!dbReachable) return;
  // Clear between tests so the integration assertions are isolated.
  if (createdCallIds.length > 0) {
    await prisma.call
      .deleteMany({ where: { id: { in: createdCallIds } } })
      .catch(() => undefined);
    createdCallIds.length = 0;
  }
  if (createdCallerIds.length > 0) {
    await prisma.caller
      .deleteMany({ where: { id: { in: createdCallerIds } } })
      .catch(() => undefined);
    createdCallerIds.length = 0;
  }
});

async function makeCaller(phoneSuffix: string) {
  const c = await prisma.caller.create({
    data: {
      phone: `+44770090${phoneSuffix}`,
      name: `${TAG}-caller-${phoneSuffix}`,
    },
  });
  createdCallerIds.push(c.id);
  return c;
}

async function makePlaceholder(callerId: string, ageSeconds = 5) {
  const c = await prisma.call.create({
    data: {
      callerId,
      source: "vapi",
      voiceProvider: "vapi",
      transcript: "",
      createdAt: new Date(Date.now() - ageSeconds * 1000),
    },
  });
  createdCallIds.push(c.id);
  return c;
}

function makeEvent(
  externalCallId: string,
  customerPhone: string,
): NormalisedEndOfCallEvent {
  return {
    eventKind: "full",
    externalCallId,
    customerPhone,
    customerName: `${TAG}-caller`,
    transcript: "Integration test transcript",
    capture: {
      durationSeconds: 47,
      endedReason: "customer-ended-call",
    },
    providerRaw: { test: true, integrationTag: TAG },
  };
}

describe("#1345 — Ghost-row dedup integration (live DB)", () => {
  it("Bertie 10:06:02 → 10:06:49 replay produces ONE Call row, not two", async () => {
    if (!dbReachable) {
      console.warn("[1345-integration] skipping — DB unreachable");
      return;
    }

    // Arrange — caller + placeholder (the outbound-dial placeholder).
    const caller = await makeCaller("0001");
    const placeholder = await makePlaceholder(caller.id, 5);

    // Pre-fix state assertion — one placeholder row, externalId NULL.
    const preRows = await prisma.call.findMany({
      where: { callerId: caller.id },
    });
    expect(preRows).toHaveLength(1);
    expect(preRows[0].externalId).toBeNull();
    expect(preRows[0].endedAt).toBeNull();

    // Act — webhook arrives with a brand-new externalId. persistEndOfCall
    // first-arrival branch should hit the #1345 dedup, adopt the
    // placeholder, and NOT create a duplicate row.
    const event = makeEvent(
      `vapi-test-${TAG}-${Date.now()}`,
      caller.phone ?? "",
    );
    const result = await persistEndOfCall(event, "vapi", {
      sourceTag: "webhook",
    });

    // Track the produced callId for cleanup.
    createdCallIds.push(result.callId);

    // Assert — exactly ONE Call row for this caller, adopted placeholder.
    const postRows = await prisma.call.findMany({
      where: { callerId: caller.id },
      orderBy: { createdAt: "asc" },
    });
    expect(postRows).toHaveLength(1);
    expect(postRows[0].id).toBe(placeholder.id); // same row, adopted
    expect(postRows[0].externalId).toBe(event.externalCallId);
    expect(postRows[0].endedAt).not.toBeNull();
    expect(postRows[0].endSource).toBe("webhook");
    expect(postRows[0].callSequence).toBe(1);
    expect(result.merged).toBe(true);
    expect(result.callId).toBe(placeholder.id);
  });

  it("placeholder older than dedup window → fresh-create branch (no false adoption)", async () => {
    if (!dbReachable) {
      console.warn("[1345-integration] skipping — DB unreachable");
      return;
    }

    // Arrange — placeholder is 60s old, well outside the 30s window.
    const caller = await makeCaller("0002");
    await makePlaceholder(caller.id, 60);

    const event = makeEvent(
      `vapi-stale-${TAG}-${Date.now()}`,
      caller.phone ?? "",
    );

    const result = await persistEndOfCall(event, "vapi", {
      sourceTag: "webhook",
    });
    createdCallIds.push(result.callId);

    // Assert — two rows now (stale placeholder + fresh adoption);
    // adoption did NOT occur; fresh row carries the externalId.
    const rows = await prisma.call.findMany({
      where: { callerId: caller.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].externalId).toBeNull(); // stale placeholder
    expect(rows[1].externalId).toBe(event.externalCallId); // fresh row
    expect(result.merged).toBeUndefined();
  });
});

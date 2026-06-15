/**
 * Tests for `GET /api/callers/[callerId]/memories` — Wave A1 of the
 * legacy-tab retirement plan (Profile fold-in to Snapshot v3).
 *
 * Pinned acceptance:
 *   1. STUDENT scope rejects foreign callerId
 *   2. 404 when caller not found
 *   3. Non-superseded, non-expired filter is applied to memories
 *   4. Summary tile counts come from CallerMemorySummary
 *   5. totalCount = sum of category counts
 *   6. Empty caller → memories=[] + zeroed summary
 *   7. lastMemoryAt surfaced as ISO string when present
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockStudentAllowed } = vi.hoisted(() => ({
  mockPrisma: {
    caller: { findUnique: vi.fn() },
    callerMemory: { findMany: vi.fn() },
    callerMemorySummary: { findUnique: vi.fn() },
  },
  mockStudentAllowed: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: () => false,
}));
vi.mock("@/lib/learner-scope", () => ({
  studentAllowedToReadCaller: mockStudentAllowed,
  callerScopeMismatchResponse: () =>
    new Response(JSON.stringify({ ok: false, error: "scope" }), { status: 403 }),
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/memories/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
});

describe("GET /api/callers/[callerId]/memories", () => {
  it("rejects STUDENT reading foreign caller (403)", async () => {
    mockStudentAllowed.mockReturnValue(false);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/memories"), PARAMS);
    expect(res.status).toBe(403);
    expect(mockPrisma.callerMemory.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when caller does not exist", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/memories"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("applies non-superseded + non-expired filter on memories", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerMemory.findMany.mockResolvedValue([]);
    mockPrisma.callerMemorySummary.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    await route.GET(new Request("http://x/memories"), PARAMS);

    const args = mockPrisma.callerMemory.findMany.mock.calls[0][0] as {
      where: { supersededById: null; OR: Array<unknown> };
    };
    expect(args.where.supersededById).toBeNull();
    expect(args.where.OR).toHaveLength(2);
  });

  it("returns memories with category + key + value + confidence + decay", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerMemory.findMany.mockResolvedValue([
      {
        id: "m1",
        category: "FACT",
        key: "lives_in",
        value: "London",
        confidence: 0.92,
        evidence: "User said: I'm based in London",
        extractedAt: new Date("2026-06-14T10:00:00.000Z"),
        decayFactor: 0.85,
      },
    ]);
    mockPrisma.callerMemorySummary.findUnique.mockResolvedValue({
      factCount: 12,
      preferenceCount: 4,
      eventCount: 2,
      topicCount: 7,
      lastMemoryAt: new Date("2026-06-14T10:00:00.000Z"),
    });
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/memories"), PARAMS);
    const json = (await res.json()) as {
      ok: boolean;
      memories: Array<{
        id: string;
        category: string;
        confidence: number;
        decayFactor: number;
        evidence: string | null;
        extractedAt: string | null;
      }>;
      summary: { totalCount: number; lastMemoryAt: string | null };
    };
    expect(json.memories[0]).toMatchObject({
      id: "m1",
      category: "FACT",
      confidence: 0.92,
      decayFactor: 0.85,
      evidence: "User said: I'm based in London",
      extractedAt: "2026-06-14T10:00:00.000Z",
    });
    expect(json.summary.totalCount).toBe(25);
    expect(json.summary.lastMemoryAt).toBe("2026-06-14T10:00:00.000Z");
  });

  it("returns zeroed summary when CallerMemorySummary row missing", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerMemory.findMany.mockResolvedValue([]);
    mockPrisma.callerMemorySummary.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/memories"), PARAMS);
    const json = (await res.json()) as {
      summary: {
        factCount: number;
        preferenceCount: number;
        eventCount: number;
        topicCount: number;
        totalCount: number;
        lastMemoryAt: string | null;
      };
      memories: unknown[];
    };
    expect(json.summary).toEqual({
      factCount: 0,
      preferenceCount: 0,
      eventCount: 0,
      topicCount: 0,
      totalCount: 0,
      lastMemoryAt: null,
    });
    expect(json.memories).toEqual([]);
  });

  it("returns nullable evidence + extractedAt correctly", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerMemory.findMany.mockResolvedValue([
      {
        id: "m1",
        category: "TOPIC",
        key: "interest",
        value: "machine learning",
        confidence: 0.7,
        evidence: null,
        extractedAt: null,
        decayFactor: 1.0,
      },
    ]);
    mockPrisma.callerMemorySummary.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/memories"), PARAMS);
    const json = (await res.json()) as {
      memories: Array<{ evidence: string | null; extractedAt: string | null }>;
    };
    expect(json.memories[0].evidence).toBeNull();
    expect(json.memories[0].extractedAt).toBeNull();
  });
});

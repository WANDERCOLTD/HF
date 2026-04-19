/**
 * Tests for GET /api/callers/:callerId/status
 * Lightweight polling endpoint — 3 queries instead of 30.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock setup ──

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    call: { findMany: vi.fn() },
    callScore: { groupBy: vi.fn() },
    composedPrompt: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/access-control", () => ({
  requireEntityAccess: vi.fn().mockResolvedValue({ userId: "u1" }),
  isEntityAuthError: vi.fn().mockReturnValue(false),
}));

import { GET } from "@/app/api/callers/[callerId]/status/route";

function makeRequest(): NextRequest {
  return new Request("http://localhost/api/callers/c1/status") as any;
}

import type { NextRequest } from "next/server";

describe("GET /api/callers/:callerId/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty calls array when no recent calls", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.callScore.groupBy.mockResolvedValue([]);
    mockPrisma.composedPrompt.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest(), {
      params: Promise.resolve({ callerId: "c1" }),
    });
    const json = await res.json();

    expect(json).toEqual({ ok: true, calls: [] });
  });

  it("returns correct hasScores/hasPrompt flags", async () => {
    mockPrisma.call.findMany.mockResolvedValue([
      { id: "call-1" },
      { id: "call-2" },
      { id: "call-3" },
    ]);
    mockPrisma.callScore.groupBy.mockResolvedValue([
      { callId: "call-1", _count: { id: 5 } },
      { callId: "call-3", _count: { id: 2 } },
    ]);
    mockPrisma.composedPrompt.findMany.mockResolvedValue([
      { triggerCallId: "call-1" },
    ]);

    const res = await GET(makeRequest(), {
      params: Promise.resolve({ callerId: "c1" }),
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.calls).toEqual([
      { id: "call-1", hasScores: true, hasPrompt: true },
      { id: "call-2", hasScores: false, hasPrompt: false },
      { id: "call-3", hasScores: true, hasPrompt: false },
    ]);
  });

  it("issues exactly 3 DB queries", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.callScore.groupBy.mockResolvedValue([]);
    mockPrisma.composedPrompt.findMany.mockResolvedValue([]);

    await GET(makeRequest(), {
      params: Promise.resolve({ callerId: "c1" }),
    });

    expect(mockPrisma.call.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.callScore.groupBy).toHaveBeenCalledTimes(1);
    expect(mockPrisma.composedPrompt.findMany).toHaveBeenCalledTimes(1);
  });

  it("scopes queries to the given callerId", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.callScore.groupBy.mockResolvedValue([]);
    mockPrisma.composedPrompt.findMany.mockResolvedValue([]);

    await GET(makeRequest(), {
      params: Promise.resolve({ callerId: "caller-xyz" }),
    });

    expect(mockPrisma.call.findMany.mock.calls[0][0].where.callerId).toBe("caller-xyz");
  });

  it("filters calls to recent window (5 min)", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.callScore.groupBy.mockResolvedValue([]);
    mockPrisma.composedPrompt.findMany.mockResolvedValue([]);

    await GET(makeRequest(), {
      params: Promise.resolve({ callerId: "c1" }),
    });

    const callQuery = mockPrisma.call.findMany.mock.calls[0][0];
    const createdAtGte = callQuery.where.createdAt.gte;
    // Should be approximately 5 minutes ago
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    expect(createdAtGte.getTime()).toBeGreaterThan(fiveMinAgo - 1000);
    expect(createdAtGte.getTime()).toBeLessThan(fiveMinAgo + 1000);
  });

  it("handles null triggerCallId in prompts", async () => {
    mockPrisma.call.findMany.mockResolvedValue([{ id: "call-1" }]);
    mockPrisma.callScore.groupBy.mockResolvedValue([]);
    mockPrisma.composedPrompt.findMany.mockResolvedValue([
      { triggerCallId: null },
    ]);

    const res = await GET(makeRequest(), {
      params: Promise.resolve({ callerId: "c1" }),
    });
    const json = await res.json();

    expect(json.calls[0].hasPrompt).toBe(false);
  });
});

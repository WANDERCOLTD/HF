/**
 * Tests for Testimony APIs:
 *   GET /api/testimony/specs            — Per-spec aggregates
 *   GET /api/testimony/specs/[specId]   — Deep spec stats
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  analysisSpec: { findMany: vi.fn(), findUnique: vi.fn() },
  callScore: { aggregate: vi.fn(), findMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "admin-1", role: "ADMIN" } },
  }),
  isAuthError: vi.fn((r: Record<string, unknown>) => "error" in r),
}));

function makeParams<T extends Record<string, string>>(obj: T) {
  return { params: Promise.resolve(obj) };
}

// =====================================================
// LIST SPECS
// =====================================================

describe("GET /api/testimony/specs", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/testimony/specs/route");
    GET = mod.GET;
  });

  it("returns per-spec aggregates", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      { id: "spec-1", slug: "PERS-001", name: "Personality", specRole: "EXTRACT" },
    ]);

    mockPrisma.callScore.aggregate.mockResolvedValue({
      _count: { id: 50 },
      _avg: { score: 0.72, confidence: 0.85 },
      _min: { scoredAt: new Date("2026-01-01") },
      _max: { scoredAt: new Date("2026-02-15") },
    });

    mockPrisma.callScore.findMany.mockResolvedValue([
      { callerId: "c1" },
      { callerId: "c2" },
      { callerId: "c3" },
    ]);

    const req = new NextRequest(new URL("http://localhost:3000/api/testimony/specs"));
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.specs).toHaveLength(1);
    expect(body.specs[0].slug).toBe("PERS-001");
    expect(body.specs[0].totalScores).toBe(50);
    expect(body.specs[0].uniqueCallers).toBe(3);
    expect(body.specs[0].avgScore).toBe(0.72);
  });

  it("returns empty when no specs have scores", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const req = new NextRequest(new URL("http://localhost:3000/api/testimony/specs"));
    const res = await GET(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.specs).toHaveLength(0);
  });

  it("accepts domainId filter", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const req = new NextRequest(new URL("http://localhost:3000/api/testimony/specs?domainId=d1"));
    await GET(req);

    expect(mockPrisma.analysisSpec.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          callScores: { some: { call: { caller: { domainId: "d1" } } } },
        }),
      })
    );
  });
});

// =====================================================
// SPEC DETAIL
// =====================================================

describe("GET /api/testimony/specs/[specId]", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/testimony/specs/[specId]/route");
    GET = mod.GET;
  });

  it("returns detailed spec stats", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      slug: "PERS-001",
      name: "Personality",
      specRole: "EXTRACT",
    });

    mockPrisma.callScore.findMany.mockResolvedValue([
      {
        id: "s1",
        parameterId: "confidence",
        score: 0.8,
        confidence: 0.9,
        evidence: ["Good evidence"],
        callerId: "c1",
        callId: "call-1",
        scoredAt: new Date(),
        call: { caller: { id: "c1", name: "Alice" } },
      },
      {
        id: "s2",
        parameterId: "confidence",
        score: 0.6,
        confidence: 0.7,
        evidence: [],
        callerId: "c2",
        callId: "call-2",
        scoredAt: new Date(),
        call: { caller: { id: "c2", name: "Bob" } },
      },
    ]);

    const req = new NextRequest(new URL("http://localhost:3000/api/testimony/specs/spec-1"));
    const res = await GET(req, makeParams({ specId: "spec-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.spec.slug).toBe("PERS-001");
    expect(body.totalScores).toBe(2);
    expect(body.parameterAverages).toHaveLength(1);
    expect(body.parameterAverages[0].parameterId).toBe("confidence");
    expect(body.parameterAverages[0].avgScore).toBe(0.7);
    expect(body.distribution.values).toHaveLength(5);
    expect(body.evidenceQuotes).toHaveLength(1);
    expect(body.callerSummary).toHaveLength(2);
  });

  it("returns 404 for unknown spec", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(null);

    const req = new NextRequest(new URL("http://localhost:3000/api/testimony/specs/nonexistent"));
    const res = await GET(req, makeParams({ specId: "nonexistent" }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

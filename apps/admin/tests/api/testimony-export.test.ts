/**
 * Tests for Testimony Export API:
 *   GET /api/testimony/export — CSV download
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  analysisSpec: { findUnique: vi.fn() },
  callScore: { findMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "admin-1", role: "ADMIN" } },
  }),
  isAuthError: vi.fn((r: Record<string, unknown>) => "error" in r),
}));

describe("GET /api/testimony/export", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/testimony/export/route");
    GET = mod.GET;
  });

  it("returns CSV with correct headers", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      slug: "PERS-001",
      name: "Personality",
    });

    mockPrisma.callScore.findMany.mockResolvedValue([
      {
        parameterId: "confidence",
        score: 0.8,
        confidence: 0.9,
        evidence: ["Example evidence"],
        reasoning: "Good analysis",
        callId: "call-1",
        scoredAt: new Date("2026-02-15T10:00:00Z"),
        call: { caller: { name: "Alice" } },
      },
    ]);

    const req = new NextRequest(
      new URL("http://localhost:3000/api/testimony/export?specId=spec-1")
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("testimony-PERS-001");

    const csv = await res.text();
    const lines = csv.split("\n");

    // Check headers
    expect(lines[0]).toBe(
      "spec_slug,parameter_id,caller_name,call_id,score,confidence,evidence,reasoning,scored_at"
    );

    // Check data row
    expect(lines[1]).toContain("PERS-001");
    expect(lines[1]).toContain("confidence");
    expect(lines[1]).toContain("Alice");
    expect(lines[1]).toContain("0.8");
  });

  it("returns 400 when specId is missing", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/api/testimony/export")
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/specId/i);
  });

  it("returns 404 for unknown spec", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(null);

    const req = new NextRequest(
      new URL("http://localhost:3000/api/testimony/export?specId=nonexistent")
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("handles scores with commas in evidence", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      slug: "TEST-001",
      name: "Test",
    });

    mockPrisma.callScore.findMany.mockResolvedValue([
      {
        parameterId: "test_param",
        score: 0.5,
        confidence: 0.6,
        evidence: ['Evidence with, commas and "quotes"'],
        reasoning: null,
        callId: "call-2",
        scoredAt: new Date("2026-02-15"),
        call: { caller: { name: "Bob" } },
      },
    ]);

    const req = new NextRequest(
      new URL("http://localhost:3000/api/testimony/export?specId=spec-2")
    );
    const res = await GET(req);
    const csv = await res.text();

    // CSV should properly escape commas and quotes
    expect(csv).toContain('"Evidence with, commas and ""quotes"""');
  });

  it("returns auth error when not authorized", async () => {
    const { requireAuth } = await import("@/lib/permissions");
    const { NextResponse } = await import("next/server");
    (requireAuth as any).mockResolvedValueOnce({
      error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    });

    const req = new NextRequest(
      new URL("http://localhost:3000/api/testimony/export?specId=spec-1")
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

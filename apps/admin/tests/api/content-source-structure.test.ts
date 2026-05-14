/**
 * Tests for POST /api/content-sources/:sourceId/structure
 *
 * Verifies:
 * - Auth enforcement (OPERATOR required)
 * - Source validation (exists + has assertions)
 * - Mode validation (preview | apply)
 * - Preview mode returns tree without DB changes
 * - Apply mode returns structuring stats
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  previewStructure: vi.fn(),
  applyStructure: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/content-trust/structure-assertions", () => ({
  previewStructure: mocks.previewStructure,
  applyStructure: mocks.applyStructure,
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentSource: {
      findUnique: vi.fn(),
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

import { POST } from "@/app/api/content-sources/[sourceId]/structure/route";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

function makeRequest(body: Record<string, any>): NextRequest {
  return new NextRequest("http://localhost:3000/api/content-sources/src-1/structure", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const makeParams = () => Promise.resolve({ sourceId: "src-1" });

describe("POST /api/content-sources/:sourceId/structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "OPERATOR" } },
    });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await POST(makeRequest({ mode: "preview" }), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 404 when source not found", async () => {
    (prisma.contentSource.findUnique as any).mockResolvedValue(null);

    const res = await POST(makeRequest({ mode: "preview" }), { params: makeParams() });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("not found");
  });

  it("returns 400 when source has no assertions", async () => {
    (prisma.contentSource.findUnique as any).mockResolvedValue({
      id: "src-1",
      name: "Test Source",
      _count: { assertions: 0 },
    });

    const res = await POST(makeRequest({ mode: "preview" }), { params: makeParams() });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No assertions");
  });

  it("returns 400 for invalid mode", async () => {
    (prisma.contentSource.findUnique as any).mockResolvedValue({
      id: "src-1",
      name: "Test Source",
      _count: { assertions: 10 },
    });

    const res = await POST(makeRequest({ mode: "invalid" }), { params: makeParams() });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid mode");
  });

  it("calls previewStructure in preview mode", async () => {
    (prisma.contentSource.findUnique as any).mockResolvedValue({
      id: "src-1",
      name: "Test Source",
      _count: { assertions: 10 },
    });

    mocks.previewStructure.mockResolvedValue({
      ok: true,
      tree: { text: "Overview", children: [] },
      stats: { totalAssertions: 10, proposedNodes: 5, levelsUsed: 3 },
      warnings: [],
    });

    const res = await POST(makeRequest({ mode: "preview" }), { params: makeParams() });
    expect(res.status).toBe(200);
    expect(mocks.previewStructure).toHaveBeenCalledWith("src-1");
    expect(mocks.applyStructure).not.toHaveBeenCalled();

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.stats.proposedNodes).toBe(5);
  });

  it("calls applyStructure in apply mode", async () => {
    (prisma.contentSource.findUnique as any).mockResolvedValue({
      id: "src-1",
      name: "Test Source",
      _count: { assertions: 10 },
    });

    mocks.applyStructure.mockResolvedValue({
      ok: true,
      tree: { text: "Overview", children: [] },
      stats: { levelsCreated: 3, nodesCreated: 5, assertionsLinked: 10, orphanAssertions: 0 },
      warnings: [],
    });

    const res = await POST(makeRequest({ mode: "apply" }), { params: makeParams() });
    expect(res.status).toBe(200);
    expect(mocks.applyStructure).toHaveBeenCalledWith("src-1");
    expect(mocks.previewStructure).not.toHaveBeenCalled();

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.stats.assertionsLinked).toBe(10);
  });

  it("defaults to preview when no mode specified", async () => {
    (prisma.contentSource.findUnique as any).mockResolvedValue({
      id: "src-1",
      name: "Test Source",
      _count: { assertions: 5 },
    });

    mocks.previewStructure.mockResolvedValue({
      ok: true,
      tree: { text: "Root", children: [] },
      stats: { totalAssertions: 5, proposedNodes: 3, levelsUsed: 2 },
      warnings: [],
    });

    const req = new NextRequest("http://localhost:3000/api/content-sources/src-1/structure", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: makeParams() });
    expect(res.status).toBe(200);
    expect(mocks.previewStructure).toHaveBeenCalledWith("src-1");
  });
});

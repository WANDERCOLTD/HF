/**
 * Tests for Content Source lifecycle: archive, unarchive, permanent delete, usage.
 *
 * Verifies:
 * - DELETE /api/content-sources/:sourceId (archive with safety guards)
 * - POST /api/content-sources/:sourceId/unarchive
 * - DELETE /api/content-sources/:sourceId/permanent
 * - GET /api/content-sources/:sourceId/usage
 * - Archive filter on GET /api/content-sources
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────

const mockRequireAuth = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  isAuthError: (result: any) => !!result.error,
}));

const mockPrisma = {
  contentSource: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

// ── Helpers ────────────────────────────────────────────

const SOURCE_ID = "source-1";
const PARAMS = Promise.resolve({ sourceId: SOURCE_ID });

function mockAuth(role = "ADMIN", userId = "user-1") {
  mockRequireAuth.mockResolvedValue({
    session: { user: { id: userId, role } },
  });
}

function mockAuthFail() {
  mockRequireAuth.mockResolvedValue({
    error: new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  });
}

function makeDeleteRequest(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `http://localhost/api/content-sources/${SOURCE_ID}${qs ? `?${qs}` : ""}`;
  return new NextRequest(url, { method: "DELETE" });
}

function makePostRequest(path = "") {
  return new NextRequest(`http://localhost/api/content-sources/${SOURCE_ID}${path}`, { method: "POST" });
}

function makeGetRequest(path = "", params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost/api/content-sources/${SOURCE_ID}${path}${qs ? `?${qs}` : ""}`, { method: "GET" });
}

const ACTIVE_SOURCE = {
  id: SOURCE_ID,
  slug: "test-source",
  name: "Test Source",
  isActive: true,
  archivedAt: null,
  subjects: [],
  curricula: [],
  _count: { assertions: 10, questions: 5, vocabulary: 3, mediaAssets: 1 },
};

const ARCHIVED_SOURCE = {
  ...ACTIVE_SOURCE,
  isActive: false,
  archivedAt: new Date("2026-01-15"),
};

const IN_USE_SOURCE = {
  ...ACTIVE_SOURCE,
  subjects: [{ subject: { id: "sub-1", name: "Food Safety", slug: "food-safety" } }],
  curricula: [{ id: "cur-1", slug: "highfield-l2", name: "Highfield L2" }],
};

// ── DELETE /api/content-sources/:sourceId (archive) ────

describe("DELETE /api/content-sources/:sourceId (archive)", () => {
  let DELETE: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/[sourceId]/route");
    DELETE = mod.DELETE;
  });

  it("archives an active source", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(ACTIVE_SOURCE);
    mockPrisma.contentSource.update.mockResolvedValue({ ...ACTIVE_SOURCE, isActive: false });

    const res = await DELETE(makeDeleteRequest(), { params: PARAMS });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toContain("archived");
    expect(mockPrisma.contentSource.update).toHaveBeenCalledWith({
      where: { id: SOURCE_ID },
      data: { isActive: false, archivedAt: expect.any(Date) },
    });
  });

  it("returns 404 for non-existent source", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(null);

    const res = await DELETE(makeDeleteRequest(), { params: PARAMS });
    expect(res.status).toBe(404);
  });

  it("returns 400 for already-archived source", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(ARCHIVED_SOURCE);

    const res = await DELETE(makeDeleteRequest(), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("returns 409 when source is in use without force", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(IN_USE_SOURCE);

    const res = await DELETE(makeDeleteRequest(), { params: PARAMS });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.usage.subjects).toHaveLength(1);
    expect(body.usage.curricula).toHaveLength(1);
    expect(mockPrisma.contentSource.update).not.toHaveBeenCalled();
  });

  it("archives with force=true despite usage", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(IN_USE_SOURCE);
    mockPrisma.contentSource.update.mockResolvedValue({ ...IN_USE_SOURCE, isActive: false });

    const res = await DELETE(makeDeleteRequest({ force: "true" }), { params: PARAMS });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.contentSource.update).toHaveBeenCalled();
  });

  it("rejects OPERATOR role", async () => {
    mockAuthFail();
    const res = await DELETE(makeDeleteRequest(), { params: PARAMS });
    expect(res.status).toBe(401);
  });
});

// ── POST /api/content-sources/:sourceId/unarchive ──────

describe("POST /api/content-sources/:sourceId/unarchive", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/[sourceId]/unarchive/route");
    POST = mod.POST;
  });

  it("restores an archived source", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(ARCHIVED_SOURCE);
    mockPrisma.contentSource.update.mockResolvedValue(ACTIVE_SOURCE);

    const res = await POST(makePostRequest("/unarchive"), { params: PARAMS });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.contentSource.update).toHaveBeenCalledWith({
      where: { id: SOURCE_ID },
      data: { isActive: true, archivedAt: null },
    });
  });

  it("returns 400 if source is already active", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(ACTIVE_SOURCE);

    const res = await POST(makePostRequest("/unarchive"), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent source", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(null);

    const res = await POST(makePostRequest("/unarchive"), { params: PARAMS });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/content-sources/:sourceId/permanent ────

describe("DELETE /api/content-sources/:sourceId/permanent", () => {
  let DELETE: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/[sourceId]/permanent/route");
    DELETE = mod.DELETE;
  });

  it("permanently deletes an archived source", async () => {
    mockAuth("SUPERADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(ARCHIVED_SOURCE);
    mockPrisma.contentSource.delete.mockResolvedValue(ARCHIVED_SOURCE);

    const res = await DELETE(makeDeleteRequest(), { params: PARAMS });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted.assertions).toBe(10);
    expect(mockPrisma.contentSource.delete).toHaveBeenCalledWith({ where: { id: SOURCE_ID } });
  });

  it("returns 400 if source is not archived first", async () => {
    mockAuth("SUPERADMIN");
    mockPrisma.contentSource.findUnique.mockResolvedValue(ACTIVE_SOURCE);

    const res = await DELETE(makeDeleteRequest(), { params: PARAMS });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("archived");
  });

  it("rejects ADMIN role (requires SUPERADMIN)", async () => {
    mockAuthFail();
    const res = await DELETE(makeDeleteRequest(), { params: PARAMS });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/content-sources/:sourceId/usage ───────────

describe("GET /api/content-sources/:sourceId/usage", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/[sourceId]/usage/route");
    GET = mod.GET;
  });

  it("returns usage data for a linked source", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentSource.findUnique.mockResolvedValue({
      ...IN_USE_SOURCE,
      subjects: [{
        subject: {
          id: "sub-1",
          name: "Food Safety",
          slug: "food-safety",
          domains: [{
            domain: { id: "dom-1", name: "Test School", slug: "test-school", _count: { callers: 25 } },
          }],
        },
      }],
    });

    const res = await GET(makeGetRequest("/usage"), { params: PARAMS });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.usage.subjects).toHaveLength(1);
    expect(body.usage.domains).toHaveLength(1);
    expect(body.usage.domains[0].callerCount).toBe(25);
    expect(body.usage.totalCallerReach).toBe(25);
  });

  it("returns empty arrays for unlinked source", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentSource.findUnique.mockResolvedValue(ACTIVE_SOURCE);

    const res = await GET(makeGetRequest("/usage"), { params: PARAMS });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.usage.subjects).toHaveLength(0);
    expect(body.usage.domains).toHaveLength(0);
    expect(body.usage.totalCallerReach).toBe(0);
  });

  it("returns 404 for non-existent source", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentSource.findUnique.mockResolvedValue(null);

    const res = await GET(makeGetRequest("/usage"), { params: PARAMS });
    expect(res.status).toBe(404);
  });
});

// ── GET /api/content-sources (archive filter) ──────────

describe("GET /api/content-sources (archive filter)", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/route");
    GET = mod.GET;
  });

  it("defaults to active-only sources", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentSource.findMany.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/content-sources", { method: "GET" });
    await GET(req);

    expect(mockPrisma.contentSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      })
    );
  });

  it("includes all sources when activeOnly=false", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentSource.findMany.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/content-sources?activeOnly=false", { method: "GET" });
    await GET(req);

    expect(mockPrisma.contentSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ isActive: true }),
      })
    );
  });

  it("shows only archived when archivedOnly=true", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentSource.findMany.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/content-sources?archivedOnly=true", { method: "GET" });
    await GET(req);

    expect(mockPrisma.contentSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: false, archivedAt: { not: null } }),
      })
    );
  });
});

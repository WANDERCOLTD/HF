import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────

const mockRequireAuth = vi.fn();
vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  isAuthError: (result: any) => !!result.error,
}));

const mockPrisma = {
  contentAssertion: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

// ── Helpers ────────────────────────────────────────────

function mockAuth(role = "OPERATOR", userId = "user-1") {
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

const SOURCE_ID = "source-1";
const ASSERTION_ID = "assertion-1";

function makeRequest(method: string, body?: any) {
  const url = `http://localhost/api/content-sources/${SOURCE_ID}/assertions/${ASSERTION_ID}`;
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

function makeBulkRequest(body: any) {
  const url = `http://localhost/api/content-sources/${SOURCE_ID}/assertions/bulk-review`;
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeGetRequest(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `http://localhost/api/content-sources/${SOURCE_ID}/assertions${qs ? `?${qs}` : ""}`;
  return new NextRequest(url, { method: "GET" });
}

const PARAMS = Promise.resolve({ sourceId: SOURCE_ID, assertionId: ASSERTION_ID });
const SOURCE_PARAMS = Promise.resolve({ sourceId: SOURCE_ID });

// ── Tests: PATCH assertion ─────────────────────────────

describe("PATCH /api/content-sources/:sourceId/assertions/:assertionId", () => {
  let PATCH: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/[sourceId]/assertions/[assertionId]/route");
    PATCH = mod.PATCH;
  });

  it("updates assertion text and category", async () => {
    mockAuth();
    mockPrisma.contentAssertion.findUnique.mockResolvedValue({
      id: ASSERTION_ID,
      sourceId: SOURCE_ID,
      assertion: "Old text",
      category: "fact",
    });
    mockPrisma.contentAssertion.update.mockResolvedValue({
      id: ASSERTION_ID,
      assertion: "New text here",
      category: "rule",
    });

    const res = await PATCH(
      makeRequest("PATCH", { assertion: "New text here", category: "rule" }),
      { params: PARAMS }
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockPrisma.contentAssertion.update).toHaveBeenCalledWith({
      where: { id: ASSERTION_ID },
      data: expect.objectContaining({ assertion: "New text here", category: "rule" }),
    });
  });

  it("returns 404 for non-existent assertion", async () => {
    mockAuth();
    mockPrisma.contentAssertion.findUnique.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest("PATCH", { assertion: "Updated text" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when assertion belongs to different source", async () => {
    mockAuth();
    mockPrisma.contentAssertion.findUnique.mockResolvedValue({
      id: ASSERTION_ID,
      sourceId: "other-source",
    });

    const res = await PATCH(
      makeRequest("PATCH", { assertion: "Updated text" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(404);
  });

  it("validates assertion text length", async () => {
    mockAuth();
    mockPrisma.contentAssertion.findUnique.mockResolvedValue({
      id: ASSERTION_ID,
      sourceId: SOURCE_ID,
    });

    const res = await PATCH(
      makeRequest("PATCH", { assertion: "Hi" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("5-5000");
  });

  it("validates category value", async () => {
    mockAuth();
    mockPrisma.contentAssertion.findUnique.mockResolvedValue({
      id: ASSERTION_ID,
      sourceId: SOURCE_ID,
    });

    const res = await PATCH(
      makeRequest("PATCH", { category: "invalid" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid category");
  });

  it("validates examRelevance range", async () => {
    mockAuth();
    mockPrisma.contentAssertion.findUnique.mockResolvedValue({
      id: ASSERTION_ID,
      sourceId: SOURCE_ID,
    });

    const res = await PATCH(
      makeRequest("PATCH", { examRelevance: 1.5 }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("0.0 and 1.0");
  });

  it("sets reviewedBy and reviewedAt when markReviewed is true", async () => {
    mockAuth("OPERATOR", "reviewer-42");
    mockPrisma.contentAssertion.findUnique.mockResolvedValue({
      id: ASSERTION_ID,
      sourceId: SOURCE_ID,
    });
    mockPrisma.contentAssertion.update.mockResolvedValue({ id: ASSERTION_ID });

    const res = await PATCH(
      makeRequest("PATCH", { markReviewed: true }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.contentAssertion.update).toHaveBeenCalledWith({
      where: { id: ASSERTION_ID },
      data: expect.objectContaining({
        reviewedBy: "reviewer-42",
        reviewedAt: expect.any(Date),
      }),
    });
  });

  it("returns 401 for unauthenticated request", async () => {
    mockAuthFail();
    const res = await PATCH(
      makeRequest("PATCH", { assertion: "Test" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(401);
  });
});

// ── Tests: DELETE assertion ────────────────────────────

describe("DELETE /api/content-sources/:sourceId/assertions/:assertionId", () => {
  let DELETE: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/[sourceId]/assertions/[assertionId]/route");
    DELETE = mod.DELETE;
  });

  it("deletes assertion with no children", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentAssertion.findUnique.mockResolvedValue({
      id: ASSERTION_ID,
      sourceId: SOURCE_ID,
      _count: { children: 0 },
    });
    mockPrisma.contentAssertion.delete.mockResolvedValue({ id: ASSERTION_ID });

    const res = await DELETE(
      makeRequest("DELETE"),
      { params: PARAMS }
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.deleted.id).toBe(ASSERTION_ID);
  });

  it("refuses to delete assertion with children", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentAssertion.findUnique.mockResolvedValue({
      id: ASSERTION_ID,
      sourceId: SOURCE_ID,
      _count: { children: 3 },
    });

    const res = await DELETE(
      makeRequest("DELETE"),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("children");
  });

  it("returns 404 for non-existent assertion", async () => {
    mockAuth("ADMIN");
    mockPrisma.contentAssertion.findUnique.mockResolvedValue(null);

    const res = await DELETE(
      makeRequest("DELETE"),
      { params: PARAMS }
    );
    expect(res.status).toBe(404);
  });
});

// ── Tests: POST bulk-review ────────────────────────────

describe("POST /api/content-sources/:sourceId/assertions/bulk-review", () => {
  let POST: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/[sourceId]/assertions/bulk-review/route");
    POST = mod.POST;
  });

  it("bulk marks assertions as reviewed", async () => {
    mockAuth("OPERATOR", "user-1");
    const ids = ["a1", "a2", "a3"];
    mockPrisma.contentAssertion.count.mockResolvedValue(3);
    mockPrisma.contentAssertion.updateMany.mockResolvedValue({ count: 3 });

    const res = await POST(
      makeBulkRequest({ assertionIds: ids }),
      { params: SOURCE_PARAMS }
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.updated).toBe(3);
    expect(mockPrisma.contentAssertion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ids }, sourceId: SOURCE_ID },
      data: { reviewedBy: "user-1", reviewedAt: expect.any(Date) },
    });
  });

  it("rejects empty assertionIds array", async () => {
    mockAuth();
    const res = await POST(
      makeBulkRequest({ assertionIds: [] }),
      { params: SOURCE_PARAMS }
    );
    expect(res.status).toBe(400);
  });

  it("rejects more than 100 IDs", async () => {
    mockAuth();
    const ids = Array.from({ length: 101 }, (_, i) => `a-${i}`);
    const res = await POST(
      makeBulkRequest({ assertionIds: ids }),
      { params: SOURCE_PARAMS }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("100");
  });

  it("rejects when some IDs don't belong to source", async () => {
    mockAuth();
    mockPrisma.contentAssertion.count.mockResolvedValue(2); // only 2 of 3 match

    const res = await POST(
      makeBulkRequest({ assertionIds: ["a1", "a2", "a3"] }),
      { params: SOURCE_PARAMS }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("1 assertion(s) not found");
  });
});

// ── Tests: GET assertions (enhanced) ───────────────────

describe("GET /api/content-sources/:sourceId/assertions", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/content-sources/[sourceId]/assertions/route");
    GET = mod.GET;
  });

  it("returns assertions with review progress", async () => {
    mockAuth("VIEWER");
    const assertions = [
      { id: "a1", assertion: "Test", reviewedBy: "user-1", reviewedAt: new Date(), _count: { children: 0 } },
      { id: "a2", assertion: "Test 2", reviewedBy: null, reviewedAt: null, _count: { children: 0 } },
    ];
    mockPrisma.contentAssertion.findMany.mockResolvedValue(assertions);
    mockPrisma.contentAssertion.count
      .mockResolvedValueOnce(2) // total with filters
      .mockResolvedValueOnce(1) // reviewed count
      .mockResolvedValueOnce(2); // total for source
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "user-1", name: "Alice", email: "alice@test.com" },
    ]);

    const res = await GET(
      makeGetRequest(),
      { params: SOURCE_PARAMS }
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.assertions).toHaveLength(2);
    expect(data.total).toBe(2);
    expect(data.reviewed).toBe(1);
    expect(data.reviewProgress).toBe(50);
    // First assertion has reviewer info
    expect(data.assertions[0].reviewer).toEqual({ id: "user-1", name: "Alice", email: "alice@test.com" });
    // Second assertion has no reviewer
    expect(data.assertions[1].reviewer).toBeNull();
  });

  it("filters by reviewed=true", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.count.mockResolvedValue(0);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await GET(
      makeGetRequest({ reviewed: "true" }),
      { params: SOURCE_PARAMS }
    );

    expect(mockPrisma.contentAssertion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceId: SOURCE_ID,
          reviewedAt: { not: null },
        }),
      })
    );
  });

  it("filters by reviewed=false", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.count.mockResolvedValue(0);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await GET(
      makeGetRequest({ reviewed: "false" }),
      { params: SOURCE_PARAMS }
    );

    expect(mockPrisma.contentAssertion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceId: SOURCE_ID,
          reviewedAt: null,
        }),
      })
    );
  });

  it("applies category filter and search", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.count.mockResolvedValue(0);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await GET(
      makeGetRequest({ category: "fact", search: "pension" }),
      { params: SOURCE_PARAMS }
    );

    expect(mockPrisma.contentAssertion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceId: SOURCE_ID,
          category: "fact",
          assertion: { contains: "pension", mode: "insensitive" },
        }),
      })
    );
  });

  it("respects sortBy and sortDir", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.count.mockResolvedValue(0);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await GET(
      makeGetRequest({ sortBy: "category", sortDir: "desc" }),
      { params: SOURCE_PARAMS }
    );

    expect(mockPrisma.contentAssertion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ category: "desc" }, { createdAt: "asc" }],
      })
    );
  });

  it("paginates with limit and offset", async () => {
    mockAuth("VIEWER");
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.count.mockResolvedValue(0);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await GET(
      makeGetRequest({ limit: "10", offset: "20" }),
      { params: SOURCE_PARAMS }
    );

    expect(mockPrisma.contentAssertion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 20,
      })
    );
  });
});

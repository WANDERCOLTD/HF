/**
 * Tests for GET /api/courses/[courseId]/call1-override-preview — #798.
 *
 * Coverage:
 *  - Auth: requireAuth("OPERATOR") gate (mocked allow)
 *  - 404 when playbook missing
 *  - Empty when playbook has no sources
 *  - Returns count + samples (truncated to 120 chars, max 3) for exact `section="1"`
 *  - rangeFormCount captures `section` containing "-" (e.g. "1-3")
 *  - Range-form assertions are NOT included in samples (exact-match only)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "u1", email: "op@test.com", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn((result: Record<string, unknown>) => "error" in result),
}));

const mockPrisma = {
  playbook: { findUnique: vi.fn() },
  contentAssertion: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/knowledge/domain-sources", () => ({
  getSourceIdsForPlaybook: vi.fn(),
}));

// Route handler signature is intentionally loose here — the runtime arg is
// a NextRequest but the test injects a plain Request, and the Next types
// don't sufficiently overlap for a direct cast.
type GetHandler = (
  req: unknown,
  ctx: { params: Promise<{ courseId: string }> },
) => Promise<Response>;

describe("GET /api/courses/[id]/call1-override-preview", () => {
  let GET: GetHandler;
  let mockGetSourceIds: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "pb1" });
    const ds = await import("@/lib/knowledge/domain-sources");
    mockGetSourceIds = ds.getSourceIdsForPlaybook as ReturnType<typeof vi.fn>;
    const mod = await import("@/app/api/courses/[courseId]/call1-override-preview/route");
    GET = mod.GET as GetHandler;
  });

  function call() {
    return GET(
      new Request("http://localhost/api/courses/pb1/call1-override-preview"),
      { params: Promise.resolve({ courseId: "pb1" }) },
    );
  }

  it("404 when playbook missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("returns empty when playbook has no scoped sources", async () => {
    mockGetSourceIds.mockResolvedValue([]);
    const res = await call();
    const json = await res.json();
    expect(json).toEqual({ ok: true, count: 0, samples: [], rangeFormCount: 0 });
    // Did NOT hit assertion queries
    expect(mockPrisma.contentAssertion.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.contentAssertion.count).not.toHaveBeenCalled();
  });

  it("returns count + truncated samples for exact section='1' matches", async () => {
    mockGetSourceIds.mockResolvedValue(["src-1", "src-2"]);
    const longText = "x".repeat(200);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([
      { id: "a1", learningOutcomeRef: "LO-1", assertion: "Short fact" },
      { id: "a2", learningOutcomeRef: null, assertion: longText },
      { id: "a3", learningOutcomeRef: "LO-3", assertion: "Another" },
      { id: "a4", learningOutcomeRef: null, assertion: "Fourth — beyond samples cap" },
    ]);
    mockPrisma.contentAssertion.count.mockResolvedValue(0);

    const res = await call();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.count).toBe(4);
    expect(json.samples).toHaveLength(3); // cap = MAX_SAMPLES
    expect(json.samples[0]).toEqual({ id: "a1", ref: "LO-1", text: "Short fact", truncated: false });
    // Long text truncated to 120 + ellipsis
    expect(json.samples[1].truncated).toBe(true);
    expect(json.samples[1].text.length).toBe(121); // 120 chars + "…"
    expect(json.samples[1].text.endsWith("…")).toBe(true);
    expect(json.rangeFormCount).toBe(0);
  });

  it("rangeFormCount counts assertions with section containing '-' (e.g. '1-3')", async () => {
    mockGetSourceIds.mockResolvedValue(["src-1"]);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.count.mockResolvedValue(5);

    const res = await call();
    const json = await res.json();
    expect(json.count).toBe(0); // no exact-match samples
    expect(json.rangeFormCount).toBe(5);

    // Verify the range-form query used `section: { contains: '-' }`
    const countCall = mockPrisma.contentAssertion.count.mock.calls[0][0];
    expect(countCall.where.sourceId).toEqual({ in: ["src-1"] });
    expect(countCall.where.category).toBe("session_override");
    expect(countCall.where.section).toEqual({ contains: "-" });
  });

  it("exact-match query uses section: '1' (string equality, not range)", async () => {
    mockGetSourceIds.mockResolvedValue(["src-1"]);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
    mockPrisma.contentAssertion.count.mockResolvedValue(0);

    await call();
    const findCall = mockPrisma.contentAssertion.findMany.mock.calls[0][0];
    expect(findCall.where.sourceId).toEqual({ in: ["src-1"] });
    expect(findCall.where.category).toBe("session_override");
    expect(findCall.where.section).toBe("1"); // exact string, NOT a range matcher
  });
});

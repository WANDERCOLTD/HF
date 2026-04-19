/**
 * Tests for content-breakdown bySubject deduplication.
 * Verifies that per-subject breakdown uses a single groupBy query
 * instead of N queries (one per subject).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock setup ──

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn() },
    playbookSource: { findMany: vi.fn() },
    playbookSubject: { findMany: vi.fn() },
    contentAssertion: {
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: "u1" }),
  isAuthError: vi.fn().mockReturnValue(false),
}));
const { mockGetSubjects } = vi.hoisted(() => ({
  mockGetSubjects: vi.fn(),
}));
vi.mock("@/lib/knowledge/domain-sources", () => ({
  getSubjectsForPlaybook: mockGetSubjects,
}));
vi.mock("@/lib/content-trust/resolve-config", () => ({
  INSTRUCTION_CATEGORIES: ["instruction", "procedure", "worked_example"],
}));

import { GET } from "@/app/api/courses/[courseId]/content-breakdown/route";

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/courses/c1/content-breakdown");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

describe("GET /api/courses/:courseId/content-breakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "c1",
      config: { teachingMode: "socratic" },
      domain: { id: "d1" },
    });

    // getSubjectsForPlaybook returns subjects with sources — used to derive sourceIds
    mockGetSubjects.mockResolvedValue({
      subjects: [
        { id: "sub1", sources: [{ sourceId: "s1" }, { sourceId: "s2" }, { sourceId: "s3" }] },
      ],
      scoped: true,
    });

    // 5 subjects for bySubject breakdown
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      { subject: { id: "sub1", name: "Subject 1" } },
      { subject: { id: "sub2", name: "Subject 2" } },
      { subject: { id: "sub3", name: "Subject 3" } },
      { subject: { id: "sub4", name: "Subject 4" } },
      { subject: { id: "sub5", name: "Subject 5" } },
    ]);

    // Mock all groupBy calls — summary mode needs several
    mockPrisma.contentAssertion.groupBy.mockResolvedValue([
      { teachMethod: "explanation", _count: { id: 10 } },
      { teachMethod: "example", _count: { id: 5 } },
    ]);

    mockPrisma.contentAssertion.count.mockResolvedValue(15);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([]);
  });

  it("uses a single groupBy query for bySubject breakdown (not N queries)", async () => {
    const req = makeRequest({ bySubject: "true" });
    const res = await GET(req as any, { params: Promise.resolve({ courseId: "c1" }) });
    const json = await res.json();

    expect(json.ok).toBe(true);

    // Count how many times groupBy was called.
    // Summary mode calls groupBy several times (teachMethod, category, reviewed-by-method).
    // bySubject should add exactly ONE more groupBy call, not 5.
    const groupByCalls = mockPrisma.contentAssertion.groupBy.mock.calls;

    // Total groupBy calls should be well under the old N+1 count.
    // With 5 subjects, the old code would make 5 bySubject calls alone.
    // Now we should see at most ~4 total groupBy calls (summary mode has a few).
    // The key invariant: NOT 5+ calls to groupBy.
    expect(groupByCalls.length).toBeLessThanOrEqual(5);
    // And definitely fewer than old code which would have been 5 (subjects) + summary calls
    expect(groupByCalls.length).toBeLessThan(8);
  });

  it("returns correct bySubject shape with all 5 subjects", async () => {
    const req = makeRequest({ bySubject: "true" });
    const res = await GET(req as any, { params: Promise.resolve({ courseId: "c1" }) });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.bySubject).toHaveLength(5);

    // Each subject should have the same methods (since all share same sourceIds)
    for (const sub of json.bySubject) {
      expect(sub).toHaveProperty("subjectId");
      expect(sub).toHaveProperty("subjectName");
      expect(sub).toHaveProperty("methods");
      expect(sub.methods).toEqual([
        { teachMethod: "explanation", count: 10 },
        { teachMethod: "example", count: 5 },
      ]);
    }
  });

  it("returns empty bySubject when no subjects linked", async () => {
    mockPrisma.playbookSubject.findMany.mockResolvedValue([]);

    const req = makeRequest({ bySubject: "true" });
    const res = await GET(req as any, { params: Promise.resolve({ courseId: "c1" }) });
    const json = await res.json();

    expect(json.ok).toBe(true);
    // bySubject is an empty array (truthy, so it's included in spread)
    expect(json.bySubject).toHaveLength(0);
  });

  it("handles zero sources gracefully", async () => {
    mockPrisma.playbookSource.findMany.mockResolvedValue([]);

    const req = makeRequest({ bySubject: "true" });
    const res = await GET(req as any, { params: Promise.resolve({ courseId: "c1" }) });
    const json = await res.json();

    expect(json.ok).toBe(true);
  });
});

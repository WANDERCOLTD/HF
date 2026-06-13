/**
 * Tests for `GET /api/courses/[courseId]/skills-source-lineage` — SP3-B.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn() },
    playbookSource: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: (v: unknown) =>
    typeof v === "object" && v !== null && "error" in v,
}));

const PARAMS = { params: Promise.resolve({ courseId: "course-1" }) };

async function loadRoute() {
  return import("@/app/api/courses/[courseId]/skills-source-lineage/route");
}

describe("GET /api/courses/[courseId]/skills-source-lineage — SP3-B", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for STUDENT (refused at requireAuth OPERATOR gate)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when playbook missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns empty=true + empty sources when no COURSE_REFERENCE linked", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "course-1" });
    mockPrisma.playbookSource.findMany.mockResolvedValue([]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.empty).toBe(true);
    expect(body.sources).toEqual([]);
    expect(body.playbookId).toBe("course-1");
  });

  it("returns alphabetised source rows when linked", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "course-1" });
    mockPrisma.playbookSource.findMany.mockResolvedValue([
      {
        source: {
          id: "src-b",
          name: "Course Reference B",
          documentType: "COURSE_REFERENCE",
          updatedAt: new Date("2026-06-10T12:00:00Z"),
          _count: { assertions: 47 },
        },
      },
      {
        source: {
          id: "src-a",
          name: "Course Reference A",
          documentType: "COURSE_REFERENCE_TUTOR_BRIEFING",
          updatedAt: new Date("2026-06-08T09:00:00Z"),
          _count: { assertions: 12 },
        },
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.empty).toBe(false);
    expect(body.sources).toHaveLength(2);
    // Alpha order
    expect(body.sources[0].name).toBe("Course Reference A");
    expect(body.sources[1].name).toBe("Course Reference B");
    expect(body.sources[0].assertionCount).toBe(12);
    expect(body.sources[1].assertionCount).toBe(47);
  });

  it("filters out rows with null source (defensive against orphan join rows)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "course-1" });
    mockPrisma.playbookSource.findMany.mockResolvedValue([
      { source: null },
      {
        source: {
          id: "src-a",
          name: "Valid",
          documentType: "COURSE_REFERENCE",
          updatedAt: new Date("2026-06-10T12:00:00Z"),
          _count: { assertions: 5 },
        },
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].name).toBe("Valid");
  });
});

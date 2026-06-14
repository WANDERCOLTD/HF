/**
 * Tests for `GET /api/courses/[courseId]/section-staleness` — #1557.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn() },
    playbookSectionStaleness: { findMany: vi.fn() },
    callerPlaybook: { count: vi.fn() },
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
  return import("@/app/api/courses/[courseId]/section-staleness/route");
}

describe("GET /api/courses/[courseId]/section-staleness — #1557", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.playbookSectionStaleness.findMany.mockResolvedValue([]);
    mockPrisma.callerPlaybook.count.mockResolvedValue(0);
  });

  it("returns 403 for STUDENT (OPERATOR+ gate)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when course missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns ok:true with empty sections + capped:false when none bumped", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "course-1" });
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, sections: [], capped: false });
  });

  it("returns section rows + caller count", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "course-1" });
    mockPrisma.playbookSectionStaleness.findMany.mockResolvedValue([
      {
        sectionKey: "welcome",
        sectionHash: "aaaa1111aaaa1111",
        staleSince: new Date("2026-06-14T00:00:00Z"),
      },
    ]);
    mockPrisma.callerPlaybook.count.mockResolvedValue(7);

    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.capped).toBe(false);
    expect(body.sections).toEqual([
      {
        sectionKey: "welcome",
        sectionHash: "aaaa1111aaaa1111",
        staleSince: "2026-06-14T00:00:00.000Z",
        affectedCallerCount: 7,
      },
    ]);
  });

  it("reports capped:true when enrollments exceed 1000", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: "course-1" });
    mockPrisma.playbookSectionStaleness.findMany.mockResolvedValue([
      {
        sectionKey: "welcome",
        sectionHash: "aaaa1111aaaa1111",
        staleSince: new Date("2026-06-14T00:00:00Z"),
      },
    ]);
    mockPrisma.callerPlaybook.count.mockResolvedValue(1001);

    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.capped).toBe(true);
    expect(body.sections[0].affectedCallerCount).toBe(1000);
  });

  it("returns 400 on empty courseId", async () => {
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ courseId: "" }),
    });
    expect(res.status).toBe(400);
  });
});

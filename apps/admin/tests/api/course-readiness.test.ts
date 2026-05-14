/**
 * Tests for Course Readiness API:
 *   GET /api/domains/:domainId/course-readiness
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "u1", email: "admin@test.com", role: "ADMIN" } },
  }),
  isAuthError: vi.fn((result: Record<string, unknown>) => "error" in result),
}));

vi.mock("@/lib/domain/course-readiness", () => ({
  checkCourseReadiness: vi.fn(),
}));

const mockPrisma = {
  domain: {
    findUnique: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/config", () => ({
  config: {
    specs: {
      courseReady: "COURSE-READY-001",
      communityReady: "COMMUNITY-READY-001",
    },
  },
}));

describe("GET /api/domains/:domainId/course-readiness", () => {
  let GET: any;
  let mockCheckCourseReadiness: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: INSTITUTION domain
    mockPrisma.domain.findUnique.mockResolvedValue({ kind: "INSTITUTION" });

    const courseReadiness = await import("@/lib/domain/course-readiness");
    mockCheckCourseReadiness = courseReadiness.checkCourseReadiness;

    const mod = await import("@/app/api/domains/[domainId]/course-readiness/route");
    GET = mod.GET;
  });

  it("returns readiness result with context params", async () => {
    mockCheckCourseReadiness.mockResolvedValue({
      domainId: "dom-1",
      ready: true,
      score: 75,
      level: "almost",
      checks: [
        { id: "assertions_reviewed", passed: true, severity: "recommended", name: "Review Teaching Points", detail: "25/50 reviewed", description: "" },
        { id: "prompt_composed", passed: true, severity: "critical", name: "Preview Prompt", detail: "Composed", description: "" },
      ],
      criticalPassed: 1,
      criticalTotal: 1,
      recommendedPassed: 1,
      recommendedTotal: 1,
    });

    const url = "http://localhost/api/domains/dom-1/course-readiness?callerId=c1&sourceId=s1&subjectId=sub1";
    const request = new Request(url);
    const params = Promise.resolve({ domainId: "dom-1" });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.ready).toBe(true);
    expect(data.checks).toHaveLength(2);
    expect(data.timestamp).toBeTruthy();

    // Verify context and spec slug were passed correctly
    expect(mockCheckCourseReadiness).toHaveBeenCalledWith(
      {
        domainId: "dom-1",
        callerId: "c1",
        sourceId: "s1",
        subjectId: "sub1",
      },
      "COURSE-READY-001",
    );
  });

  it("uses COMMUNITY-READY-001 for community domains", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({ kind: "COMMUNITY" });
    mockCheckCourseReadiness.mockResolvedValue({
      domainId: "dom-2",
      ready: true,
      score: 100,
      level: "ready",
      checks: [],
      criticalPassed: 1,
      criticalTotal: 1,
      recommendedPassed: 1,
      recommendedTotal: 1,
    });

    const url = "http://localhost/api/domains/dom-2/course-readiness";
    const request = new Request(url);
    const params = Promise.resolve({ domainId: "dom-2" });

    await GET(request, { params });

    expect(mockCheckCourseReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ domainId: "dom-2" }),
      "COMMUNITY-READY-001",
    );
  });

  it("handles errors gracefully", async () => {
    mockCheckCourseReadiness.mockRejectedValue(new Error("DB connection failed"));

    const url = "http://localhost/api/domains/dom-1/course-readiness";
    const request = new Request(url);
    const params = Promise.resolve({ domainId: "dom-1" });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("DB connection failed");
  });

  it("passes undefined for missing query params", async () => {
    mockCheckCourseReadiness.mockResolvedValue({
      domainId: "dom-1",
      ready: false,
      score: 0,
      level: "incomplete",
      checks: [],
      criticalPassed: 0,
      criticalTotal: 0,
      recommendedPassed: 0,
      recommendedTotal: 0,
    });

    const url = "http://localhost/api/domains/dom-1/course-readiness";
    const request = new Request(url);
    const params = Promise.resolve({ domainId: "dom-1" });

    await GET(request, { params });

    expect(mockCheckCourseReadiness).toHaveBeenCalledWith(
      {
        domainId: "dom-1",
        callerId: undefined,
        sourceId: undefined,
        subjectId: undefined,
      },
      "COURSE-READY-001",
    );
  });
});

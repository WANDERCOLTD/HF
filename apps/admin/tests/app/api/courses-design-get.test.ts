/**
 * Tests for the new GET /api/courses/[courseId]/design (#1417).
 *
 * Pre-fix the FirstSessionSettings panel only knew about
 * `playbook.config.firstSessionTargets` — `BehaviorTarget(scope=PLAYBOOK)`
 * rows were invisible. This GET merges both sources with an `origin`
 * field so the panel can show what compose actually sees.
 *
 * Covers:
 *   - 200 with merged rows (both sources populated)
 *   - 200 with only firstSessionTargets
 *   - 200 with only BehaviorTarget rows
 *   - 200 with empty rows when neither populated
 *   - 200 returns DUPLICATE entries (no silent dedup) for the conflict
 *     case (same parameterId in both sources)
 *   - 404 when playbook not found
 *   - requireAuth gated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAuth = vi.fn();
const isAuthError = vi.fn();

const prismaMock = {
  playbook: { findUnique: vi.fn() },
  behaviorTarget: { findMany: vi.fn() },
};

vi.mock("@/lib/permissions", () => ({ requireAuth, isAuthError }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  isAuthError.mockReturnValue(false);
  requireAuth.mockResolvedValue({ session: { user: { id: "u1" } } });
});

function makeRequest(): import("next/server").NextRequest {
  return new Request("http://localhost:3000/api/courses/c1/design") as unknown as
    import("next/server").NextRequest;
}

const PARAMS = { params: Promise.resolve({ courseId: "c1" }) };

describe("GET /api/courses/[courseId]/design — #1417", () => {
  it("returns merged rows when both sources populated", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "c1",
      config: {
        firstSessionTargets: { "BEH-WARMTH": { value: 0.7 } },
        firstCallMode: "teach_immediately",
      },
    });
    prismaMock.behaviorTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "BEH-CHALLENGE-LEVEL",
        targetValue: 0.4,
        source: "MANUAL",
        updatedAt: new Date("2026-05-22T00:00:00Z"),
      },
    ]);

    const { GET } = await import("@/app/api/courses/[courseId]/design/route");
    const res = await GET(makeRequest(), PARAMS);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.firstCallMode).toBe("teach_immediately");
    expect(body.rows).toHaveLength(2);
    expect(body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterId: "BEH-WARMTH",
          origin: "firstSessionTargets",
        }),
        expect.objectContaining({
          parameterId: "BEH-CHALLENGE-LEVEL",
          origin: "behaviorTarget",
          source: "MANUAL",
        }),
      ]),
    );
  });

  it("returns only firstSessionTargets rows when no BehaviorTarget exists", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "c1",
      config: { firstSessionTargets: { "BEH-WARMTH": { value: 0.7 } } },
    });
    prismaMock.behaviorTarget.findMany.mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/courses/[courseId]/design/route");
    const res = await GET(makeRequest(), PARAMS);

    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].origin).toBe("firstSessionTargets");
  });

  it("returns only behaviorTarget rows when firstSessionTargets is empty (the pre-fix invisible state)", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "c1",
      config: {},
    });
    prismaMock.behaviorTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "BEH-RESPONSE-LEN",
        targetValue: 0.2,
        source: "MANUAL",
        updatedAt: new Date("2026-06-09T00:00:00Z"),
      },
      {
        parameterId: "BEH-TURN-LENGTH",
        targetValue: 0.2,
        source: "MANUAL",
        updatedAt: new Date("2026-06-09T00:00:00Z"),
      },
    ]);

    const { GET } = await import("@/app/api/courses/[courseId]/design/route");
    const res = await GET(makeRequest(), PARAMS);
    const body = await res.json();

    expect(body.rows).toHaveLength(2);
    body.rows.forEach((r: { origin: string }) =>
      expect(r.origin).toBe("behaviorTarget"),
    );
  });

  it("returns DUPLICATE entries (no silent dedup) when same parameterId in both sources", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "c1",
      config: { firstSessionTargets: { "BEH-WARMTH": { value: 0.7 } } },
    });
    prismaMock.behaviorTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "BEH-WARMTH",
        targetValue: 0.4,
        source: "MANUAL",
        updatedAt: new Date("2026-05-22T00:00:00Z"),
      },
    ]);

    const { GET } = await import("@/app/api/courses/[courseId]/design/route");
    const res = await GET(makeRequest(), PARAMS);
    const body = await res.json();

    expect(body.rows).toHaveLength(2);
    const origins = body.rows.map(
      (r: { parameterId: string; origin: string }) => r.origin,
    );
    expect(origins).toContain("firstSessionTargets");
    expect(origins).toContain("behaviorTarget");
  });

  it("returns empty rows when neither source has entries", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({ id: "c1", config: {} });
    prismaMock.behaviorTarget.findMany.mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/courses/[courseId]/design/route");
    const res = await GET(makeRequest(), PARAMS);
    const body = await res.json();
    expect(body.rows).toEqual([]);
  });

  it("returns 404 when playbook not found", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/courses/[courseId]/design/route");
    const res = await GET(makeRequest(), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns 403 from requireAuth when not authorised", async () => {
    isAuthError.mockReturnValueOnce(true);
    requireAuth.mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    });
    const { GET } = await import("@/app/api/courses/[courseId]/design/route");
    const res = await GET(makeRequest(), PARAMS);
    expect(res.status).toBe(403);
  });
});

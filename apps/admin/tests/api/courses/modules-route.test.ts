/**
 * Tests for `GET /api/courses/[courseId]/modules` — Phase P3 of epic #1850.
 *
 * Pins:
 *   - OPERATOR+ admit gate (STUDENT rejected)
 *   - 404 on missing course
 *   - 400 on empty courseId
 *   - Returns AuthoredModule[] from `Playbook.config.modules` (NOT the
 *     CurriculumModule[] returned by the sibling `/sessions` route)
 *   - Sort: by `position`, then label
 *   - G8 `settings` sub-object preserved verbatim
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn() },
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
  return import("@/app/api/courses/[courseId]/modules/route");
}

describe("GET /api/courses/[courseId]/modules — P3 (#1850)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when requireAuth rejects (STUDENT below OPERATOR)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when course is missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Course not found/);
  });

  it("returns 400 when courseId is empty", async () => {
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), {
      params: Promise.resolve({ courseId: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns the AuthoredModule[] from Playbook.config.modules", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "course-1",
      config: {
        modules: [
          {
            id: "part2",
            label: "Part 2 — Long Turn",
            learnerSelectable: true,
            mode: "examiner",
            duration: "4 min fixed",
            scoringFired: "All four",
            voiceBandReadout: false,
            sessionTerminal: false,
            frequency: "repeatable",
            outcomesPrimary: [],
            prerequisites: [],
            position: 2,
            settings: {
              questionTarget: { min: 1, target: 1 },
              cueCardPool: [{ topic: "A book", bullets: ["author", "why"] }],
            },
          },
          {
            id: "part1",
            label: "Part 1 — Interview",
            learnerSelectable: true,
            mode: "examiner",
            duration: "4 min fixed",
            scoringFired: "All four",
            voiceBandReadout: false,
            sessionTerminal: false,
            frequency: "repeatable",
            outcomesPrimary: [],
            prerequisites: [],
            position: 1,
            settings: {
              questionTarget: { min: 10, target: 13 },
            },
          },
        ],
      },
    });

    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.modules).toHaveLength(2);
    // Sort by position (part1 → part2).
    expect(body.modules[0].id).toBe("part1");
    expect(body.modules[1].id).toBe("part2");
    // G8 settings sub-object preserved verbatim.
    expect(body.modules[0].settings).toEqual({
      questionTarget: { min: 10, target: 13 },
    });
    expect(body.modules[1].settings).toEqual({
      questionTarget: { min: 1, target: 1 },
      cueCardPool: [{ topic: "A book", bullets: ["author", "why"] }],
    });
  });

  it("returns empty modules array when Playbook.config.modules is missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "course-1",
      config: {},
    });
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, modules: [] });
  });

  it("substitutes empty {} for modules with no settings", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "course-1",
      config: {
        modules: [
          {
            id: "freeform",
            label: "Freeform",
            learnerSelectable: true,
            mode: "tutor",
            duration: "Student-led",
            scoringFired: "All four",
            voiceBandReadout: false,
            sessionTerminal: false,
            frequency: "once",
            outcomesPrimary: [],
            prerequisites: [],
          },
        ],
      },
    });
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.modules[0].settings).toEqual({});
  });
});

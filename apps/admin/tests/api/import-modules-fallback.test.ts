/**
 * Tests for the #495 Slice 4.1 fallback in
 * GET /api/courses/[courseId]/import-modules.
 *
 * Covers:
 * - Authored playbook → returns Playbook.config.modules (regression — the
 *   existing AuthoredModulesPanel admin path must keep working).
 * - AI-generated playbook (no Playbook.config.modules) → falls back to
 *   CurriculumModule rows joined via the playbook's primary curriculum
 *   and projects them into the AuthoredModule shape with source="generated".
 * - Empty (no authored modules, no curriculum modules) → returns
 *   { modules: [], source: null } so the picker can render the
 *   "curriculum is being prepared" empty state instead of bouncing.
 * - Non-existent playbook → 404 (regression).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────

const { mockPrisma, mockRequireAuth, mockIsAuthError } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: {
      findUnique: vi.fn(),
    },
    curriculum: {
      findFirst: vi.fn(),
    },
    curriculumModule: {
      findMany: vi.fn(),
    },
    contentQuestion: {
      groupBy: vi.fn(),
    },
    learningObjective: {
      findMany: vi.fn(),
    },
  },
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
  // #495 Slice 4.2: the route reads ROLE_LEVEL to decide whether to
  // enrich the response with per-module caller progress. Mirror lib/roles
  // so this fallback-focused suite stays green without depending on
  // @/lib/auth.
  ROLE_LEVEL: {
    DEMO: 0,
    VIEWER: 1,
    TESTER: 1,
    STUDENT: 1,
    SUPER_TESTER: 2,
    OPERATOR: 3,
    EDUCATOR: 3,
    ADMIN: 4,
    SUPERADMIN: 5,
  },
}));

// #495 Slice 4.3: recommendation helper is stubbed to "no recommendation"
// because this suite's auth fixture is a VIEWER with no callerId — the
// route bails out before calling the helper, but stubbing it keeps any
// future regression contained.
vi.mock("@/lib/curriculum/recommend-next-module", () => ({
  recommendNextModule: vi.fn().mockResolvedValue(null),
}));

// Import AFTER mocks
import { GET } from "@/app/api/courses/[courseId]/import-modules/route";

// ── Helpers ──────────────────────────────────────────────────────

function makeGetReq(): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/courses/playbook-1/import-modules",
  );
}

const params = Promise.resolve({ courseId: "playbook-1" });

const passingAuth = { session: { user: { id: "u1", role: "VIEWER" } } };

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockIsAuthError.mockReset();
  mockPrisma.playbook.findUnique.mockReset();
  mockPrisma.curriculum.findFirst.mockReset();
  mockPrisma.curriculumModule.findMany.mockReset();
  mockPrisma.contentQuestion.groupBy.mockReset();
  mockPrisma.learningObjective.findMany.mockReset();

  mockRequireAuth.mockResolvedValue(passingAuth);
  mockIsAuthError.mockReturnValue(false);

  // Default no-op responses for the secondary queries the GET handler
  // makes after picking its module list. Each test overrides as needed.
  mockPrisma.contentQuestion.groupBy.mockResolvedValue([]);
  mockPrisma.learningObjective.findMany.mockResolvedValue([]);
});

// ── Regression: authored path ────────────────────────────────────

describe("GET /api/courses/[courseId]/import-modules — authored regression (#495 Slice 4.1)", () => {
  it("returns Playbook.config.modules unchanged with source='authored'", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: {
        modulesAuthored: true,
        moduleSource: "authored",
        modules: [
          {
            id: "m1",
            label: "Module One",
            learnerSelectable: true,
            mode: "tutor",
            duration: "Student-led",
            scoringFired: "LR + GRA only",
            voiceBandReadout: false,
            sessionTerminal: false,
            frequency: "repeatable",
            outcomesPrimary: [],
            prerequisites: [],
          },
        ],
      },
    });

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0].id).toBe("m1");
    expect(body.modules[0].label).toBe("Module One");
    // Legacy AuthoredModulesPanel-facing field is preserved unchanged
    expect(body.moduleSource).toBe("authored");
    // New picker-facing field announces the path
    expect(body.source).toBe("authored");

    // Fallback path MUST NOT be touched when authored modules exist.
    expect(mockPrisma.curriculum.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.curriculumModule.findMany).not.toHaveBeenCalled();
  });
});

// ── New behaviour: generated fallback ────────────────────────────

describe("GET /api/courses/[courseId]/import-modules — generated fallback (#495 Slice 4.1)", () => {
  it("falls back to CurriculumModule rows when Playbook.config.modules is empty", async () => {
    // Playbook has no authored modules (AI-generated course shape).
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: { lessonPlanMode: "continuous" },
    });
    // resolveCurriculumIdForPlaybook → curriculum.findFirst
    mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "curr-1" });
    // Two CurriculumModule rows scoped to the resolved curriculum.
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      {
        slug: "mod-1",
        title: "Intro to Topic",
        description: "First module.",
        sortOrder: 0,
        estimatedDurationMinutes: 15,
        prerequisites: [],
      },
      {
        slug: "mod-2",
        title: "Deeper Dive",
        description: null,
        sortOrder: 1,
        estimatedDurationMinutes: null,
        prerequisites: ["mod-1"],
      },
    ]);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.source).toBe("generated");
    expect(body.modules).toHaveLength(2);

    // Mapped into AuthoredModule shape, slug → id.
    expect(body.modules[0]).toMatchObject({
      id: "mod-1",
      label: "Intro to Topic",
      learnerSelectable: true,
      mode: "tutor",
      frequency: "repeatable",
      duration: "15 min",
      voiceBandReadout: false,
      sessionTerminal: false,
      outcomesPrimary: [],
      prerequisites: [],
      position: 0,
    });

    // Missing duration falls back to "Student-led".
    expect(body.modules[1]).toMatchObject({
      id: "mod-2",
      label: "Deeper Dive",
      duration: "Student-led",
      prerequisites: ["mod-1"],
      position: 1,
    });

    // Legacy fields stay at their authored-path defaults so the admin
    // AuthoredModulesPanel can still tell the two apart.
    expect(body.modulesAuthored).toBeNull();
    expect(body.moduleSource).toBeNull();

    // Fallback path was actually used.
    expect(mockPrisma.curriculum.findFirst).toHaveBeenCalledOnce();
    expect(mockPrisma.curriculumModule.findMany).toHaveBeenCalledOnce();
    const findManyArgs = mockPrisma.curriculumModule.findMany.mock.calls[0][0];
    expect(findManyArgs.where).toMatchObject({
      curriculumId: "curr-1",
      isActive: true,
    });
    expect(findManyArgs.orderBy).toEqual({ sortOrder: "asc" });
  });
});

// ── Empty contract: no modules anywhere ──────────────────────────

describe("GET /api/courses/[courseId]/import-modules — empty curriculum (#495 Slice 4.1)", () => {
  it("returns { modules: [], source: null } when both paths are empty", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: {},
    });
    mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "curr-1" });
    mockPrisma.curriculumModule.findMany.mockResolvedValue([]);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.modules).toEqual([]);
    expect(body.source).toBeNull();
    expect(body.modulesAuthored).toBeNull();
  });

  it("returns { modules: [], source: null } when the playbook has no curriculum", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: "playbook-1",
      config: {},
    });
    // No curriculum attached at all.
    mockPrisma.curriculum.findFirst.mockResolvedValue(null);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.modules).toEqual([]);
    expect(body.source).toBeNull();
    // No need to fan out to curriculumModule.findMany when there is no curriculum.
    expect(mockPrisma.curriculumModule.findMany).not.toHaveBeenCalled();
  });
});

// ── Regression: 404 on missing playbook ──────────────────────────

describe("GET /api/courses/[courseId]/import-modules — missing playbook (#495 Slice 4.1)", () => {
  it("returns 404 when the playbook does not exist", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Course not found");

    // Fallback path must never run if the playbook itself is missing.
    expect(mockPrisma.curriculum.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.curriculumModule.findMany).not.toHaveBeenCalled();
  });

  it("returns the auth error when requireAuth fails", async () => {
    const errorResponse = NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
    mockRequireAuth.mockResolvedValue({ error: errorResponse });
    mockIsAuthError.mockReturnValue(true);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(401);
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
  });
});

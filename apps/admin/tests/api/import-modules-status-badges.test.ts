/**
 * Tests for the #495 Slice 4.2 progress-badge enrichment in
 * GET /api/courses/[courseId]/import-modules.
 *
 * Each `AuthoredModule` returned to the learner picker should carry an
 * optional `progress: { status, callCount }` field when the request has
 * a caller scope (STUDENT, or OPERATOR+ with `?callerId=`). Mapping is
 *   DB status COMPLETED   → presentational MASTERED
 *   DB status IN_PROGRESS → IN_PROGRESS
 *   DB status NOT_STARTED → NOT_STARTED
 *   no row found          → synthetic NOT_STARTED + callCount 0
 * Admins without a caller scope get NO `progress` field at all — the UI
 * suppresses the badge entirely so it never claims an unscoped state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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
    caller: {
      findFirst: vi.fn(),
    },
    callerModuleProgress: {
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
  // Mirror the constants from lib/roles so the route's role-gating works
  // without importing the real `@/lib/auth` chain in tests.
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

// Import AFTER mocks
import { GET } from "@/app/api/courses/[courseId]/import-modules/route";

// ── Helpers ──────────────────────────────────────────────────────

function makeGetReq(query?: string): NextRequest {
  const url = `http://localhost:3000/api/courses/playbook-1/import-modules${query ? `?${query}` : ""}`;
  return new NextRequest(url);
}

const params = Promise.resolve({ courseId: "playbook-1" });

const authoredPlaybook = {
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
      {
        id: "m2",
        label: "Module Two",
        learnerSelectable: true,
        mode: "examiner",
        duration: "20 min",
        scoringFired: "All four",
        voiceBandReadout: true,
        sessionTerminal: true,
        frequency: "once",
        outcomesPrimary: [],
        prerequisites: [],
      },
      {
        id: "m3",
        label: "Module Three",
        learnerSelectable: true,
        mode: "tutor",
        duration: "10 min",
        scoringFired: "All four",
        voiceBandReadout: false,
        sessionTerminal: false,
        frequency: "repeatable",
        outcomesPrimary: [],
        prerequisites: [],
      },
    ],
  },
};

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockIsAuthError.mockReset();
  mockPrisma.playbook.findUnique.mockReset();
  mockPrisma.curriculum.findFirst.mockReset();
  mockPrisma.curriculumModule.findMany.mockReset();
  mockPrisma.contentQuestion.groupBy.mockReset();
  mockPrisma.learningObjective.findMany.mockReset();
  mockPrisma.caller.findFirst.mockReset();
  mockPrisma.callerModuleProgress.findMany.mockReset();

  mockIsAuthError.mockReturnValue(false);
  mockPrisma.contentQuestion.groupBy.mockResolvedValue([]);
  mockPrisma.learningObjective.findMany.mockResolvedValue([]);
  // Fallback path should not be reached for an authored playbook, but
  // default to safe no-ops anyway.
  mockPrisma.curriculum.findFirst.mockResolvedValue(null);
  mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
});

// ── Case 1: STUDENT viewing own picker ───────────────────────────

describe("GET /api/courses/[courseId]/import-modules — STUDENT progress enrichment (#495 Slice 4.2)", () => {
  it("includes per-module progress with COMPLETED→MASTERED mapping", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "user-student-1", role: "STUDENT" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(authoredPlaybook);
    // Caller lookup keyed on the session user.
    mockPrisma.caller.findFirst.mockResolvedValue({ id: "caller-1" });
    // Two progress rows; m3 has no row → should synthesise NOT_STARTED.
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      { status: "COMPLETED", callCount: 5, module: { slug: "m1" } },
      { status: "IN_PROGRESS", callCount: 2, module: { slug: "m2" } },
    ]);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.modules).toHaveLength(3);

    // DB COMPLETED → presentational MASTERED, callCount preserved.
    expect(body.modules[0].progress).toEqual({
      status: "MASTERED",
      callCount: 5,
    });
    expect(body.modules[1].progress).toEqual({
      status: "IN_PROGRESS",
      callCount: 2,
    });
    // No row for m3 → synthetic NOT_STARTED row.
    expect(body.modules[2].progress).toEqual({
      status: "NOT_STARTED",
      callCount: 0,
    });

    // STUDENT path resolves the caller via session.userId.
    expect(mockPrisma.caller.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-student-1", role: "LEARNER" },
      select: { id: true },
    });
    // Progress query is scoped to this Playbook's curricula.
    const progressArgs = mockPrisma.callerModuleProgress.findMany.mock.calls[0][0];
    expect(progressArgs.where).toMatchObject({
      callerId: "caller-1",
      module: { curriculum: { playbookId: "playbook-1" } },
    });
  });
});

// ── Case 2: OPERATOR with ?callerId= ─────────────────────────────

describe("GET /api/courses/[courseId]/import-modules — OPERATOR with callerId (#495 Slice 4.2)", () => {
  it("enriches progress for the specified caller", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "admin-user-1", role: "OPERATOR" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(authoredPlaybook);
    // OPERATOR path validates the explicit callerId.
    mockPrisma.caller.findFirst.mockResolvedValue({ id: "target-caller" });
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      { status: "COMPLETED", callCount: 3, module: { slug: "m1" } },
    ]);

    const res = await GET(makeGetReq("callerId=target-caller"), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.modules[0].progress).toEqual({
      status: "MASTERED",
      callCount: 3,
    });
    // Other modules synthesise NOT_STARTED with callCount 0.
    expect(body.modules[1].progress).toEqual({
      status: "NOT_STARTED",
      callCount: 0,
    });
    expect(body.modules[2].progress).toEqual({
      status: "NOT_STARTED",
      callCount: 0,
    });

    // Caller lookup keys on the URL param, not session.userId.
    expect(mockPrisma.caller.findFirst).toHaveBeenCalledWith({
      where: { id: "target-caller", role: "LEARNER" },
      select: { id: true },
    });
    const progressArgs = mockPrisma.callerModuleProgress.findMany.mock.calls[0][0];
    expect(progressArgs.where).toMatchObject({
      callerId: "target-caller",
      module: { curriculum: { playbookId: "playbook-1" } },
    });
  });
});

// ── Case 3: OPERATOR without callerId — no enrichment ────────────

describe("GET /api/courses/[courseId]/import-modules — OPERATOR without callerId (#495 Slice 4.2)", () => {
  it("omits progress entirely (no caller scope)", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "admin-user-1", role: "OPERATOR" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(authoredPlaybook);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.modules).toHaveLength(3);
    for (const m of body.modules) {
      expect(m.progress).toBeUndefined();
    }
    // Neither caller nor progress queries should fire — bail out early.
    expect(mockPrisma.caller.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.callerModuleProgress.findMany).not.toHaveBeenCalled();
  });
});

// ── Case 4: caller with zero progress rows ───────────────────────

describe("GET /api/courses/[courseId]/import-modules — empty progress (#495 Slice 4.2)", () => {
  it("synthesises NOT_STARTED for every module when the caller has no rows", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "user-student-2", role: "STUDENT" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(authoredPlaybook);
    mockPrisma.caller.findFirst.mockResolvedValue({ id: "caller-cold" });
    // Cold-start — no progress rows yet.
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.modules).toHaveLength(3);
    for (const m of body.modules) {
      expect(m.progress).toEqual({
        status: "NOT_STARTED",
        callCount: 0,
      });
    }
  });
});

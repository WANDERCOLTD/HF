/**
 * Tests for the #495 Slice 4.3 "Recommended next" overlay in
 * GET /api/courses/[courseId]/import-modules.
 *
 * The route adds two top-level fields keyed by the same caller scope used
 * for progress enrichment (#495 Slice 4.2):
 *   - `recommendedModuleId: string | null`
 *   - `recommendedReason:   string | null`
 *
 * Values come from `recommendNextModule()` (#494 Slice 2.5). The helper is
 * mocked here so the suite stays focused on the route's wiring: caller
 * resolution → curriculum lookup → invoke helper → slug-to-id projection.
 *
 * Four cases cover the surface area:
 *   1. Linear curriculum, M1 mastered → reco = M2, reason "next-in-sequence".
 *   2. All mastered → helper returns null → reco = null.
 *   3. Admin without `?callerId=` → no caller scope → reco = null + helper
 *      never invoked.
 *   4. `strictPrerequisites=true`, M2's prereqs unmet → reco = M1.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────

const {
  mockPrisma,
  mockRequireAuth,
  mockIsAuthError,
  mockRecommendNextModule,
} = vi.hoisted(() => ({
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
  mockRecommendNextModule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
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

vi.mock("@/lib/curriculum/recommend-next-module", () => ({
  recommendNextModule: (...args: unknown[]) => mockRecommendNextModule(...args),
}));

// Import AFTER mocks
import { GET } from "@/app/api/courses/[courseId]/import-modules/route";

// ── Helpers ──────────────────────────────────────────────────────

function makeGetReq(query?: string): NextRequest {
  const url = `http://localhost:3000/api/courses/playbook-1/import-modules${query ? `?${query}` : ""}`;
  return new NextRequest(url);
}

const params = Promise.resolve({ courseId: "playbook-1" });

// Three linear modules — slugs match AuthoredModule.id by convention so the
// route's slug-to-id mapping is exercised against the authored shape.
const linearPlaybook = {
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
        mode: "tutor",
        duration: "20 min",
        scoringFired: "All four",
        voiceBandReadout: false,
        sessionTerminal: false,
        frequency: "repeatable",
        outcomesPrimary: [],
        prerequisites: ["m1"],
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
        prerequisites: ["m2"],
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
  mockRecommendNextModule.mockReset();

  mockIsAuthError.mockReturnValue(false);
  mockPrisma.contentQuestion.groupBy.mockResolvedValue([]);
  mockPrisma.learningObjective.findMany.mockResolvedValue([]);
  // Default curriculum resolution returns a real id so recommendNextModule
  // gets invoked. Individual cases override as needed.
  mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "curr-1" });
  mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
  mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);
});

// ── Case 1: linear curriculum, M1 mastered → reco = M2 ───────────

describe("GET /api/courses/[courseId]/import-modules — linear next-in-sequence (#495 Slice 4.3)", () => {
  it("returns recommendedModuleId=M2 and recommendedReason=next-in-sequence", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "user-student-1", role: "STUDENT" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(linearPlaybook);
    mockPrisma.caller.findFirst.mockResolvedValue({ id: "caller-1" });
    // M1 mastered, M2/M3 not started.
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      { status: "COMPLETED", callCount: 5, module: { slug: "m1" } },
    ]);
    // Helper returns the M2 row — slug used as picker id.
    mockRecommendNextModule.mockResolvedValue({
      moduleId: "curr-mod-m2",
      slug: "m2",
      title: "Module Two",
      reason: "next-in-sequence",
    });

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.recommendedModuleId).toBe("m2");
    expect(body.recommendedReason).toBe("next-in-sequence");

    // Helper invoked with the resolved caller + curriculum + config.
    expect(mockRecommendNextModule).toHaveBeenCalledOnce();
    const arg = mockRecommendNextModule.mock.calls[0][0];
    expect(arg.callerId).toBe("caller-1");
    expect(arg.curriculumId).toBe("curr-1");
    expect(arg.playbookConfig).toBeDefined();
  });
});

// ── Case 2: all mastered → reco = null ───────────────────────────

describe("GET /api/courses/[courseId]/import-modules — all mastered (#495 Slice 4.3)", () => {
  it("returns recommendedModuleId=null when recommendNextModule returns null", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "user-student-2", role: "STUDENT" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(linearPlaybook);
    mockPrisma.caller.findFirst.mockResolvedValue({ id: "caller-2" });
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      { status: "COMPLETED", callCount: 5, module: { slug: "m1" } },
      { status: "COMPLETED", callCount: 4, module: { slug: "m2" } },
      { status: "COMPLETED", callCount: 6, module: { slug: "m3" } },
    ]);
    // Helper returns null — every module already mastered.
    mockRecommendNextModule.mockResolvedValue(null);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.recommendedModuleId).toBeNull();
    expect(body.recommendedReason).toBeNull();
    // Helper still invoked — the null branch is the helper's decision,
    // not a short-circuit in the route.
    expect(mockRecommendNextModule).toHaveBeenCalledOnce();
  });
});

// ── Case 3: admin without ?callerId= → no scope, no reco ─────────

describe("GET /api/courses/[courseId]/import-modules — admin without callerId (#495 Slice 4.3)", () => {
  it("returns recommendedModuleId=null and never invokes recommendNextModule", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "admin-user-1", role: "OPERATOR" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(linearPlaybook);

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.recommendedModuleId).toBeNull();
    expect(body.recommendedReason).toBeNull();
    // No caller scope ⇒ no curriculum lookup, no helper call. The route
    // bails before invoking either.
    expect(mockRecommendNextModule).not.toHaveBeenCalled();
    expect(mockPrisma.caller.findFirst).not.toHaveBeenCalled();
  });
});

// ── Case 4: strictPrerequisites=true, M2 prereqs unmet → reco = M1 ─

describe("GET /api/courses/[courseId]/import-modules — strict prereqs (#495 Slice 4.3)", () => {
  it("recommends M1 when strict mode would otherwise gate M2", async () => {
    const strictPlaybook = {
      id: "playbook-1",
      config: {
        ...linearPlaybook.config,
        strictPrerequisites: true,
      },
    };
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "user-student-3", role: "STUDENT" } },
    });
    mockPrisma.playbook.findUnique.mockResolvedValue(strictPlaybook);
    mockPrisma.caller.findFirst.mockResolvedValue({ id: "caller-3" });
    // Cold-start — nothing mastered yet, so M2's "m1" prereq is unmet.
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);
    // Helper picks M1 — the lowest sortOrder with all prereqs satisfied
    // (trivially: none). The route forwards the slug.
    mockRecommendNextModule.mockResolvedValue({
      moduleId: "curr-mod-m1",
      slug: "m1",
      title: "Module One",
      reason: "next-in-sequence",
    });

    const res = await GET(makeGetReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.recommendedModuleId).toBe("m1");
    expect(body.recommendedReason).toBe("next-in-sequence");

    // The route passes the full config through so the helper sees
    // strictPrerequisites=true and applies the right policy.
    expect(mockRecommendNextModule).toHaveBeenCalledOnce();
    const arg = mockRecommendNextModule.mock.calls[0][0];
    expect(arg.playbookConfig?.strictPrerequisites).toBe(true);
  });
});

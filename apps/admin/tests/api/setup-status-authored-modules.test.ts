/**
 * Tests for the authored-modules branch of GET /api/courses/[courseId]/setup-status
 * (PR4 of #236).
 *
 * The change: continuous courses are no longer auto-marked as
 * `lessonPlanBuilt = true` when `modulesAuthored === true`. They must have at
 * least one parsed module AND no blocking errors. Authors who haven't
 * imported their catalogue yet keep the stage open.
 *
 * The pre-existing branches (no modulesAuthored / structured course / no
 * playbook) keep their behaviour. We test the new logic directly via the
 * route handler with mocked prisma.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockPrisma, mockRequireAuth, mockIsAuthError } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: {
      findUnique: vi.fn(),
    },
    playbookSubject: {
      findMany: vi.fn(),
    },
    curriculum: {
      findFirst: vi.fn(),
    },
    composedPrompt: {
      findFirst: vi.fn(),
    },
    // #444 — setup-status now counts unstrategised Goal rows.
    goal: {
      count: vi.fn(),
    },
    // #884 S0 — Foundation-stage signals (hasSources / hasAssertions).
    subjectSource: {
      findFirst: vi.fn(),
    },
    contentAssertion: {
      findFirst: vi.fn(),
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
}));

import { GET } from "@/app/api/courses/[courseId]/setup-status/route";

const params = Promise.resolve({ courseId: "playbook-1" });

function makeReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/courses/playbook-1/setup-status");
}

const passingAuth = { session: { user: { id: "u1", role: "VIEWER" } } };

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockIsAuthError.mockReset();
  mockPrisma.playbook.findUnique.mockReset();
  mockPrisma.playbookSubject.findMany.mockReset();
  mockPrisma.curriculum.findFirst.mockReset();
  mockPrisma.composedPrompt.findFirst.mockReset();
  mockPrisma.goal.count.mockReset();
  mockPrisma.subjectSource.findFirst.mockReset();
  mockPrisma.contentAssertion.findFirst.mockReset();

  mockRequireAuth.mockResolvedValue(passingAuth);
  mockIsAuthError.mockReturnValue(false);

  // Defaults that don't affect the lessonPlan branch — onboarding "configured"
  // varies per test via the playbook.findUnique mock.
  mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);
  // #444 — default: 0 unstrategised goals (course is strategy-clean).
  mockPrisma.goal.count.mockResolvedValue(0);
  // #884 S0 — default: course has subjects but no sources/assertions yet
  // (fresh-create state). Individual tests override.
  mockPrisma.playbookSubject.findMany.mockResolvedValue([]);
  mockPrisma.subjectSource.findFirst.mockResolvedValue(null);
  mockPrisma.contentAssertion.findFirst.mockResolvedValue(null);
});

function basePlaybook(configOverrides: Record<string, unknown> = {}) {
  return {
    id: "playbook-1",
    config: { lessonPlanMode: "continuous", ...configOverrides },
    domain: {
      onboardingIdentitySpecId: "id-1",
      onboardingFlowPhases: { phases: [] },
    },
    domainId: "domain-1",
  };
}

describe("setup-status — authored-modules branch (continuous course)", () => {
  it("keeps lessonPlanBuilt=true when modulesAuthored is unset (existing behaviour)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(basePlaybook());

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.lessonPlanBuilt).toBe(true);
  });

  it("keeps lessonPlanBuilt=true when modulesAuthored=false (author opted out)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(
      basePlaybook({ modulesAuthored: false, moduleSource: "derived" }),
    );

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.lessonPlanBuilt).toBe(true);
  });

  it("blocks lessonPlanBuilt when modulesAuthored=true but no modules imported yet", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(
      basePlaybook({
        modulesAuthored: true,
        moduleSource: "authored",
        modules: [],
      }),
    );

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.lessonPlanBuilt).toBe(false);
  });

  it("blocks lessonPlanBuilt when modules exist but include error-severity warnings", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(
      basePlaybook({
        modulesAuthored: true,
        moduleSource: "authored",
        modules: [{ id: "m1" }],
        validationWarnings: [
          { code: "MODULE_ID_INVALID", message: "x", severity: "error" },
        ],
      }),
    );

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.lessonPlanBuilt).toBe(false);
  });

  it("allows lessonPlanBuilt when modules exist and only warning-severity entries are present", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(
      basePlaybook({
        modulesAuthored: true,
        moduleSource: "authored",
        modules: [{ id: "m1" }, { id: "m2" }],
        validationWarnings: [
          { code: "MODULE_FIELD_DEFAULTED", message: "x", severity: "warning" },
        ],
      }),
    );

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.lessonPlanBuilt).toBe(true);
  });

  it("allows lessonPlanBuilt when modules exist and no warnings at all", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(
      basePlaybook({
        modulesAuthored: true,
        moduleSource: "authored",
        modules: [{ id: "m1" }],
        validationWarnings: [],
      }),
    );

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.lessonPlanBuilt).toBe(true);
  });
});

describe("setup-status — activeCurriculumMode (issue #418)", () => {
  it("returns 'authored' when modulesAuthored=true", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(
      basePlaybook({
        modulesAuthored: true,
        moduleSource: "authored",
        modules: [{ id: "m1" }],
      }),
    );

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.activeCurriculumMode).toBe("authored");
  });

  it("returns 'derived' when modulesAuthored=false (author opted out)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(
      basePlaybook({ modulesAuthored: false, moduleSource: "derived" }),
    );

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.activeCurriculumMode).toBe("derived");
  });

  it("returns 'derived' when modulesAuthored is unset (default behaviour)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(basePlaybook());

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();
    expect(body.activeCurriculumMode).toBe("derived");
  });
});

describe("setup-status — auth and 404 still behave (regression)", () => {
  it("returns the auth error when requireAuth fails", async () => {
    const errorResponse = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    mockRequireAuth.mockResolvedValue(errorResponse);
    mockIsAuthError.mockReturnValue(true);

    const res = (await GET(makeReq(), { params })) as NextResponse;
    expect(res.status).toBe(401);
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the playbook does not exist", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = (await GET(makeReq(), { params })) as NextResponse;
    expect(res.status).toBe(404);
  });
});

// =====================================================
// #884 S0 — Foundation-stage signals (hasSources / hasAssertions)
// =====================================================

describe("setup-status — #884 S0 Foundation-stage signals", () => {
  it("returns hasSources=false, hasAssertions=false for a fresh course with no subjects", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(basePlaybook());
    mockPrisma.playbookSubject.findMany.mockResolvedValue([]);

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();

    expect(body.hasSources).toBe(false);
    expect(body.hasAssertions).toBe(false);
    // Sanity: lying-bug guard — `allCriticalPass` may still be true when
    // onboarding + lesson plan pass, but the client uses hasSources/
    // hasAssertions to override stage 6. The server intentionally does NOT
    // fold Foundation into allCriticalPass (full contract refactor — S1/S2).
    expect(body.allCriticalPass).toBe(true);
  });

  it("returns hasSources=true, hasAssertions=false while extraction is still running", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(basePlaybook());
    mockPrisma.playbookSubject.findMany.mockResolvedValue([{ subjectId: "sub-1" }]);
    mockPrisma.subjectSource.findFirst.mockResolvedValue({ sourceId: "src-1" });
    mockPrisma.contentAssertion.findFirst.mockResolvedValue(null);

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();

    expect(body.hasSources).toBe(true);
    expect(body.hasAssertions).toBe(false);
  });

  it("returns hasSources=true, hasAssertions=true for a fully-extracted course", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(basePlaybook());
    mockPrisma.playbookSubject.findMany.mockResolvedValue([{ subjectId: "sub-1" }]);
    mockPrisma.subjectSource.findFirst.mockResolvedValue({ sourceId: "src-1" });
    mockPrisma.contentAssertion.findFirst.mockResolvedValue({ id: "a-1" });

    const res = (await GET(makeReq(), { params })) as NextResponse;
    const body = await res.json();

    expect(body.hasSources).toBe(true);
    expect(body.hasAssertions).toBe(true);
  });

  it("scopes by playbook (not domain) — slug-scope invariant #407", async () => {
    // Two subjects linked to this playbook
    mockPrisma.playbook.findUnique.mockResolvedValue(basePlaybook());
    mockPrisma.playbookSubject.findMany.mockResolvedValue([
      { subjectId: "sub-A" },
      { subjectId: "sub-B" },
    ]);
    mockPrisma.subjectSource.findFirst.mockResolvedValue({ sourceId: "src-1" });
    mockPrisma.contentAssertion.findFirst.mockResolvedValue({ id: "a-1" });

    await GET(makeReq(), { params });

    // playbookSubject query must filter on this playbook only
    expect(mockPrisma.playbookSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { playbookId: "playbook-1" },
      }),
    );
    // subjectSource query must use the resolved subject IDs (not domain or other heuristic)
    expect(mockPrisma.subjectSource.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectId: { in: ["sub-A", "sub-B"] } },
      }),
    );
  });
});

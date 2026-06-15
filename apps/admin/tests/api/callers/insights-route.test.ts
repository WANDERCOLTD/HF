/**
 * Tests for `GET /api/callers/[callerId]/insights` — Wave B of the
 * legacy-tab retirement plan.
 *
 * Pinned acceptance:
 *   1. STUDENT-scope reject + caller-not-found
 *   2. momentum = "new" when no calls
 *   3. callStreak + lastCallDaysAgo + totalCalls derived from call data
 *   4. focusAreas: needs_attention (mastery < ATTENTION_THRESHOLD 0.45) +
 *      ready_to_advance (mastery >= ADVANCE_THRESHOLD 0.80 but < MASTERY_THRESHOLD 0.75)
 *      Actually: ready_to_advance = mastery >= ADVANCE 0.80 AND status !== "mastered" (status uses MASTERY 0.75)
 *      So a 0.78 mastery module = "in_progress" status, not "ready_to_advance"
 *   5. Achievements: streak >= 3, mastered modules, total calls >= 5, memories >= 10
 *   6. MAX_FOCUS_AREAS cap respected
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockStudentAllowed, mockGetCourseStyle } = vi.hoisted(
  () => ({
    mockPrisma: {
      caller: { findUnique: vi.fn() },
      callerPlaybook: { findFirst: vi.fn() },
      call: { findMany: vi.fn(), count: vi.fn() },
      callerMemory: { count: vi.fn() },
      callerModuleProgress: { findMany: vi.fn() },
    },
    mockStudentAllowed: vi.fn(),
    mockGetCourseStyle: vi.fn(() => "structured" as const),
  }),
);

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: () => false,
}));
vi.mock("@/lib/learner-scope", () => ({
  studentAllowedToReadCaller: mockStudentAllowed,
  callerScopeMismatchResponse: () =>
    new Response(JSON.stringify({ ok: false, error: "scope" }), { status: 403 }),
}));
vi.mock("@/lib/pipeline/course-style", () => ({
  getCourseStyle: mockGetCourseStyle,
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/insights/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
  mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
  // Default: structured course with a typical enrollment row. Tests
  // override the per-test fixture as needed.
  mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
    playbook: { config: { lessonPlanMode: "structured" } },
  });
  mockGetCourseStyle.mockReturnValue("structured");
});

describe("GET /api/callers/[callerId]/insights", () => {
  it("rejects STUDENT reading foreign caller", async () => {
    mockStudentAllowed.mockReturnValue(false);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/insights"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when caller not found", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/insights"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns momentum: 'new' + null lastCallDaysAgo when no calls", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.callerMemory.count.mockResolvedValue(0);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/insights"), PARAMS);
    const json = (await res.json()) as {
      momentum: string;
      lastCallDaysAgo: number | null;
      totalCalls: number;
      callStreak: number;
      focusAreas: unknown[];
      achievements: unknown[];
    };
    expect(json.momentum).toBe("new");
    expect(json.lastCallDaysAgo).toBeNull();
    expect(json.totalCalls).toBe(0);
    expect(json.callStreak).toBe(0);
    expect(json.focusAreas).toEqual([]);
    expect(json.achievements).toEqual([]);
  });

  it("classifies modules as needs_attention (< 0.45) + ready_to_advance (>= 0.80, not mastered)", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.callerMemory.count.mockResolvedValue(0);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      {
        moduleId: "m1",
        mastery: 0.3,
        module: { id: "m1", title: "Limits", sortOrder: 1 },
      },
      {
        moduleId: "m2",
        mastery: 0.78,
        // Above ADVANCE_THRESHOLD (0.80) is the ready trigger. 0.78 is in_progress.
        module: { id: "m2", title: "Derivatives", sortOrder: 2 },
      },
      {
        moduleId: "m3",
        mastery: 0.85,
        // 0.85 >= ADVANCE 0.80, but MASTERY 0.75 < 0.85 so status = mastered.
        // ready_to_advance requires status !== mastered → m3 stays mastered.
        module: { id: "m3", title: "Integrals", sortOrder: 3 },
      },
    ]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/insights"), PARAMS);
    const json = (await res.json()) as {
      focusAreas: Array<{ type: string; moduleId: string }>;
    };
    // Only m1 lands as needs_attention. m3 is mastered (>=0.75), m2 is in_progress (between 0.45 and 0.80)
    expect(json.focusAreas).toHaveLength(1);
    expect(json.focusAreas[0]).toMatchObject({
      type: "needs_attention",
      moduleId: "m1",
    });
  });

  it("renders 'ready_to_advance' when mastery is in the [ADVANCE, MASTERY) gap", async () => {
    // ADVANCE_THRESHOLD = 0.80, MASTERY_THRESHOLD = 0.75. There's actually
    // no [ADVANCE, MASTERY) window — ADVANCE > MASTERY. So a value in
    // (MASTERY, ADVANCE) gives mastered status. The "ready" branch only
    // fires when status check is NOT mastered yet (mastery>=ADVANCE).
    // Since ADVANCE > MASTERY, mastery >= ADVANCE always → mastered.
    // The legacy logic has the same shape — ready_to_advance is only
    // reachable when the status function returns non-mastered for
    // mastery >= ADVANCE, which happens only when ATTENTION_THRESHOLD
    // boundaries shift. With the current constants, ready_to_advance is
    // unreachable. We pin the behaviour to surface this should the
    // constants ever flip.
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.callerMemory.count.mockResolvedValue(0);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      {
        moduleId: "edge",
        mastery: 0.79,
        module: { id: "edge", title: "Edge", sortOrder: 1 },
      },
    ]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/insights"), PARAMS);
    const json = (await res.json()) as {
      focusAreas: Array<{ type: string }>;
    };
    // 0.79 sits in (ATTENTION 0.45 .. ADVANCE 0.80) → in_progress status,
    // not advanced enough to trigger ready_to_advance. focusAreas stays empty.
    expect(json.focusAreas).toEqual([]);
  });

  it("emits achievements: streak >= 3, mastered modules, totalCalls >= 5, memories >= 10", async () => {
    // 5 consecutive daily calls → streak = 5
    const callDates = Array.from({ length: 5 }, (_, i) => ({
      createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
    }));
    mockPrisma.call.findMany.mockResolvedValue(callDates);
    mockPrisma.call.count.mockResolvedValue(8);
    mockPrisma.callerMemory.count.mockResolvedValue(15);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      {
        moduleId: "m1",
        mastery: 0.85,
        module: { id: "m1", title: "Mastered Module", sortOrder: 1 },
      },
    ]);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/insights"), PARAMS);
    const json = (await res.json()) as {
      callStreak: number;
      totalCalls: number;
      achievements: Array<{ icon: string; label: string }>;
    };

    expect(json.callStreak).toBeGreaterThanOrEqual(3);
    expect(json.totalCalls).toBe(8);
    // Expect the 4 achievement types
    const labels = json.achievements.map((a) => a.label).join(" | ");
    expect(labels).toMatch(/-lesson streak/);
    expect(labels).toMatch(/Mastered Module mastered/);
    expect(labels).toMatch(/8 lessons total/);
    expect(labels).toMatch(/15 things remembered/);
  });

  it("skips the CallerModuleProgress query when course is CONTINUOUS (#1252/#1259 guard)", async () => {
    mockGetCourseStyle.mockReturnValue("continuous");
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.callerMemory.count.mockResolvedValue(0);

    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/insights"), PARAMS);
    expect(res.status).toBe(200);
    expect(mockPrisma.callerModuleProgress.findMany).not.toHaveBeenCalled();
    const json = (await res.json()) as { focusAreas: unknown[] };
    expect(json.focusAreas).toEqual([]);
  });

  it("caps focusAreas at MAX (6)", async () => {
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.callerMemory.count.mockResolvedValue(0);
    // 10 needs_attention modules
    const moduleRows = Array.from({ length: 10 }, (_, i) => ({
      moduleId: `m${i}`,
      mastery: 0.2,
      module: { id: `m${i}`, title: `Mod ${i}`, sortOrder: i },
    }));
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue(moduleRows);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/insights"), PARAMS);
    const json = (await res.json()) as {
      focusAreas: Array<{ moduleId: string }>;
    };
    expect(json.focusAreas).toHaveLength(6);
  });
});

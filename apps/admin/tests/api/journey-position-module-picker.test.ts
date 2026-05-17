/**
 * Tests for /api/student/journey-position — picker routing (#242 Slice 4).
 *
 * Mocks prisma so the route can be exercised without a real database.
 * Two scenarios:
 *   1. Course with `modulesAuthored: true` → nextStop.type === "module_picker"
 *      and redirect points at /x/student/{playbookId}/modules with a returnTo
 *      that includes the caller's specific SIM URL.
 *   2. Course without modulesAuthored → legacy behaviour preserved
 *      (type === "continuous" or "teaching", redirect === "/x/sim").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockRequireStudentOrAdmin } = vi.hoisted(() => ({
  mockPrisma: {
    callerPlaybook: { findFirst: vi.fn() },
    onboardingSession: { findFirst: vi.fn() },
    callerAttribute: { findMany: vi.fn() },
    call: { count: vi.fn() },
  },
  mockRequireStudentOrAdmin: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// Route imports `Prisma` from @prisma/client for Prisma.JsonNull — pass-through
// the real export so the JSON-null sentinel works under mock.
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual };
});

vi.mock("@/lib/student-access", () => ({
  requireStudentOrAdmin: (...args: unknown[]) => mockRequireStudentOrAdmin(...args),
  isStudentAuthError: (result: unknown): boolean =>
    result != null && typeof result === "object" && "error" in (result as object),
}));

// getTpProgressSummary is called dynamically via import() inside the route.
// Mock the module so the dynamic import returns our stub.
vi.mock("@/lib/curriculum/track-progress", () => ({
  getTpProgressSummary: vi.fn().mockResolvedValue({
    totalTps: 4,
    mastered: 1,
    inProgress: 1,
    notStarted: 2,
  }),
}));

// Session-flow resolver: stub to return no fired stops so the test exercises
// the LEARNING / TEACHING path. The picker intercept lives there.
vi.mock("@/lib/session-flow/resolver", () => ({
  resolveSessionFlow: vi.fn().mockReturnValue({ stops: [] }),
}));
vi.mock("@/lib/session-flow/journey-stop-runner", () => ({
  evaluateStops: vi.fn().mockReturnValue({ fire: false }),
}));

// Feature-flag config — leave default (resolver-enabled) on; the stubs above
// neutralise its effect so we test the LEARNING fallthrough.
vi.mock("@/lib/config", () => ({
  config: { features: { sessionFlowResolverEnabled: true } },
}));

// Import after mocks
import { GET } from "@/app/api/student/journey-position/route";

const CALLER_ID = "caller-1";
const PLAYBOOK_ID = "playbook-1";

function makeReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/student/journey-position");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireStudentOrAdmin.mockResolvedValue({
    callerId: CALLER_ID,
    cohortGroupId: "cg-1",
    cohortGroupIds: ["cg-1"],
    institutionId: null,
    session: { user: { id: "u1", role: "STUDENT" } },
  });
  mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
  mockPrisma.call.count.mockResolvedValue(2); // > 0 → past onboarding
  mockPrisma.onboardingSession.findFirst.mockResolvedValue({
    isComplete: true,
    wasSkipped: false,
  });
});

describe("journey-position — #242 Slice 4 picker routing", () => {
  it("continuous + modulesAuthored=true → routes to picker with caller-specific returnTo", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: PLAYBOOK_ID,
        config: {
          lessonPlanMode: "continuous",
          modulesAuthored: true,
        },
        curricula: [
          { id: "curr-1", slug: "ielts-v22", deliveryConfig: { mode: "continuous" } },
        ],
      },
    });

    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.nextStop.type).toBe("module_picker");
    expect(body.nextStop.redirect).toBe(
      `/x/student/${PLAYBOOK_ID}/modules?returnTo=${encodeURIComponent(`/x/sim/${CALLER_ID}`)}`,
    );
  });

  it("continuous + no modulesAuthored → legacy continuous redirect preserved", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: PLAYBOOK_ID,
        config: { lessonPlanMode: "continuous" },
        curricula: [
          { id: "curr-1", slug: "legacy-v1", deliveryConfig: { mode: "continuous" } },
        ],
      },
    });

    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.nextStop.type).toBe("continuous");
    expect(body.nextStop.redirect).toBe("/x/sim");
  });

  it("continuous + modulesAuthored=false → legacy continuous redirect preserved", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: PLAYBOOK_ID,
        config: { lessonPlanMode: "continuous", modulesAuthored: false },
        curricula: [
          { id: "curr-1", slug: "opted-out-v1", deliveryConfig: { mode: "continuous" } },
        ],
      },
    });

    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.nextStop.type).toBe("continuous");
    expect(body.nextStop.redirect).toBe("/x/sim");
  });

  it("structured + modulesAuthored=true + onboarding done → routes to picker", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: PLAYBOOK_ID,
        config: {
          // No lessonPlanMode → structured/default branch
          modulesAuthored: true,
        },
        curricula: [
          { id: "curr-1", slug: "structured-v1", deliveryConfig: null },
        ],
      },
    });

    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.nextStop.type).toBe("module_picker");
    expect(body.nextStop.redirect).toBe(
      `/x/student/${PLAYBOOK_ID}/modules?returnTo=${encodeURIComponent(`/x/sim/${CALLER_ID}`)}`,
    );
  });

  it("structured + modulesAuthored=true + onboarding NOT done → onboarding still gates picker", async () => {
    mockPrisma.onboardingSession.findFirst.mockResolvedValue({
      isComplete: false,
      wasSkipped: false,
    });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: PLAYBOOK_ID,
        config: { modulesAuthored: true },
        curricula: [
          { id: "curr-1", slug: "structured-v1", deliveryConfig: null },
        ],
      },
    });

    const res = await GET(makeReq());
    const body = await res.json();

    // Picker is downstream of onboarding — onboarding fires first
    expect(body.nextStop.type).toBe("onboarding");
    expect(body.nextStop.redirect).toBe("/x/sim");
  });

  it("continuous + mastery 100% + modulesAuthored=true → COMPLETE wins over picker", async () => {
    const trackProgress = await import("@/lib/curriculum/track-progress");
    vi.mocked(trackProgress.getTpProgressSummary).mockResolvedValueOnce({
      totalTps: 4,
      mastered: 4,
      inProgress: 0,
      notStarted: 0,
    });

    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: PLAYBOOK_ID,
        config: { lessonPlanMode: "continuous", modulesAuthored: true },
        curricula: [
          { id: "curr-1", slug: "ielts-v22", deliveryConfig: { mode: "continuous" } },
        ],
      },
    });

    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.nextStop.type).toBe("complete");
    expect(body.nextStop.redirect).toBe("/x/student/progress");
  });

  it("no enrollment → returns complete (unchanged)", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.nextStop.type).toBe("complete");
    expect(body.nextStop.redirect).toBe("/x/student/progress");
  });
});

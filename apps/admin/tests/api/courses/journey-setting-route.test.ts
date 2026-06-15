/**
 * Tests for `PATCH /api/courses/[courseId]/journey-setting` — Phase 2A
 * of epic #1675 (story #1687).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: vi.fn(async () => ({
    playbook: {},
    composeAffectingChanged: true,
    timestampBumped: true,
    fanoutScope: "none",
  })),
}));
vi.mock("@/lib/compose/section-staleness", () => ({
  bumpSectionHash: vi.fn(async () => ({ skipped: false })),
}));

const PARAMS = { params: Promise.resolve({ courseId: "course-1" }) };

async function loadRoute() {
  return import("@/app/api/courses/[courseId]/journey-setting/route");
}

function makeReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://x", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/courses/[courseId]/journey-setting — Phase 2 #1687", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.playbook.findFirst.mockResolvedValue({ id: "course-1" });
  });

  it("403s the auth gate when OPERATOR not granted", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    } as never);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "welcomeMessage", value: "x" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(403);
  });

  it("400s on malformed body", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(makeReq({}) as never, PARAMS as never);
    expect(res.status).toBe(400);
  });

  it("400s on unknown settingId", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "not_real", value: 1 }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN_SETTING");
  });

  it("404s when course not found", async () => {
    mockPrisma.playbook.findFirst.mockResolvedValueOnce(null);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "welcomeMessage", value: "hi" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(404);
  });

  it("happy path: writes config + bumps affected sections", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "welcomeMessage", value: "hello" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.effectiveValue).toBe("hello");
    expect(body.bumpedSections).toContain("welcome");
  });

  it("autoEnableLinks fan-out: setting firstCallMode=baseline_assessment enables preTestStop", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "firstCallMode", value: "baseline_assessment" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoEnabled).toContainEqual(
      expect.objectContaining({ targetId: "preTestStop", enforce: true }),
    );
  });

  it("autoEnableLinks does NOT fire when whenValue does not match", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "firstCallMode", value: "teach_immediately" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoEnabled).toEqual([]);
  });

  it("rejects operator-only setting when x-pipeline-actor header present", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq(
        { settingId: "rewardStrategy", value: "mastery" },
        { "x-pipeline-actor": "EXTRACT" },
      ) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("OPERATOR_ONLY");
  });

  it("501s when storage root is domain (not yet wired)", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "intakeSpecId", value: "spec-x" }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe("STORAGE_ROOT_NOT_SUPPORTED");
  });

  it("501s when storage root is behaviorTargets (Phase 3 work)", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "firstCallTargets", value: {} }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(501);
  });
});

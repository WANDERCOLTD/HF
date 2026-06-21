/**
 * Tests for `PATCH /api/courses/[courseId]/journey-setting` — Phase 2A
 * of epic #1675 (story #1687).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    domain: { findUnique: vi.fn(), update: vi.fn() },
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
vi.mock("@/lib/domain/update-domain-config", () => ({
  updateDomainConfig: vi.fn(async () => ({
    domain: { id: "d1" },
    composeAffectingChanged: true,
    timestampBumped: true,
    fanoutScope: "none",
  })),
}));
vi.mock("@/lib/compose/bump-domain-staleness", () => ({
  bumpDomainSectionStaleness: vi.fn(async () => []),
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
    mockPrisma.playbook.findFirst.mockResolvedValue({ id: "course-1", domainId: "domain-1" });
    mockPrisma.playbook.findMany.mockResolvedValue([{ id: "course-1" }]);
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

  // A4 of #2225 — domain-rooted writes are now supported via
  // updateDomainConfig. The full happy-path test lives in
  // `tests/api/journey-setting-domain-write.test.ts`. This case stays
  // here as a smoke test that the 501 stub is gone.
  it("does NOT 501 on domain-rooted intakeSpecId write (A4 #2225)", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "intakeSpecId", value: "spec-x" }) as never,
      PARAMS as never,
    );
    expect(res.status).not.toBe(501);
  });

  it("Phase 3 #1693: behaviorTargets returns 200 with compoundOwnedSave flag", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({ settingId: "firstCallTargets", value: {} }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.compoundOwnedSave).toBe(true);
    expect(body.bumpedSections).toEqual([]);
  });

  // ===========================================================
  // P3c (#1850) — module-scope writes (G8) via arraySelector
  // ===========================================================

  it("P3c: G8 module-scoped write succeeds when arraySelector supplied", async () => {
    const updaters: Array<(c: Record<string, unknown>) => Record<string, unknown>> = [];
    const ucMod = await import("@/lib/playbook/update-playbook-config");
    vi.mocked(ucMod.updatePlaybookConfig).mockImplementationOnce(
      async (_playbookId: string, transform: (c: Record<string, unknown>) => Record<string, unknown>) => {
        updaters.push(transform);
        const initial: Record<string, unknown> = {
          modules: [
            { id: "part1", settings: { questionTarget: { min: 8, target: 10 } } },
            { id: "part2", settings: {} },
          ],
        };
        transform(initial);
        return {
          playbook: { config: initial } as unknown as Awaited<ReturnType<typeof ucMod.updatePlaybookConfig>>["playbook"],
          composeAffectingChanged: true,
          timestampBumped: true,
          fanoutScope: "none",
        };
      },
    );
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({
        settingId: "moduleQuestionTarget",
        value: { min: 12, target: 15 },
        arraySelector: "part1",
      }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.effectiveValue).toEqual({ min: 12, target: 15 });
    // The transformer captured the write — re-running it on a fresh
    // config proves the path resolved correctly onto part1, not part2,
    // not the root.
    const fresh: Record<string, unknown> = {
      modules: [
        { id: "part1", settings: { questionTarget: { min: 8, target: 10 } } },
        { id: "part2", settings: {} },
      ],
    };
    updaters[0](fresh);
    const mods = fresh.modules as Array<{ id: string; settings: Record<string, unknown> }>;
    expect(mods[0].id).toBe("part1");
    expect(mods[0].settings.questionTarget).toEqual({ min: 12, target: 15 });
    // part2 untouched
    expect(mods[1].settings).toEqual({});
  });

  it("P3c: G8 write 400s when arraySelector missing (per-instance contract)", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({
        settingId: "moduleQuestionTarget",
        value: { min: 12, target: 15 },
      }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("ARRAY_SELECTOR_REQUIRED");
  });

  it("P3c: arraySelector on a non-array contract is ignored (backwards-compat)", async () => {
    // welcomeMessage is a string-path contract — supplying arraySelector
    // must not break the legacy path.
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeReq({
        settingId: "welcomeMessage",
        value: "hello",
        arraySelector: "ignored-id",
      }) as never,
      PARAMS as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.effectiveValue).toBe("hello");
  });
});

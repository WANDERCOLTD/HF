/**
 * Tests for PUT /api/courses/[id]/design — #819 chain-contract gap fix.
 *
 * Covers the new behaviour:
 *  - Saving a COMPOSE-affecting namespace triggers recompose-all fan-out
 *    (autoComposeForCaller invoked for every ACTIVE roster entry).
 *  - Saving ONLY non-compose-affecting fields (welcome / nps / banding)
 *    does NOT trigger fan-out — bandwidth preservation.
 *  - 404 still flows when playbook missing (no compose fan-out either).
 *  - Response carries `recomposed: boolean` so the UI can surface the
 *    "propagating to N callers" status.
 *
 * Fan-out is fire-and-forget — we await the dynamic import promise chain
 * by waiting for `autoComposeForCaller` to have been called the expected
 * number of times before the test assertions run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "op1", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn((result: Record<string, unknown>) => "error" in result),
}));

const mockPrisma = {
  playbook: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  callerPlaybook: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: () => mockPrisma }));

const mockAutoCompose = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/enrollment/auto-compose", () => ({
  autoComposeForCaller: mockAutoCompose,
}));

const mockGetRoster = vi.fn();
vi.mock("@/lib/enrollment", () => ({
  getPlaybookRoster: mockGetRoster,
}));

async function flushDynamicImports() {
  // Allow the fire-and-forget import chain to resolve fully.
  // Two microtask ticks: one for the dynamic import, one for the
  // inner await chain.
  await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 10));
}

describe("PUT /api/courses/[id]/design — recompose fan-out (#819)", () => {
  let PUT: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });
    mockGetRoster.mockResolvedValue([
      { caller: { id: "u1" } },
      { caller: { id: "u2" } },
      { caller: { id: "u3" } },
    ]);
    const mod = await import("@/app/api/courses/[courseId]/design/route");
    PUT = mod.PUT;
  });

  function call(body: Record<string, unknown>) {
    return PUT(
      new Request("http://localhost/api/courses/pb1/design", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ courseId: "pb1" }) },
    );
  }

  it("firstCallMode change triggers fan-out across the active roster", async () => {
    const res = await call({ firstCallMode: "baseline_assessment" });
    const json = await res.json();
    expect(json).toEqual({ ok: true, recomposed: true });

    await flushDynamicImports();
    expect(mockGetRoster).toHaveBeenCalledWith("pb1", "ACTIVE");
    expect(mockAutoCompose).toHaveBeenCalledTimes(3);
    expect(mockAutoCompose).toHaveBeenCalledWith("u1", "pb1");
    expect(mockAutoCompose).toHaveBeenCalledWith("u2", "pb1");
    expect(mockAutoCompose).toHaveBeenCalledWith("u3", "pb1");
  });

  it("firstSessionTargets change triggers fan-out", async () => {
    const res = await call({
      firstSessionTargets: { "BEH-WARMTH": { value: 0.8 } },
    });
    const json = await res.json();
    expect(json.recomposed).toBe(true);
    await flushDynamicImports();
    expect(mockAutoCompose).toHaveBeenCalledTimes(3);
  });

  it("progressNarrative change triggers fan-out", async () => {
    const res = await call({ progressNarrative: { enabled: false } });
    const json = await res.json();
    expect(json.recomposed).toBe(true);
    await flushDynamicImports();
    expect(mockAutoCompose).toHaveBeenCalledTimes(3);
  });

  it("offboardingSummary change triggers fan-out", async () => {
    const res = await call({ offboardingSummary: { enabled: false } });
    const json = await res.json();
    expect(json.recomposed).toBe(true);
    await flushDynamicImports();
    expect(mockAutoCompose).toHaveBeenCalledTimes(3);
  });

  it("nullable clear (firstCallMode: null) also triggers fan-out", async () => {
    // Clearing back to default IS a compose-affecting change — without
    // fan-out the existing prompt for each caller would still carry the
    // previous override.
    const res = await call({ firstCallMode: null });
    const json = await res.json();
    expect(json.recomposed).toBe(true);
    await flushDynamicImports();
    expect(mockAutoCompose).toHaveBeenCalledTimes(3);
  });

  it("welcome / nps / banding-only saves do NOT trigger fan-out", async () => {
    const res = await call({
      welcome: { goals: { enabled: true }, aboutYou: { enabled: true }, knowledgeCheck: { enabled: false }, aiIntroCall: { enabled: false } },
      nps: { enabled: true, trigger: "mastery", threshold: 80 },
      skillTierMapping: null,
    });
    const json = await res.json();
    expect(json.recomposed).toBe(false);
    await flushDynamicImports();
    expect(mockAutoCompose).not.toHaveBeenCalled();
    expect(mockGetRoster).not.toHaveBeenCalled();
  });

  it("missing playbook → 404, no fan-out", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = await call({ firstCallMode: "teach_immediately" });
    expect(res.status).toBe(404);
    await flushDynamicImports();
    expect(mockAutoCompose).not.toHaveBeenCalled();
  });

  it("empty roster: response still returns ok, no autoCompose calls", async () => {
    mockGetRoster.mockResolvedValue([]);
    const res = await call({ firstCallMode: "onboarding" });
    const json = await res.json();
    expect(json).toEqual({ ok: true, recomposed: true });
    await flushDynamicImports();
    expect(mockGetRoster).toHaveBeenCalledWith("pb1", "ACTIVE");
    expect(mockAutoCompose).not.toHaveBeenCalled();
  });
});

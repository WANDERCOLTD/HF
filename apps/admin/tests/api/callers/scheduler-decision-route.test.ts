/**
 * Tests for `GET /api/callers/[callerId]/scheduler-decision` — #1663
 * (Epic #1606 Group C Phase 2).
 *
 * Pinned acceptance:
 *   1. STUDENT-readable for own caller, OPERATOR+ for any caller
 *   2. STUDENT reading foreign callerId → callerScopeMismatchResponse
 *   3. No decision recorded → `{ ok: true, decision: null }`
 *   4. Decision present → returns mode + reason + writtenAt only
 *      (Decision 1: workingSetAssertionIds NOT surfaced)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReadScheduler, mockStudentAllowed } = vi.hoisted(() => ({
  mockReadScheduler: vi.fn(),
  mockStudentAllowed: vi.fn(),
}));

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
vi.mock("@/lib/pipeline/scheduler-decision", () => ({
  readSchedulerDecision: mockReadScheduler,
  SCHEDULER_DECISION_KEY: "scheduler:last_decision",
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/scheduler-decision/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
});

describe("GET /api/callers/[callerId]/scheduler-decision", () => {
  it("returns 403 when STUDENT scope check rejects the caller", async () => {
    mockStudentAllowed.mockReturnValue(false);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/scheduler-decision"), PARAMS);
    expect(res.status).toBe(403);
    expect(mockReadScheduler).not.toHaveBeenCalled();
  });

  it("returns null decision when readSchedulerDecision returns null", async () => {
    mockReadScheduler.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/scheduler-decision"), PARAMS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; decision: unknown };
    expect(json.ok).toBe(true);
    expect(json.decision).toBeNull();
  });

  it("surfaces mode + reason + writtenAt only — workingSetAssertionIds NOT returned (Decision 1)", async () => {
    mockReadScheduler.mockResolvedValue({
      mode: "assess",
      outcomeId: "LO-01",
      contentSourceId: "src-1",
      workingSetAssertionIds: ["assertion-1", "assertion-2"],
      reason: "Calls-since-last-assess hit the threshold — running a check-in",
      writtenAt: "2026-06-14T09:00:00.000Z",
      callsSinceAssess: 4,
    });
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/scheduler-decision"), PARAMS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      decision: Record<string, unknown>;
    };
    expect(json.decision.mode).toBe("assess");
    expect(json.decision.reason).toBe(
      "Calls-since-last-assess hit the threshold — running a check-in",
    );
    expect(json.decision.writtenAt).toBe("2026-06-14T09:00:00.000Z");
    // Decision 1: workingSet + outcomeId + contentSourceId + counter
    // are intentionally not surfaced.
    expect(json.decision.workingSetAssertionIds).toBeUndefined();
    expect(json.decision.outcomeId).toBeUndefined();
    expect(json.decision.contentSourceId).toBeUndefined();
    expect(json.decision.callsSinceAssess).toBeUndefined();
  });

  it("includes the callerId in the response envelope", async () => {
    mockReadScheduler.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new Request("http://x/scheduler-decision"), PARAMS);
    const json = (await res.json()) as { callerId: string };
    expect(json.callerId).toBe("c1");
  });
});

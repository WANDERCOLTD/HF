/**
 * Tests for `GET /api/callers/[callerId]/adaptations` — Sprint 5 SP5-A
 * shell. Pins:
 *
 *   1. OPERATOR+ only — STUDENT/VIEWER refused at the auth gate.
 *   2. 404 when caller missing.
 *   3. Empty enrolment response when caller has no playbook.
 *   4. Empty shell when caller is enrolled but has zero CallerTarget
 *      overrides (empty=true so the UI can render the right copy).
 *   5. empty=false when ≥1 override exists (SP5-B will fill the array).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    caller: { findUnique: vi.fn() },
    callerPlaybook: { findFirst: vi.fn() },
    callerTarget: { count: vi.fn(), findMany: vi.fn() },
    parameter: { findMany: vi.fn() },
    behaviorTarget: { findMany: vi.fn() },
    rewardScore: { findMany: vi.fn() as ReturnType<typeof vi.fn> },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock(
  "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller",
  () => ({ getEffectiveBehaviorTargetsForCaller: vi.fn(async () => []) }),
);

// Default mock — OPERATOR session passes. Per-test overrides simulate
// STUDENT/VIEWER refusal at the auth gate.
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: (v: unknown) =>
    typeof v === "object" && v !== null && "error" in v,
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/adaptations/route");
}

describe("GET /api/callers/[callerId]/adaptations — SP5-A shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no RewardScore rows. Individual SP5-C tests override.
    mockPrisma.rewardScore.findMany.mockResolvedValue([]);
  });

  it("returns 403 for STUDENT (refused at requireAuth OPERATOR gate)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      error: new Response("forbidden", { status: 403 }),
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 404 when caller missing", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns shell with empty=true and null playbook when caller has no enrolment", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.playbookId).toBeNull();
    expect(body.playbookName).toBeNull();
    expect(body.empty).toBe(true);
    expect(body.whatWasAdapted).toEqual([]);
    expect(body.why).toEqual([]);
    expect(body.nextAdaptation).toBeNull();
  });

  it("returns shell with empty=true when enrolled but zero overrides", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.playbookId).toBe("pb1");
    expect(body.playbookName).toBe("IELTS Speaking");
    expect(body.empty).toBe(true);
    expect(body.whatWasAdapted).toEqual([]);
  });

  it("SP5-B: filters SYSTEM-only entries from whatWasAdapted (those are unchanged baseline)", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    const effective = await import(
      "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller"
    );
    vi.mocked(effective.getEffectiveBehaviorTargetsForCaller).mockResolvedValueOnce([
      {
        parameterId: "BEH_QUESTION_RATE",
        effectiveValue: 0.6,
        sourceScope: "SYSTEM",
        systemValue: 0.6,
        playbookValue: null,
        callerValue: null,
      },
      {
        parameterId: "BEH_PRAISE_RATE",
        effectiveValue: 0.4,
        sourceScope: "PLAYBOOK",
        systemValue: 0.5,
        playbookValue: 0.4,
        callerValue: null,
      },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "BEH_PRAISE_RATE", name: "Praise rate" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([]);
    mockPrisma.behaviorTarget.findMany.mockResolvedValue([
      {
        parameterId: "BEH_PRAISE_RATE",
        updatedAt: new Date("2026-06-10T10:00:00Z"),
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    // SYSTEM-only row dropped; PLAYBOOK survived.
    expect(body.whatWasAdapted).toHaveLength(1);
    expect(body.whatWasAdapted[0]).toMatchObject({
      parameterId: "BEH_PRAISE_RATE",
      parameterName: "Praise rate",
      defaultValue: 0.5,
      overrideValue: 0.4,
      sourceScope: "PLAYBOOK",
      confidence: null,
      callsApplied: 0,
    });
    expect(body.empty).toBe(false);
  });

  it("SP5-C: derives why-entries from RewardScore.targetUpdatesApplied with direction + delta", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    mockPrisma.rewardScore.findMany.mockResolvedValueOnce([
      {
        callId: "call-99",
        scoredAt: new Date("2026-06-12T10:00:00Z"),
        targetUpdatesApplied: [
          {
            parameterId: "BEH_QUESTION_RATE",
            oldTarget: 0.5,
            newTarget: 0.7,
            reason: "Assessment near threshold — raise questioning",
          },
          {
            parameterId: "BEH_PRAISE_RATE",
            oldTarget: 0.5,
            newTarget: 0.5,
            reason: "No change warranted this call",
          },
        ],
      },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "BEH_QUESTION_RATE", name: "Question rate" },
      { parameterId: "BEH_PRAISE_RATE", name: "Praise rate" },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.why).toHaveLength(2);
    const up = body.why.find((r: { direction: string }) => r.direction === "up");
    const hold = body.why.find((r: { direction: string }) => r.direction === "hold");
    expect(up).toMatchObject({
      parameterName: "Question rate",
      direction: "up",
      callId: "call-99",
    });
    expect(up.delta).toBeCloseTo(0.2, 5);
    expect(hold).toMatchObject({
      parameterName: "Praise rate",
      direction: "hold",
    });
    expect(hold.delta).toBeCloseTo(0, 5);
    expect(body.empty).toBe(false);
  });

  it("SP5-C: down direction when newTarget < oldTarget", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    mockPrisma.rewardScore.findMany.mockResolvedValueOnce([
      {
        callId: "call-7",
        scoredAt: new Date("2026-06-10T10:00:00Z"),
        targetUpdatesApplied: [
          {
            parameterId: "BEH_INTERRUPTIONS",
            oldTarget: 0.4,
            newTarget: 0.2,
            reason: "Too many interruptions — soften",
          },
        ],
      },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "BEH_INTERRUPTIONS", name: "Interruptions" },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.why[0].direction).toBe("down");
    expect(body.why[0].delta).toBeCloseTo(-0.2, 5);
  });

  it("SP5-C: tolerates malformed targetUpdatesApplied entries", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    mockPrisma.rewardScore.findMany.mockResolvedValueOnce([
      {
        callId: "call-1",
        scoredAt: new Date("2026-06-10T10:00:00Z"),
        targetUpdatesApplied: [
          null,
          { parameterId: 42 }, // non-string parameterId
          { reason: "missing both targets" },
          { parameterId: "OK", oldTarget: 0.3, newTarget: 0.5, reason: "valid" },
        ],
      },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "OK", name: "OK param" },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.why).toHaveLength(3); // null skipped; non-object skipped; others kept
    const valid = body.why.find((r: { parameterId: string }) => r.parameterId === "OK");
    expect(valid?.direction).toBe("up");
    const missingBoth = body.why.find(
      (r: { rationale: string }) => r.rationale === "missing both targets",
    );
    expect(missingBoth?.direction).toBe("hold");
    expect(missingBoth?.delta).toBeNull();
  });

  it("SP5-B: CALLER-scope override carries confidence + callsApplied from CallerTarget", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    const effective = await import(
      "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller"
    );
    vi.mocked(effective.getEffectiveBehaviorTargetsForCaller).mockResolvedValueOnce([
      {
        parameterId: "skill_fluency",
        effectiveValue: 0.78,
        sourceScope: "CALLER",
        systemValue: 0.5,
        playbookValue: null,
        callerValue: 0.78,
      },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "skill_fluency", name: "Fluency" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      {
        parameterId: "skill_fluency",
        confidence: 0.85,
        callsUsed: 4,
        updatedAt: new Date("2026-06-12T09:00:00Z"),
      },
    ]);
    mockPrisma.behaviorTarget.findMany.mockResolvedValue([]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.whatWasAdapted[0]).toMatchObject({
      parameterId: "skill_fluency",
      sourceScope: "CALLER",
      confidence: 0.85,
      callsApplied: 4,
      overrideValue: 0.78,
      defaultValue: 0.5,
    });
    expect(body.whatWasAdapted[0].updatedAt).toBe("2026-06-12T09:00:00.000Z");
  });
});

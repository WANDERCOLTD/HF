/**
 * Tests for `GET /api/callers/[callerId]/adaptations`.
 *
 * Pins (post Wave C3b — visibility-policy revision of #1577):
 *
 *   1. **VIEWER+ admit gate.** STUDENT is admitted (own caller); STUDENT
 *      with a foreign callerId is refused by `studentAllowedToReadCaller`.
 *      A non-authenticated session is refused at `requireAuth("VIEWER")`.
 *   2. **viewerTier discriminator.** Every successful response carries
 *      `viewerTier`. STUDENT/VIEWER/TESTER → `redacted`; OPERATOR/EDUCATOR
 *      /ADMIN → `full`; SUPERADMIN → `diagnostic`.
 *   3. **Redacted shape.** At the `redacted` tier, `whatWasAdapted`
 *      carries only `(parameterId, parameterName, direction, updatedAt)`;
 *      `why` is replaced by `whyRedacted: { count, mostRecentAt }`;
 *      `nextAdaptation` is forced to `[]`.
 *   4. 404 when caller missing.
 *   5. Empty enrolment response when caller has no playbook.
 *   6. empty=false at full tier when ≥1 override exists.
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
    goal: { findMany: vi.fn() as ReturnType<typeof vi.fn> },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock(
  "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller",
  () => ({ getEffectiveBehaviorTargetsForCaller: vi.fn(async () => []) }),
);

// Default mock — OPERATOR session passes (returns `full` tier).
// Per-test overrides simulate STUDENT (`redacted`) / forbidden.
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR", callerId: null } },
  })),
  isAuthError: (v: unknown) =>
    typeof v === "object" && v !== null && "error" in v,
}));

// Scope helper — STUDENT can only read OWN caller; OPERATOR+ unrestricted.
vi.mock("@/lib/learner-scope", () => ({
  studentAllowedToReadCaller: (
    session: { user: { role: string; callerId: string | null } },
    callerId: string,
  ) => {
    if (session.user.role !== "STUDENT") return true;
    return session.user.callerId === callerId;
  },
  callerScopeMismatchResponse: () =>
    new Response(JSON.stringify({ error: "scope mismatch" }), { status: 403 }),
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/adaptations/route");
}

describe("GET /api/callers/[callerId]/adaptations — auth + scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.rewardScore.findMany.mockResolvedValue([]);
    mockPrisma.goal.findMany.mockResolvedValue([]);
  });

  it("admits STUDENT for own caller (returns 200 with redacted tier)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      ok: true,
      session: { user: { id: "u2", role: "STUDENT", callerId: "c1" } },
    } as never);
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);

    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.viewerTier).toBe("redacted");
  });

  it("refuses STUDENT for foreign caller (scope mismatch)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      ok: true,
      session: { user: { id: "u2", role: "STUDENT", callerId: "OTHER" } },
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    expect(res.status).toBe(403);
  });

  it("returns 403 for non-authenticated session (requireAuth refuses)", async () => {
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
});

describe("GET /api/callers/[callerId]/adaptations — viewerTier discriminator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.rewardScore.findMany.mockResolvedValue([]);
    mockPrisma.goal.findMany.mockResolvedValue([]);
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
  });

  it("tags response 'full' for OPERATOR", async () => {
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.viewerTier).toBe("full");
  });

  it("tags response 'redacted' for STUDENT", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      ok: true,
      session: { user: { id: "u2", role: "STUDENT", callerId: "c1" } },
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.viewerTier).toBe("redacted");
  });

  it("tags response 'redacted' for VIEWER (legacy alias)", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      ok: true,
      session: { user: { id: "u2", role: "VIEWER", callerId: null } },
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.viewerTier).toBe("redacted");
  });

  it("tags response 'diagnostic' for SUPERADMIN", async () => {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      ok: true,
      session: { user: { id: "u2", role: "SUPERADMIN", callerId: null } },
    } as never);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.viewerTier).toBe("diagnostic");
  });
});

describe("GET /api/callers/[callerId]/adaptations — SP5-A shell at full tier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.rewardScore.findMany.mockResolvedValue([]);
    mockPrisma.goal.findMany.mockResolvedValue([]);
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
    expect(body.nextAdaptation).toEqual([]);
  });

  it("returns shell with empty=true when enrolled but zero overrides", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "Sample" },
    });
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.playbookId).toBe("pb1");
    expect(body.empty).toBe(true);
    expect(body.whatWasAdapted).toEqual([]);
  });

  it("SP5-B: filters SYSTEM-only entries from whatWasAdapted (those are unchanged baseline)", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "Sample" },
    });
    const { getEffectiveBehaviorTargetsForCaller } = await import(
      "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller"
    );
    vi.mocked(getEffectiveBehaviorTargetsForCaller).mockResolvedValueOnce([
      {
        parameterId: "p1",
        effectiveValue: 0.7,
        sourceScope: "CALLER" as const,
        systemValue: 0.5,
      },
      {
        parameterId: "p2",
        effectiveValue: 0.5,
        sourceScope: "SYSTEM" as const,
        systemValue: 0.5,
      },
    ] as never);
    mockPrisma.parameter.findMany.mockResolvedValueOnce([
      { parameterId: "p1", name: "Clarity" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "p1",
        confidence: 0.9,
        callsUsed: 3,
        updatedAt: new Date("2026-06-12T10:00:00Z"),
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.whatWasAdapted).toHaveLength(1);
    expect(body.whatWasAdapted[0].parameterId).toBe("p1");
  });

  it("SP5-B ext: engine-scored CallerTarget (no CALLER-scope BT) surfaces as CALLER with currentScore", async () => {
    // Judy-shaped scenario: cascade returns SYSTEM-only (PLAYBOOK 0.5 is
    // treated as "unchanged baseline" — filtered) but a CallerTarget with
    // callsUsed > 0 + currentScore exists. Pre-fix the row hid.
    // Post-fix the row surfaces as CALLER-scope with overrideValue=score
    // and defaultValue=playbookValue.
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Judy" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "IELTS Speaking" },
    });
    const { getEffectiveBehaviorTargetsForCaller } = await import(
      "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller"
    );
    // PLAYBOOK-scope entry with target 0.5 (what the engine aims for),
    // but NO CALLER-scope BehaviorTarget row for this learner.
    vi.mocked(getEffectiveBehaviorTargetsForCaller).mockResolvedValueOnce([
      {
        parameterId: "skill_fluency_and_coherence_fc",
        effectiveValue: 0.5,
        sourceScope: "PLAYBOOK" as const,
        systemValue: null,
        playbookValue: 0.5,
        callerValue: null,
      },
    ] as never);
    // Two parameter lookups: (1) for the cascade block's PLAYBOOK entry;
    // (2) for the CT-driven append. Each uses its own `mockResolvedValueOnce`.
    mockPrisma.parameter.findMany.mockResolvedValueOnce([
      { parameterId: "skill_fluency_and_coherence_fc", name: "Fluency & Coherence" },
    ]);
    // BehaviorTarget PLAYBOOK-scope updatedAt lookup for the cascade block.
    mockPrisma.behaviorTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "skill_fluency_and_coherence_fc",
        updatedAt: new Date("2026-07-01T10:00:00Z"),
      },
    ]);
    // Scored CallerTarget — first-time hit that the cascade missed.
    mockPrisma.callerTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "skill_fluency_and_coherence_fc",
        currentScore: 0.42,
        callsUsed: 2,
        confidence: 0.55,
        updatedAt: new Date("2026-07-02T21:05:33Z"),
      },
    ]);
    // Parameter name resolution for the CT-driven append.
    mockPrisma.parameter.findMany.mockResolvedValueOnce([
      { parameterId: "skill_fluency_and_coherence_fc", name: "Fluency & Coherence" },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    // The cascade produced one PLAYBOOK entry; the CT-append should
    // REPLACE-via-append (different scope) — we now have 2 entries for
    // the same param. The CALLER-scope one carries the engine score.
    const callerScopeRow = body.whatWasAdapted.find(
      (o: { sourceScope: string }) => o.sourceScope === "CALLER",
    );
    expect(callerScopeRow).toBeDefined();
    expect(callerScopeRow.parameterId).toBe("skill_fluency_and_coherence_fc");
    expect(callerScopeRow.overrideValue).toBe(0.42); // engine's current read
    expect(callerScopeRow.defaultValue).toBe(0.5); // playbook target
    expect(callerScopeRow.callsApplied).toBe(2);
    expect(callerScopeRow.confidence).toBe(0.55);
  });

  it("SP5-B ext: CT rows are skipped when a CALLER-scope BT already surfaces the parameter (operator-set target wins)", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "Sample" },
    });
    const { getEffectiveBehaviorTargetsForCaller } = await import(
      "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller"
    );
    vi.mocked(getEffectiveBehaviorTargetsForCaller).mockResolvedValueOnce([
      {
        parameterId: "p1",
        effectiveValue: 0.7, // operator-set CALLER-scope override
        sourceScope: "CALLER" as const,
        systemValue: 0.5,
      },
    ] as never);
    mockPrisma.parameter.findMany.mockResolvedValueOnce([
      { parameterId: "p1", name: "Clarity" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "p1",
        confidence: 0.9,
        callsUsed: 3,
        updatedAt: new Date("2026-06-12T10:00:00Z"),
      },
    ]);
    // Second CT lookup — the scored-CT append. Also returns a CT for p1.
    mockPrisma.callerTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "p1",
        currentScore: 0.42,
        callsUsed: 3,
        confidence: 0.9,
        updatedAt: new Date("2026-06-12T10:00:00Z"),
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    // Exactly one entry: the operator's CALLER-scope BT wins over the
    // engine-derived CT. No duplicate.
    expect(body.whatWasAdapted).toHaveLength(1);
    expect(body.whatWasAdapted[0].parameterId).toBe("p1");
    expect(body.whatWasAdapted[0].overrideValue).toBe(0.7); // BT value, not CT
  });
});

describe("GET /api/callers/[callerId]/adaptations — redacted shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.rewardScore.findMany.mockResolvedValue([]);
    mockPrisma.goal.findMany.mockResolvedValue([]);
  });

  async function asStudent() {
    const permissions = await import("@/lib/permissions");
    vi.mocked(permissions.requireAuth).mockResolvedValueOnce({
      ok: true,
      session: { user: { id: "u2", role: "STUDENT", callerId: "c1" } },
    } as never);
  }

  it("strips numeric values from whatWasAdapted (only direction + name)", async () => {
    await asStudent();
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "Sample" },
    });
    const { getEffectiveBehaviorTargetsForCaller } = await import(
      "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller"
    );
    vi.mocked(getEffectiveBehaviorTargetsForCaller).mockResolvedValueOnce([
      {
        parameterId: "p1",
        effectiveValue: 0.7,
        sourceScope: "CALLER" as const,
        systemValue: 0.5,
      },
    ] as never);
    mockPrisma.parameter.findMany.mockResolvedValueOnce([
      { parameterId: "p1", name: "Clarity" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValueOnce([
      {
        parameterId: "p1",
        confidence: 0.9,
        callsUsed: 3,
        updatedAt: new Date("2026-06-12T10:00:00Z"),
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.viewerTier).toBe("redacted");
    expect(body.whatWasAdapted[0]).toMatchObject({
      parameterId: "p1",
      parameterName: "Clarity",
      direction: "up",
    });
    expect("defaultValue" in body.whatWasAdapted[0]).toBe(false);
    expect("overrideValue" in body.whatWasAdapted[0]).toBe(false);
    expect("confidence" in body.whatWasAdapted[0]).toBe(false);
    expect("sourceScope" in body.whatWasAdapted[0]).toBe(false);
  });

  it("collapses why to count + mostRecentAt and hides nextAdaptation entirely", async () => {
    await asStudent();
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbookId: "pb1",
      playbook: { id: "pb1", name: "Sample" },
    });
    mockPrisma.rewardScore.findMany.mockResolvedValueOnce([
      {
        callId: "call_1",
        scoredAt: new Date("2026-06-12T10:00:00Z"),
        targetUpdatesApplied: [
          {
            parameterId: "p_clarity",
            oldTarget: 0.5,
            newTarget: 0.7,
            reason: "Sensitive operator rationale",
          },
        ],
      },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValueOnce([
      { parameterId: "p_clarity", name: "Clarity" },
    ]);
    mockPrisma.goal.findMany.mockResolvedValueOnce([
      {
        id: "g1",
        name: "Master fractions",
        type: "LEARN",
        progress: 0.4,
        isAssessmentTarget: false,
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.viewerTier).toBe("redacted");
    expect(body.whyRedacted).toMatchObject({
      count: 1,
      mostRecentAt: "2026-06-12T10:00:00.000Z",
    });
    expect("why" in body).toBe(false);
    expect(body.nextAdaptation).toEqual([]);
  });
});

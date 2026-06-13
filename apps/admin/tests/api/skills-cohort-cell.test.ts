/**
 * Tests for GET /api/courses/[courseId]/skills-cohort-cell — SP2-D-followon.
 *
 * Coverage:
 *   - Auth gate (OPERATOR+)
 *   - 400 when skillRef or tier query params missing
 *   - 404 when playbook missing
 *   - 404 when skillRef not on this course
 *   - 400 when tier isn't part of the skill's scheme (incl. case-insensitive)
 *   - Bucketing matches the heatmap: AWAITING_EVIDENCE = currentScore null
 *     OR callsUsed=0; ABOVE_TARGET = currentScore > targetValue;
 *     scheme-named bucket = scoreToTier
 *   - Learners NOT in the requested bucket are excluded from the response
 *   - AWAITING_EVIDENCE bucket skips the BehaviorMeasurement query entirely
 *   - Most-recent measurement per learner is returned (in-process dedup)
 *   - empty=true response when no learners match the bucket
 *   - Caller display-name threading
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "u1", email: "op@test.com", role: "OPERATOR" } },
  }),
  isAuthError: vi.fn((result: Record<string, unknown>) => "error" in result),
}));

const mockPrisma = {
  playbook: { findUnique: vi.fn() },
  parameter: { findUnique: vi.fn() },
  caller: { findMany: vi.fn() },
  callerPlaybook: { findMany: vi.fn() },
  callerTarget: { findMany: vi.fn() },
  behaviorMeasurement: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/curriculum/resolve-skill", () => ({
  resolveAllSkillsForPlaybook: vi.fn(),
}));

vi.mock("@/lib/goals/track-progress", () => ({
  getSkillTierMapping: vi.fn().mockResolvedValue({
    thresholds: { approachingEmerging: 0.25, emerging: 0.5, developing: 0.75, secure: 1 },
    tierBands: { approachingEmerging: 4, emerging: 5, developing: 6, secure: 7 },
  }),
  scoreToTier: vi.fn((s: number) => {
    if (s < 0.25) return { tier: "Approaching Emerging", band: 4 };
    if (s < 0.5) return { tier: "Emerging", band: 5 };
    if (s < 0.75) return { tier: "Developing", band: 6 };
    return { tier: "Secure", band: 7 };
  }),
}));

type GetHandler = (
  req: unknown,
  ctx: { params: Promise<{ courseId: string }> },
) => Promise<Response>;

const COURSE_ID = "course-12345678";

const SKILL = {
  skillRef: "SKILL-01",
  parameterId: "param-speaking",
  targetValue: 0.7,
  tierScheme: ["emerging", "developing", "secure"],
};

describe("GET /api/courses/[id]/skills-cohort-cell", () => {
  let GET: GetHandler;
  let mockResolveAllSkills: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.playbook.findUnique.mockResolvedValue({ id: COURSE_ID });
    mockPrisma.parameter.findUnique.mockResolvedValue({ name: "Speaking" });
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([]);
    mockPrisma.caller.findMany.mockResolvedValue([]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([]);

    const skillMod = await import("@/lib/curriculum/resolve-skill");
    mockResolveAllSkills = skillMod.resolveAllSkillsForPlaybook as ReturnType<typeof vi.fn>;
    mockResolveAllSkills.mockResolvedValue([SKILL]);

    const mod = await import(
      "@/app/api/courses/[courseId]/skills-cohort-cell/route"
    );
    GET = mod.GET as GetHandler;
  });

  function call(qs: string) {
    return GET(
      new Request(`http://localhost/api/courses/${COURSE_ID}/skills-cohort-cell?${qs}`),
      { params: Promise.resolve({ courseId: COURSE_ID }) },
    );
  }

  it("returns 400 when skillRef is missing", async () => {
    const res = await call("tier=developing");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/skillRef.*tier/i);
  });

  it("returns 400 when tier is missing", async () => {
    const res = await call("skillRef=SKILL-01");
    expect(res.status).toBe(400);
  });

  it("returns 404 when playbook missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = await call("skillRef=SKILL-01&tier=developing");
    expect(res.status).toBe(404);
  });

  it("returns 404 when skillRef is unknown", async () => {
    const res = await call("skillRef=SKILL-99&tier=developing");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/SKILL-99/);
  });

  it("returns 400 when tier is not part of this skill's scheme", async () => {
    const res = await call("skillRef=SKILL-01&tier=mastered");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.acceptedTiers).toContain("emerging");
    expect(body.acceptedTiers).toContain("awaiting_evidence");
  });

  it("returns empty learners list when no one is in the bucket", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      { callerId: "c1" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      // c1 scored ~0.4 → Emerging — NOT in the developing bucket.
      { callerId: "c1", currentScore: 0.4, callsUsed: 3 },
    ]);

    const res = await call("skillRef=SKILL-01&tier=developing");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.empty).toBe(true);
    expect(json.learners).toEqual([]);
  });

  it("buckets learners with no CallerTarget into AWAITING_EVIDENCE", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      { callerId: "c1" },
      { callerId: "c2" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      // c1 has a row but no calls yet.
      { callerId: "c1", currentScore: null, callsUsed: 0 },
      // c2 has no row at all.
    ]);
    mockPrisma.caller.findMany.mockResolvedValue([
      { id: "c1", name: "Alice" },
      { id: "c2", name: "Bob" },
    ]);

    const res = await call("skillRef=SKILL-01&tier=awaiting_evidence");
    const json = await res.json();
    expect(json.empty).toBe(false);
    expect(json.learners.map((l: { callerId: string }) => l.callerId).sort()).toEqual([
      "c1",
      "c2",
    ]);
    // AWAITING_EVIDENCE branch skips the BehaviorMeasurement query entirely.
    expect(mockPrisma.behaviorMeasurement.findMany).not.toHaveBeenCalled();
    expect(json.learners.every((l: { lastMeasurement: unknown }) => l.lastMeasurement === null)).toBe(true);
  });

  it("buckets learners whose score exceeds targetValue into ABOVE_TARGET", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      { callerId: "c1" },
      { callerId: "c2" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      // c1 above the 0.7 target → ABOVE_TARGET
      { callerId: "c1", currentScore: 0.95, callsUsed: 5 },
      // c2 right at developing tier
      { callerId: "c2", currentScore: 0.6, callsUsed: 4 },
    ]);
    mockPrisma.caller.findMany.mockResolvedValue([
      { id: "c1", name: "Alice" },
    ]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([]);

    const res = await call("skillRef=SKILL-01&tier=above_target");
    const json = await res.json();
    expect(json.learners.length).toBe(1);
    expect(json.learners[0].callerId).toBe("c1");
    expect(json.learners[0].currentScore).toBe(0.95);
  });

  it("threads display name + most-recent evidence excerpts", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      { callerId: "c1" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      // c1 ~0.6 → Developing bucket
      { callerId: "c1", currentScore: 0.6, callsUsed: 2 },
    ]);
    mockPrisma.caller.findMany.mockResolvedValue([
      { id: "c1", name: "Alice" },
    ]);
    const oldMeasure = new Date("2026-06-01T00:00:00Z");
    const newMeasure = new Date("2026-06-13T00:00:00Z");
    // Two measurements for c1 — desc order means [0] is the latest.
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([
      {
        callId: "call-new",
        actualValue: 0.6,
        confidence: 0.9,
        evidence: ["Connected speech with limited hesitations"],
        measuredAt: newMeasure,
        call: { callerId: "c1" },
      },
      {
        callId: "call-old",
        actualValue: 0.4,
        confidence: 0.7,
        evidence: ["Frequent stalling"],
        measuredAt: oldMeasure,
        call: { callerId: "c1" },
      },
    ]);

    const res = await call("skillRef=SKILL-01&tier=developing");
    const json = await res.json();
    expect(json.learners[0].callerName).toBe("Alice");
    expect(json.learners[0].lastMeasurement.callId).toBe("call-new");
    expect(json.learners[0].lastMeasurement.excerpts).toEqual([
      "Connected speech with limited hesitations",
    ]);
    expect(json.learners[0].lastMeasurement.score).toBe(0.6);
  });

  it("returns null lastMeasurement when a non-AWAITING learner has no MEASURE row", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      { callerId: "c1" },
    ]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      { callerId: "c1", currentScore: 0.6, callsUsed: 2 },
    ]);
    mockPrisma.caller.findMany.mockResolvedValue([{ id: "c1", name: "Alice" }]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([]);

    const res = await call("skillRef=SKILL-01&tier=developing");
    const json = await res.json();
    expect(json.learners[0].lastMeasurement).toBeNull();
  });

  it("query string tier value is case-insensitive", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([{ callerId: "c1" }]);
    mockPrisma.callerTarget.findMany.mockResolvedValue([
      { callerId: "c1", currentScore: 0.6, callsUsed: 2 },
    ]);
    mockPrisma.caller.findMany.mockResolvedValue([{ id: "c1", name: "Alice" }]);

    const res = await call("skillRef=SKILL-01&tier=DEVELOPING");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tier).toBe("developing");
  });

  it("echoes the skill's full tier scheme + parameterName", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);

    const res = await call("skillRef=SKILL-01&tier=developing");
    const json = await res.json();
    expect(json.tierScheme).toEqual(["emerging", "developing", "secure"]);
    expect(json.parameterName).toBe("Speaking");
    expect(json.skillRef).toBe("SKILL-01");
    expect(json.parameterId).toBe("param-speaking");
  });
});

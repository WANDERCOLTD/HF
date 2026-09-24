/**
 * Tests for `GET /api/callers/[callerId]/attainment` — SP4-D goal trail
 * polish. Validates the `buildGoalTrail` synthesis against the real
 * `progressMetrics` shape written by `lib/goals/extract-goals.ts`.
 *
 * Sister of `tests/api/callers/lo-mastery-route.test.ts` (SP4-C).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    caller: { findUnique: vi.fn() },
    callerPlaybook: { findFirst: vi.fn() },
    callerTarget: { findMany: vi.fn() },
    callerModuleProgress: { findMany: vi.fn() },
    parameter: { findMany: vi.fn() },
    goal: { findMany: vi.fn() },
    callerAttribute: { findMany: vi.fn() },
    // #2140 (S5 of #2135) — prosody-chip detection reads recent calls +
    // CallScore rows filtered by the PROSODY sentinel analysisSpecId.
    call: { findMany: vi.fn() },
    callScore: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    session: { user: { id: "u1", role: "OPERATOR" } },
  })),
  isAuthError: () => false,
}));
vi.mock("@/lib/learner-scope", () => ({
  studentAllowedToReadCaller: () => true,
  callerScopeMismatchResponse: () => new Response(null, { status: 403 }),
}));
vi.mock("@/lib/curriculum/resolve-skill", () => ({
  resolveAllSkillsForPlaybook: vi.fn(async () => []),
}));
vi.mock("@/lib/curriculum/playbook-mastery-config", () => ({
  isUseFreshMastery: vi.fn(async () => false),
}));
vi.mock("@/lib/goals/track-progress", () => ({
  getSkillTierMapping: vi.fn(async () => ({ tiers: [] })),
  scoreToTier: () => ({ tier: "DEVELOPING", band: 2 }),
}));
vi.mock("@/lib/pipeline/course-style", () => ({
  // CONTINUOUS by default → modules section is empty (the route's #1252
  // guard branches out). Tests can override per-case via mockReturnValue.
  getCourseStyle: vi.fn(() => "continuous"),
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/attainment/route");
}

function happy() {
  mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1", name: "Alex" });
  mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
    playbookId: "pb1",
    playbook: { id: "pb1", name: "IELTS Speaking", config: {} },
  });
  mockPrisma.callerTarget.findMany.mockResolvedValue([]);
  mockPrisma.parameter.findMany.mockResolvedValue([]);
  mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);
  mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
  // #2140 — prosody-chip probe defaults: no recent calls, no prosody scores.
  // Tests exercising the chip override these.
  mockPrisma.call.findMany.mockResolvedValue([]);
  mockPrisma.callScore.findMany.mockResolvedValue([]);
}

describe("GET /api/callers/[callerId]/attainment — goal trail (SP4-D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trail is null when goal has no progressMetrics", async () => {
    happy();
    mockPrisma.goal.findMany.mockResolvedValue([
      {
        id: "g1",
        ref: null,
        name: "Improve fluency",
        type: "LEARN",
        status: "ACTIVE",
        progress: 0.3,
        progressStrategy: "lo_rollup",
        progressMetrics: null,
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.goals[0].trail).toBeNull();
  });

  it("trail surfaces evidence + extraction context for a real extract-goals shape", async () => {
    happy();
    mockPrisma.goal.findMany.mockResolvedValue([
      {
        id: "g1",
        ref: null,
        name: "Improve fluency",
        type: "LEARN",
        status: "ACTIVE",
        progress: 0.4,
        progressStrategy: "skill_ema",
        progressMetrics: {
          extractionMethod: "EXPLICIT",
          confidence: 0.82,
          evidence: [
            "I want to stop stalling on word-search",
            "Need to get faster at part 2 monologue",
          ],
          sourceCallId: "call-a",
          extractedAt: "2026-06-05T10:00:00Z",
          lastMentionedCallId: "call-b",
          lastMentionedAt: "2026-06-10T11:00:00Z",
          mentionCount: 2,
        },
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    const t = body.goals[0].trail;
    expect(t).not.toBeNull();
    expect(t.extractionMethod).toBe("EXPLICIT");
    expect(t.confidence).toBe(0.82);
    expect(t.sourceCallId).toBe("call-a");
    expect(t.lastMentionedCallId).toBe("call-b");
    expect(t.firstNoticedAt).toBe("2026-06-05T10:00:00Z");
    expect(t.lastMentionedAt).toBe("2026-06-10T11:00:00Z");
    expect(t.mentionCount).toBe(2);
    expect(t.totalCount).toBe(2);
    // Newest-first ordering — writer appends chronologically.
    expect(t.excerpts[0]).toBe("Need to get faster at part 2 monologue");
    expect(t.excerpts[1]).toBe("I want to stop stalling on word-search");
  });

  it("truncates excerpts to the first 4 entries, preserving totalCount", async () => {
    happy();
    mockPrisma.goal.findMany.mockResolvedValue([
      {
        id: "g1",
        ref: null,
        name: "Goal",
        type: "LEARN",
        status: "ACTIVE",
        progress: 0,
        progressStrategy: null,
        progressMetrics: {
          evidence: ["e1", "e2", "e3", "e4", "e5", "e6"],
          mentionCount: 6,
          extractedAt: "2026-06-01T10:00:00Z",
        },
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    const t = body.goals[0].trail;
    expect(t.excerpts).toHaveLength(4);
    expect(t.totalCount).toBe(6);
    // Newest-first → e6 first.
    expect(t.excerpts[0]).toBe("e6");
  });

  it("handles legacy goals with no evidence array but a source call (single-mention bootstrap)", async () => {
    happy();
    mockPrisma.goal.findMany.mockResolvedValue([
      {
        id: "g1",
        ref: null,
        name: "Goal",
        type: "LEARN",
        status: "ACTIVE",
        progress: 0,
        progressStrategy: null,
        progressMetrics: {
          extractionMethod: "INFERRED",
          confidence: 0.6,
          sourceCallId: "call-a",
          extractedAt: "2026-06-05T10:00:00Z",
        },
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    const t = body.goals[0].trail;
    expect(t).not.toBeNull();
    expect(t.excerpts).toEqual([]);
    expect(t.totalCount).toBe(0);
    expect(t.extractionMethod).toBe("INFERRED");
    expect(t.sourceCallId).toBe("call-a");
  });

  it("ignores non-string evidence entries (defensive against future writer drift)", async () => {
    happy();
    mockPrisma.goal.findMany.mockResolvedValue([
      {
        id: "g1",
        ref: null,
        name: "Goal",
        type: "LEARN",
        status: "ACTIVE",
        progress: 0,
        progressStrategy: null,
        progressMetrics: {
          evidence: ["valid", 42, null, { foo: "bar" }, "also-valid"],
          extractedAt: "2026-06-05T10:00:00Z",
        },
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    const t = body.goals[0].trail;
    expect(t.excerpts).toEqual(["also-valid", "valid"]);
    expect(t.totalCount).toBe(2);
  });

  it("falls back to extractedAt for lastMentionedAt when missing (single-mention)", async () => {
    happy();
    mockPrisma.goal.findMany.mockResolvedValue([
      {
        id: "g1",
        ref: null,
        name: "Goal",
        type: "LEARN",
        status: "ACTIVE",
        progress: 0,
        progressStrategy: null,
        progressMetrics: {
          evidence: ["only"],
          extractedAt: "2026-06-05T10:00:00Z",
          sourceCallId: "call-a",
        },
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    const t = body.goals[0].trail;
    expect(t.lastMentionedAt).toBe("2026-06-05T10:00:00Z");
    expect(t.firstNoticedAt).toBe("2026-06-05T10:00:00Z");
  });
});

// ── #1703 Theme 9 — incomplete-attempts surface ────────────────────────────
// Epic #1700 missing-surface sweep (surface 3 of 3).

describe("GET /api/callers/[callerId]/attainment — incompleteAttempts on modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns incompleteAttempts on each ModuleProgress row for structured courses", async () => {
    const { getCourseStyle } = await import("@/lib/pipeline/course-style");
    (getCourseStyle as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      "structured",
    );
    happy();
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      {
        moduleId: "m-part1",
        callCount: 4,
        incompleteAttempts: 2,
        mastery: 0.65,
        status: "IN_PROGRESS",
        module: {
          id: "m-part1",
          slug: "part1",
          title: "Part 1",
          curriculum: {
            playbookLinks: [{ playbookId: "pb1" }],
          },
        },
      },
    ]);
    mockPrisma.goal.findMany.mockResolvedValue([]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0].incompleteAttempts).toBe(2);
    expect(body.modules[0].attemptsCount).toBe(4);
  });

  it("defaults incompleteAttempts to 0 when column null (older rows)", async () => {
    const { getCourseStyle } = await import("@/lib/pipeline/course-style");
    (getCourseStyle as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      "structured",
    );
    happy();
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
      {
        moduleId: "m-part1",
        callCount: 1,
        incompleteAttempts: null,
        mastery: 0.1,
        status: "IN_PROGRESS",
        module: {
          id: "m-part1",
          slug: "part1",
          title: "Part 1",
          curriculum: {
            playbookLinks: [{ playbookId: "pb1" }],
          },
        },
      },
    ]);
    mockPrisma.goal.findMany.mockResolvedValue([]);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.modules[0].incompleteAttempts).toBe(0);
  });
});

// ── #2140 (S5 of #2135) — prosody-contribution flag on skill bands ─────────

describe("GET /api/callers/[callerId]/attainment — prosodyContributed (S5/#2140)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets prosodyContributed=true on bands whose param had a PROSODY-sentinel CallScore on a recent call", async () => {
    const { resolveAllSkillsForPlaybook } = await import(
      "@/lib/curriculum/resolve-skill"
    );
    (
      resolveAllSkillsForPlaybook as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce([
      {
        skillRef: "FC",
        parameterId: "skill_fluency_and_coherence_fc",
        targetValue: 0.7,
      },
      {
        skillRef: "LR",
        parameterId: "skill_lexical_resource_lr",
        targetValue: 0.7,
      },
    ]);
    happy();
    mockPrisma.parameter.findMany.mockResolvedValue([
      {
        parameterId: "skill_fluency_and_coherence_fc",
        name: "Fluency & Coherence",
      },
      {
        parameterId: "skill_lexical_resource_lr",
        name: "Lexical Resource",
      },
    ]);
    mockPrisma.goal.findMany.mockResolvedValue([]);
    // Recent calls window — 2 calls visible.
    mockPrisma.call.findMany.mockResolvedValue([
      { id: "call-recent-1" },
      { id: "call-recent-2" },
    ]);
    // Only the FC skill has a PROSODY-sentinel CallScore on a recent call;
    // LR has no prosody contribution.
    mockPrisma.callScore.findMany.mockResolvedValue([
      { parameterId: "skill_fluency_and_coherence_fc" },
    ]);

    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();

    const fc = body.skillBands.find(
      (b: { skillRef: string }) => b.skillRef === "FC",
    );
    const lr = body.skillBands.find(
      (b: { skillRef: string }) => b.skillRef === "LR",
    );
    expect(fc.prosodyContributed).toBe(true);
    expect(lr.prosodyContributed).toBe(false);

    // The detection query MUST filter by the PROSODY sentinel id — bare
    // CallScore reads would falsely flag LLM-judged scores. Verify the
    // exact analysisSpecId filter shape.
    const callScoreCall = mockPrisma.callScore.findMany.mock.calls[0]?.[0];
    expect(callScoreCall?.where?.analysisSpecId).toBe("PROSODY-SCORE-V1");
    expect(callScoreCall?.where?.callId?.in).toEqual([
      "call-recent-1",
      "call-recent-2",
    ]);
  });

  it("sets prosodyContributed=false on every band when the caller has zero recent calls", async () => {
    const { resolveAllSkillsForPlaybook } = await import(
      "@/lib/curriculum/resolve-skill"
    );
    (
      resolveAllSkillsForPlaybook as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce([
      {
        skillRef: "FC",
        parameterId: "skill_fluency_and_coherence_fc",
        targetValue: 0.7,
      },
    ]);
    happy();
    mockPrisma.parameter.findMany.mockResolvedValue([
      {
        parameterId: "skill_fluency_and_coherence_fc",
        name: "Fluency & Coherence",
      },
    ]);
    mockPrisma.goal.findMany.mockResolvedValue([]);
    mockPrisma.call.findMany.mockResolvedValue([]); // brand-new caller
    // CallScore should not be queried — but defensive default returns [].

    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x"), PARAMS);
    const body = await res.json();
    expect(body.skillBands[0].prosodyContributed).toBe(false);
    // Defensive: when there are no recent calls the route may skip the
    // CallScore query entirely. Don't assert on call count.
  });
});

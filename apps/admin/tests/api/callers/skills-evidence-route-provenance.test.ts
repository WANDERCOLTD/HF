/**
 * Tests for `GET /api/callers/[callerId]/skills-evidence` —
 * Wave A2 extension that joins CallScore provenance into each
 * evidence item.
 *
 * Pinned acceptance:
 *   1. Per-skill query also fires a CallScore findMany scoped to the
 *      measurements' callIds + parameterId
 *   2. Each evidence item carries reasoning + analysisSpecName +
 *      hasLearnerEvidence + evidenceQuality + scoredBy when CallScore
 *      row exists
 *   3. Missing CallScore row → all 5 provenance fields are null
 *   4. CallScore lookup is skipped entirely when measurements are empty
 *      (no wasted query)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockResolveSkills, mockStudentAllowed } = vi.hoisted(
  () => ({
    mockPrisma: {
      caller: { findUnique: vi.fn() },
      callerPlaybook: { findFirst: vi.fn() },
      parameter: { findMany: vi.fn() },
      behaviorMeasurement: { findMany: vi.fn() },
      callScore: { findMany: vi.fn() },
    },
    mockResolveSkills: vi.fn(),
    mockStudentAllowed: vi.fn(),
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
vi.mock("@/lib/curriculum/resolve-skill", () => ({
  resolveAllSkillsForPlaybook: mockResolveSkills,
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/skills-evidence/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
  mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
  mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb1" });
});

describe("skills-evidence — CallScore provenance join", () => {
  it("merges CallScore provenance into each evidence item", async () => {
    mockResolveSkills.mockResolvedValue([
      { skillRef: "SKILL-01", parameterId: "p1" },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "p1", name: "Fluency" },
    ]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([
      {
        callId: "call-7",
        actualValue: 0.62,
        confidence: 0.85,
        evidence: ["Spoke clearly about chain rule"],
        measuredAt: new Date("2026-06-14T10:00:00.000Z"),
      },
      {
        callId: "call-6",
        actualValue: 0.55,
        confidence: 0.8,
        evidence: ["Hesitated on derivatives"],
        measuredAt: new Date("2026-06-13T09:00:00.000Z"),
      },
    ]);
    mockPrisma.callScore.findMany.mockResolvedValue([
      {
        callId: "call-7",
        reasoning: "Strong fluency on the open-ended prompt",
        hasLearnerEvidence: true,
        evidenceQuality: 0.88,
        scoredBy: "llm_v1",
        analysisSpec: { name: "IELTS Fluency Scorer" },
      },
      // call-6 deliberately missing → null provenance fields expected
    ]);

    const route = await loadRoute();
    const res = await route.GET(
      new Request("http://x/skills-evidence"),
      PARAMS,
    );
    const json = (await res.json()) as {
      rows: Array<{
        evidence: Array<{
          callId: string;
          reasoning: string | null;
          analysisSpecName: string | null;
          hasLearnerEvidence: boolean | null;
          evidenceQuality: number | null;
          scoredBy: string | null;
        }>;
      }>;
    };

    const items = json.rows[0].evidence;
    // call-7 has a CallScore → full provenance
    const c7 = items.find((e) => e.callId === "call-7")!;
    expect(c7.reasoning).toBe("Strong fluency on the open-ended prompt");
    expect(c7.analysisSpecName).toBe("IELTS Fluency Scorer");
    expect(c7.hasLearnerEvidence).toBe(true);
    expect(c7.evidenceQuality).toBe(0.88);
    expect(c7.scoredBy).toBe("llm_v1");

    // call-6 has no CallScore row → all 5 provenance fields null
    const c6 = items.find((e) => e.callId === "call-6")!;
    expect(c6.reasoning).toBeNull();
    expect(c6.analysisSpecName).toBeNull();
    expect(c6.hasLearnerEvidence).toBeNull();
    expect(c6.evidenceQuality).toBeNull();
    expect(c6.scoredBy).toBeNull();
  });

  it("skips the per-call CallScore join when measurements array is empty", async () => {
    mockResolveSkills.mockResolvedValue([
      { skillRef: "SKILL-01", parameterId: "p1" },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "p1", name: "Fluency" },
    ]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([]);
    // #1887 Slice 1 — the segment-cells query still fires even with empty
    // measurements (it's a separate parameter-scoped read, not a join).
    mockPrisma.callScore.findMany.mockResolvedValue([]);

    const route = await loadRoute();
    await route.GET(new Request("http://x/skills-evidence"), PARAMS);

    // Per-call join (call #0) is skipped; only the segments query fires.
    const calls = mockPrisma.callScore.findMany.mock.calls;
    expect(calls.length).toBe(1);
    const segmentsArgs = calls[0][0] as {
      where: { parameterId: string; call: { callerId: string } };
    };
    expect(segmentsArgs.where.parameterId).toBe("p1");
    expect(segmentsArgs.where.call.callerId).toBe("c1");
  });

  it("scopes the CallScore join to the measurement callIds + the parameterId", async () => {
    mockResolveSkills.mockResolvedValue([
      { skillRef: "SKILL-01", parameterId: "p1" },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "p1", name: "Fluency" },
    ]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([
      {
        callId: "call-9",
        actualValue: 0.5,
        confidence: 0.7,
        evidence: [],
        measuredAt: new Date(),
      },
    ]);
    mockPrisma.callScore.findMany.mockResolvedValue([]);

    const route = await loadRoute();
    await route.GET(new Request("http://x/skills-evidence"), PARAMS);

    // Call #0 is the per-call join (filters by callId IN […]).
    const joinArgs = mockPrisma.callScore.findMany.mock.calls[0][0] as {
      where: { callId: { in: string[] }; parameterId: string };
    };
    expect(joinArgs.where.callId.in).toEqual(["call-9"]);
    expect(joinArgs.where.parameterId).toBe("p1");
  });
});

// ── #1887 Slice 1 — per-segment cells for the AttainmentTab matrix ──────

describe("skills-evidence — per-segment cells (#1887)", () => {
  it("projects segmentKey + analysisSpecId on the per-call join + returns a sorted segments[] per row", async () => {
    mockResolveSkills.mockResolvedValue([
      { skillRef: "SKILL-FLU", parameterId: "p-flu" },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "p-flu", name: "Fluency & Coherence" },
    ]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([
      {
        callId: "call-A",
        actualValue: 0.6,
        confidence: 0.8,
        evidence: ["foo"],
        measuredAt: new Date("2026-06-17T10:00:00.000Z"),
      },
    ]);
    mockPrisma.callScore.findMany
      // Call #0 — per-call join carries segmentKey + analysisSpecId
      .mockResolvedValueOnce([
        {
          callId: "call-A",
          reasoning: "Strong fluency",
          hasLearnerEvidence: true,
          evidenceQuality: 0.9,
          scoredBy: "llm",
          segmentKey: null,
          analysisSpecId: "spec-1",
          analysisSpec: { name: "IELTS Fluency" },
        },
      ])
      // Call #1 — segment cells across all calls for this parameter
      .mockResolvedValueOnce([
        // Most-recent first ordering
        {
          callId: "call-A",
          score: 0.65,
          segmentKey: "phase:p1",
          call: { createdAt: new Date("2026-06-17T10:00:00.000Z") },
        },
        {
          callId: "call-A",
          score: 0.6,
          segmentKey: "phase:p2_monologue",
          call: { createdAt: new Date("2026-06-17T10:00:00.000Z") },
        },
        {
          callId: "call-B",
          score: 0.55,
          segmentKey: "text:part1",
          call: { createdAt: new Date("2026-06-15T09:00:00.000Z") },
        },
        {
          callId: "call-B",
          score: 0.6,
          segmentKey: null,
          call: { createdAt: new Date("2026-06-15T09:00:00.000Z") },
        },
      ]);

    const route = await loadRoute();
    const res = await route.GET(
      new Request("http://x/skills-evidence"),
      PARAMS,
    );
    const json = (await res.json()) as {
      rows: Array<{
        segments: Array<{
          segmentKey: string | null;
          namespace: string;
          label: string;
          band: number;
        }>;
        evidence: Array<{ callId: string; analysisSpecName: string | null }>;
      }>;
    };

    expect(json.rows[0].evidence[0].analysisSpecName).toBe("IELTS Fluency");

    // Sorted by label — Overall (O) before Part 1 / Part 2 alphabetically
    const labels = json.rows[0].segments.map((s) => s.label);
    expect(labels).toEqual(["Overall", "Part 1", "Part 2 (monologue)"]);

    const overall = json.rows[0].segments.find((s) => s.label === "Overall")!;
    expect(overall.namespace).toBe("overall");
    expect(overall.segmentKey).toBeNull();
    expect(overall.band).toBeCloseTo(0.6, 5);

    const p1 = json.rows[0].segments.find((s) => s.label === "Part 1")!;
    // phase:p1 was the first-seen for "Part 1" (most-recent),
    // text:part1 came later — flips namespace to "mixed".
    expect(p1.namespace).toBe("mixed");
    expect(p1.band).toBeCloseTo(0.65, 5); // first-seen band, not averaged

    const p2 = json.rows[0].segments.find(
      (s) => s.label === "Part 2 (monologue)",
    )!;
    expect(p2.namespace).toBe("phase");
    expect(p2.segmentKey).toBe("phase:p2_monologue");
  });

  it("legacy un-prefixed segmentKeys classify as namespace 'legacy'", async () => {
    mockResolveSkills.mockResolvedValue([
      { skillRef: "SKILL-X", parameterId: "p-x" },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "p-x", name: "Pronunciation" },
    ]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([]);
    mockPrisma.callScore.findMany.mockResolvedValue([
      {
        callId: "call-Z",
        score: 0.7,
        segmentKey: "part1", // legacy, un-backfilled
        call: { createdAt: new Date("2026-06-10T10:00:00.000Z") },
      },
    ]);

    const route = await loadRoute();
    const res = await route.GET(
      new Request("http://x/skills-evidence"),
      PARAMS,
    );
    const json = (await res.json()) as {
      rows: Array<{
        segments: Array<{ namespace: string; label: string }>;
      }>;
    };
    expect(json.rows[0].segments).toHaveLength(1);
    expect(json.rows[0].segments[0].namespace).toBe("legacy");
    expect(json.rows[0].segments[0].label).toBe("Part 1");
  });

  it("returns empty segments[] when the parameter has no scoring history", async () => {
    mockResolveSkills.mockResolvedValue([
      { skillRef: "SKILL-Y", parameterId: "p-y" },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "p-y", name: "Lexical Resource" },
    ]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([]);
    mockPrisma.callScore.findMany.mockResolvedValue([]);

    const route = await loadRoute();
    const res = await route.GET(
      new Request("http://x/skills-evidence"),
      PARAMS,
    );
    const json = (await res.json()) as { rows: Array<{ segments: unknown[] }> };
    expect(json.rows[0].segments).toEqual([]);
  });
});

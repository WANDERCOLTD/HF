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

  it("skips the CallScore findMany when measurements array is empty", async () => {
    mockResolveSkills.mockResolvedValue([
      { skillRef: "SKILL-01", parameterId: "p1" },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      { parameterId: "p1", name: "Fluency" },
    ]);
    mockPrisma.behaviorMeasurement.findMany.mockResolvedValue([]);

    const route = await loadRoute();
    await route.GET(new Request("http://x/skills-evidence"), PARAMS);

    expect(mockPrisma.callScore.findMany).not.toHaveBeenCalled();
  });

  it("scopes the CallScore findMany to the measurement callIds + the parameterId", async () => {
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

    const args = mockPrisma.callScore.findMany.mock.calls[0][0] as {
      where: { callId: { in: string[] }; parameterId: string };
    };
    expect(args.where.callId.in).toEqual(["call-9"]);
    expect(args.where.parameterId).toBe("p1");
  });
});

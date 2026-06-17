/**
 * Tests for `GET /api/student/[courseId]/results/[sessionId]` — Theme 13a
 * Mock Results screen (#1751).
 *
 * Pinned acceptance:
 *   1. STUDENT scope rejects foreign sessionId (callerId mismatch → 403)
 *   2. 404 when session not found
 *   3. 403 when session.playbookId !== courseId path param (cross-course read)
 *   4. processing=true while Session.status STARTED/ACTIVE
 *   5. processing=true when Session ended but no CallScore rows landed yet
 *   6. processing=false when ended + scores present; aggregated per
 *      (parameter × segmentKey); overallBand computed mean-of-12 / half-band
 *      rounded; strength = max-band parameter; area = min-band parameter
 *   7. overallBandSource === "metadata" when `Session.metadata.overallBand` set
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockStudentAllowed, mockMapping } = vi.hoisted(() => ({
  mockPrisma: {
    session: { findUnique: vi.fn() },
    callScore: { findMany: vi.fn() },
  },
  mockStudentAllowed: vi.fn(),
  mockMapping: vi.fn(),
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
  studentAllowedToReadCaller: mockStudentAllowed,
  callerScopeMismatchResponse: () =>
    new Response(JSON.stringify({ ok: false, error: "scope" }), { status: 403 }),
}));
vi.mock("@/lib/goals/track-progress", () => ({
  // Identity-ish mapping: score 0–1 → band 0–9 (IELTS-like) for predictable test maths.
  scoreToTier: (score: number) => ({ tier: "Test", band: Math.round(score * 9 * 2) / 2 }),
  getSkillTierMapping: mockMapping,
}));

const PARAMS = { params: Promise.resolve({ courseId: "course-1", sessionId: "sess-1" }) };

async function loadRoute() {
  return import("@/app/api/student/[courseId]/results/[sessionId]/route");
}

function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sess-1",
    callerId: "caller-1",
    playbookId: "course-1",
    kind: "VOICE_CALL",
    status: "COMPLETED",
    startedAt: new Date("2026-06-16T10:00:00Z"),
    endedAt: new Date("2026-06-16T10:14:00Z"),
    metadata: null,
    playbook: { name: "IELTS Speaking Practice" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStudentAllowed.mockReturnValue(true);
  mockMapping.mockResolvedValue({}); // shape ignored by mocked scoreToTier
});

describe("GET /api/student/[courseId]/results/[sessionId]", () => {
  it("rejects STUDENT reading foreign session (403)", async () => {
    mockStudentAllowed.mockReturnValue(false);
    mockPrisma.session.findUnique.mockResolvedValue(makeSession());
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x/results"), PARAMS);
    expect(res.status).toBe(403);
    expect(mockPrisma.callScore.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when session not found", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x/results"), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns 403 when session.playbookId !== courseId path param", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(makeSession({ playbookId: "other-course" }));
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x/results"), PARAMS);
    expect(res.status).toBe(403);
    expect(mockPrisma.callScore.findMany).not.toHaveBeenCalled();
  });

  it("processing=true while Session.status is STARTED", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(makeSession({ status: "STARTED", endedAt: null }));
    mockPrisma.callScore.findMany.mockResolvedValue([]);
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x/results"), PARAMS);
    const body = (await res.json()) as { ok: true; processing: boolean };
    expect(res.status).toBe(200);
    expect(body.processing).toBe(true);
  });

  it("processing=true when Session ended but no scores landed yet", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(makeSession({ status: "COMPLETED" }));
    mockPrisma.callScore.findMany.mockResolvedValue([]);
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x/results"), PARAMS);
    const body = (await res.json()) as { ok: true; processing: boolean };
    expect(body.processing).toBe(true);
  });

  it("aggregates per (parameter × segmentKey) + computes overallBand + strength/area", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(makeSession({ status: "COMPLETED" }));
    // 4 criteria × 3 parts, each criterion gets the same score per part for predictability
    const criteria = [
      { id: "fc", name: "Fluency & Coherence", score: 0.7 },
      { id: "lr", name: "Lexical Resource", score: 0.6 },
      { id: "gra", name: "Grammar", score: 0.55 },
      { id: "pr", name: "Pronunciation", score: 0.8 },
    ];
    const segments = ["part1", "part2", "part3"];
    const rows = criteria.flatMap((c) =>
      segments.map((seg) => ({
        parameterId: c.id,
        segmentKey: seg,
        score: c.score,
        parameter: { name: c.name },
      })),
    );
    mockPrisma.callScore.findMany.mockResolvedValue(rows);

    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x/results"), PARAMS);
    const body = (await res.json()) as {
      ok: true;
      processing: boolean;
      scores: Array<{ parameterId: string; segmentKey: string | null; band: number; count: number }>;
      overallBand: number;
      overallBandSource: "metadata" | "computed" | null;
      strength: { parameterId: string; band: number };
      area: { parameterId: string; band: number };
    };

    expect(body.processing).toBe(false);
    expect(body.scores).toHaveLength(12);
    // Per the mocked scoreToTier (band = round(score*9*2)/2):
    //   fc 0.7 → 6.5, lr 0.6 → 5.5, gra 0.55 → 5, pr 0.8 → 7
    // strength = pr (7), area = gra (5).
    expect(body.strength.parameterId).toBe("pr");
    expect(body.area.parameterId).toBe("gra");
    // Mean of 12 bands = (6.5+5.5+5+7) * 3 / 12 = 6.0 → half-band rounded = 6.
    expect(body.overallBandSource).toBe("computed");
    expect(body.overallBand).toBe(6);
  });

  it("prefers Session.metadata.overallBand when present", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(
      makeSession({ status: "COMPLETED", metadata: { overallBand: 7.5 } }),
    );
    mockPrisma.callScore.findMany.mockResolvedValue([
      { parameterId: "fc", segmentKey: "part1", score: 0.5, parameter: { name: "Fluency" } },
    ]);
    const route = await loadRoute();
    const res = await route.GET(new NextRequest("http://x/results"), PARAMS);
    const body = (await res.json()) as {
      overallBand: number;
      overallBandSource: "metadata" | "computed" | null;
    };
    expect(body.overallBand).toBe(7.5);
    expect(body.overallBandSource).toBe("metadata");
  });
});

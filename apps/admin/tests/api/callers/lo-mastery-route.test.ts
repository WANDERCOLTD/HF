/**
 * Tests for `GET /api/callers/[callerId]/lo-mastery` — SP4-C per-LO drill.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    caller: { findUnique: vi.fn() },
    callerPlaybook: { findFirst: vi.fn() },
    playbookCurriculum: { findFirst: vi.fn() },
    curriculumModule: { findFirst: vi.fn() },
    learningObjective: { findMany: vi.fn() },
    callerAttribute: { findMany: vi.fn() },
    call: { findFirst: vi.fn() },
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
vi.mock("@/lib/curriculum/playbook-mastery-config", () => ({
  isUseFreshMastery: vi.fn(async () => false),
}));
vi.mock("@/lib/curriculum/scratch-mastery", () => ({
  getAllScratchMastery: vi.fn(async () => ({})),
}));
vi.mock("@/lib/goals/track-progress", () => ({
  getSkillTierMapping: vi.fn(async () => ({
    tiers: [
      { tier: "EMERGING", min: 0, max: 0.4, band: 1 },
      { tier: "DEVELOPING", min: 0.4, max: 0.7, band: 2 },
      { tier: "SECURE", min: 0.7, max: 1.0, band: 3 },
    ],
  })),
  scoreToTier: (score: number) => {
    if (score >= 0.7) return { tier: "SECURE", band: 3 };
    if (score >= 0.4) return { tier: "DEVELOPING", band: 2 };
    return { tier: "EMERGING", band: 1 };
  },
}));

const PARAMS = { params: Promise.resolve({ callerId: "c1" }) };
const URL_WITH_MODULE = "http://x/api/callers/c1/lo-mastery?moduleId=m1";

async function loadRoute() {
  return import("@/app/api/callers/[callerId]/lo-mastery/route");
}

function setupHappyPath() {
  mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
  mockPrisma.callerPlaybook.findFirst.mockResolvedValue({ playbookId: "pb1" });
  mockPrisma.playbookCurriculum.findFirst.mockResolvedValue({
    curriculumId: "curr1",
  });
  mockPrisma.curriculumModule.findFirst.mockResolvedValue({
    id: "m1",
    slug: "module-one",
    title: "Module One",
    masteryThreshold: 0.8,
  });
  mockPrisma.learningObjective.findMany.mockResolvedValue([
    {
      ref: "LO1",
      description: "First objective",
      performanceStatement: null,
      sortOrder: 0,
      masteryThreshold: null,
    },
    {
      ref: "LO2",
      description: "Second objective",
      performanceStatement: "Be able to do X",
      sortOrder: 1,
      masteryThreshold: 0.9,
    },
    {
      ref: "LO3",
      description: "Third objective",
      performanceStatement: null,
      sortOrder: 2,
      masteryThreshold: null,
    },
  ]);
  mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
}

describe("GET /api/callers/[callerId]/lo-mastery — SP4-C", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects request with no moduleId", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      new Request("http://x/api/callers/c1/lo-mastery"),
      PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when caller missing", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns 404 when caller has no enrolment", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({ id: "c1" });
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns 404 when module not in this caller's curriculum", async () => {
    setupHappyPath();
    mockPrisma.curriculumModule.findFirst.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns all LOs with not_started when no mastery rows exist", async () => {
    setupHappyPath();
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.learningObjectives).toHaveLength(3);
    expect(body.learningObjectives.every((lo: { status: string }) => lo.status === "not_started")).toBe(true);
    expect(body.useFreshMastery).toBe(false);
    expect(body.moduleSlug).toBe("module-one");
  });

  it("classifies mastery: >= LO threshold → mastered; below → in_progress", async () => {
    setupHappyPath();
    mockPrisma.callerAttribute.findMany.mockResolvedValue([
      {
        key: "playbook:pb1:lo_mastery:module-one:LO1",
        numberValue: 0.85, // module threshold 0.8 → mastered
        updatedAt: new Date("2026-06-10T12:00:00Z"),
      },
      {
        key: "playbook:pb1:lo_mastery:module-one:LO2",
        numberValue: 0.85, // LO threshold 0.9 → in_progress
        updatedAt: new Date("2026-06-11T12:00:00Z"),
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    const body = await res.json();
    const lo1 = body.learningObjectives.find(
      (x: { ref: string }) => x.ref === "LO1",
    );
    const lo2 = body.learningObjectives.find(
      (x: { ref: string }) => x.ref === "LO2",
    );
    const lo3 = body.learningObjectives.find(
      (x: { ref: string }) => x.ref === "LO3",
    );
    expect(lo1.status).toBe("mastered");
    expect(lo1.tier).toBe("secure");
    expect(lo2.status).toBe("in_progress");
    expect(lo3.status).toBe("not_started");
    expect(lo3.mastery).toBeNull();
  });

  it("uses performanceStatement when set, falls back to description", async () => {
    setupHappyPath();
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    const body = await res.json();
    const lo1 = body.learningObjectives.find(
      (x: { ref: string }) => x.ref === "LO1",
    );
    const lo2 = body.learningObjectives.find(
      (x: { ref: string }) => x.ref === "LO2",
    );
    expect(lo1.description).toBe("First objective");
    expect(lo2.description).toBe("Be able to do X");
  });

  it("ignores callerAttribute rows for sibling modules (slug-scope)", async () => {
    setupHappyPath();
    mockPrisma.callerAttribute.findMany.mockResolvedValue([
      // Postgres-side filter already excludes these, but the regex
      // belt-and-braces match in the route must too.
      {
        key: "playbook:pb1:lo_mastery:module-two:LO1",
        numberValue: 0.95,
        updatedAt: new Date(),
      },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    const body = await res.json();
    expect(
      body.learningObjectives.every((lo: { status: string }) => lo.status === "not_started"),
    ).toBe(true);
  });

  it("useFreshMastery: pulls scratch from latest call when present", async () => {
    setupHappyPath();
    const playbookMasteryConfig = await import(
      "@/lib/curriculum/playbook-mastery-config"
    );
    const scratchMastery = await import("@/lib/curriculum/scratch-mastery");
    vi.mocked(playbookMasteryConfig.isUseFreshMastery).mockResolvedValueOnce(
      true,
    );
    mockPrisma.call.findFirst.mockResolvedValue({
      id: "call-99",
      endedAt: new Date("2026-06-12T12:00:00Z"),
    });
    vi.mocked(scratchMastery.getAllScratchMastery).mockResolvedValueOnce({
      "lo_mastery:module-one:LO1": 0.95,
      "lo_mastery:module-one:LO2": 0.45,
    });
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    const body = await res.json();
    expect(body.useFreshMastery).toBe(true);
    expect(body.scratchSourceCallId).toBe("call-99");
    const lo1 = body.learningObjectives.find(
      (x: { ref: string }) => x.ref === "LO1",
    );
    expect(lo1.mastery).toBe(0.95);
    expect(lo1.status).toBe("mastered");
  });

  it("useFreshMastery: scratchSourceCallId null when no scoring call yet", async () => {
    setupHappyPath();
    const playbookMasteryConfig = await import(
      "@/lib/curriculum/playbook-mastery-config"
    );
    vi.mocked(playbookMasteryConfig.isUseFreshMastery).mockResolvedValueOnce(
      true,
    );
    mockPrisma.call.findFirst.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request(URL_WITH_MODULE), PARAMS);
    const body = await res.json();
    expect(body.useFreshMastery).toBe(true);
    expect(body.scratchSourceCallId).toBeNull();
    expect(
      body.learningObjectives.every((lo: { status: string }) => lo.status === "not_started"),
    ).toBe(true);
  });
});

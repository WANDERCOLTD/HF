/**
 * Tests for `GET /api/student/qualification-progress` — #1098 Slice A C4.
 *
 * Covers AC4: scope discipline, qualification shape, unit composition,
 * non-anchored Curriculum graceful path, and Next Best Step.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  callerPlaybook: { findFirst: vi.fn() },
  callerAttribute: { findMany: vi.fn() },
  curriculum: { findMany: vi.fn() },
  curriculumModule: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: {
      user: { id: "user-1", email: "learner@test.com", role: "STUDENT" },
    },
  }),
  isAuthError: vi.fn((result: Record<string, unknown>) => "error" in result),
}));

vi.mock("@/lib/learner-scope", () => ({
  resolveCallerScopeForReading: vi.fn().mockResolvedValue({ scopedCallerId: "caller-1" }),
  isScopeError: vi.fn((result: Record<string, unknown>) => "error" in result),
}));

describe("GET /api/student/qualification-progress — #1098 Slice A C4", () => {
  let GET: typeof import("@/app/api/student/qualification-progress/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/student/qualification-progress/route");
    GET = mod.GET;

    // Re-establish default mocks cleared above.
    const auth = await import("@/lib/permissions");
    (auth.requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { user: { id: "user-1", email: "learner@test.com", role: "STUDENT" } },
    });
    (auth.isAuthError as ReturnType<typeof vi.fn>).mockImplementation(
      (result: Record<string, unknown>) => "error" in result,
    );
    const scope = await import("@/lib/learner-scope");
    (scope.resolveCallerScopeForReading as ReturnType<typeof vi.fn>).mockResolvedValue({
      scopedCallerId: "caller-1",
    });
    (scope.isScopeError as ReturnType<typeof vi.fn>).mockImplementation(
      (result: Record<string, unknown>) => "error" in result,
    );
  });

  it("returns qualification:null when active enrollment's Curriculum has no qualificationAnchor (back-compat)", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: "pb-generic",
        config: {},
        playbookCurricula: [
          {
            role: "primary",
            curriculum: {
              id: "cur-generic",
              slug: "generic-course-v1",
              name: "Generic Course",
              qualificationAnchor: null,
              qualificationBody: null,
              qualificationNumber: null,
              qualificationLevel: null,
            },
          },
        ],
      },
    });

    const res = await GET(new Request("http://localhost/api/student/qualification-progress"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.qualification).toBeNull();
    expect(body.units).toEqual([]);
    expect(body.nextBestStep).toBeNull();
  });

  it("404 when learner has no active enrollment", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/student/qualification-progress"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("AC4 — composes qualification + units + skills + nextBestStep for an anchored Curriculum", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: "pb-revision",
        config: { maxMasteryTier: "PRACTITIONER" }, // → "Revision Aid"
        playbookCurricula: [
          {
            role: "primary",
            curriculum: {
              id: "cur-revision",
              slug: "cio-cto-revision-aid-v1",
              name: "The CIO/CTO Standard",
              qualificationAnchor: "sias-cio-cto-v6",
              qualificationBody: "SIAS",
              qualificationNumber: "603/0001/0",
              qualificationLevel: "Practitioner",
            },
          },
        ],
      },
    });

    // catalog load: sibling list + modules + skills config
    mockPrisma.curriculum.findMany
      .mockResolvedValueOnce([
        {
          id: "cur-revision",
          slug: "cio-cto-revision-aid-v1",
          name: "The CIO/CTO Standard",
          qualificationAnchor: "sias-cio-cto-v6",
          qualificationBody: "SIAS",
          qualificationNumber: "603/0001/0",
          qualificationLevel: "Practitioner",
        },
      ])
      .mockResolvedValueOnce([{ crossCuttingSkillsConfig: { skills: [{ ref: "SKILL-01", name: "Stakeholder anticipation" }] } }]);
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      {
        slug: "standard-unit-04",
        title: "IT Operations and Infrastructure",
        description: null,
        sortOrder: 4,
        learningObjectives: [
          { ref: "OUT-04-01", description: "Plan capacity", performanceStatement: null, sortOrder: 0 },
          { ref: "OUT-04-02", description: "Recover from incidents", performanceStatement: null, sortOrder: 1 },
        ],
      },
      {
        slug: "standard-unit-09",
        title: "Enterprise and Business Architecture",
        description: null,
        sortOrder: 9,
        learningObjectives: [
          { ref: "OUT-09-01", description: "Define enterprise model", performanceStatement: null, sortOrder: 0 },
        ],
      },
    ]);

    mockPrisma.callerAttribute.findMany.mockResolvedValue([
      // unit_readiness rows from the AGGREGATE rollup
      {
        key: "unit_readiness:standard-unit-04",
        jsonValue: { tier: "PRACTITIONER", losCovered: 2, losTotal: 2, weakestLoRef: null },
        numberValue: null,
      },
      {
        key: "unit_readiness:standard-unit-09",
        jsonValue: { tier: "DEVELOPING", losCovered: 1, losTotal: 1, weakestLoRef: "OUT-09-01" },
        numberValue: null,
      },
      // qualification_readiness row
      {
        key: "qualification_readiness:sias-cio-cto-v6",
        jsonValue: { tier: "PRACTITIONER", unitsCovered: 1, unitsTotal: 2, weakestUnitSlug: "standard-unit-09" },
        numberValue: null,
      },
      // per-LO mastery (for the LO tier breakdown)
      {
        key: "curriculum:cio-cto-revision-aid-v1:lo_mastery:standard-unit-04:OUT-04-01",
        jsonValue: null,
        numberValue: 0.7,
      },
      {
        key: "curriculum:cio-cto-revision-aid-v1:lo_mastery:standard-unit-04:OUT-04-02",
        jsonValue: null,
        numberValue: 0.6,
      },
      {
        key: "curriculum:cio-cto-revision-aid-v1:lo_mastery:standard-unit-09:OUT-09-01",
        jsonValue: null,
        numberValue: 0.3,
      },
      // skill_mastery row
      {
        key: "skill_mastery:SKILL-01",
        jsonValue: null,
        numberValue: 0.6,
      },
    ]);

    const res = await GET(new Request("http://localhost/api/student/qualification-progress"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.qualification.anchor).toBe("sias-cio-cto-v6");
    expect(body.qualification.displayName).toBe("The CIO/CTO Standard");
    expect(body.qualification.tier).toBe("PRACTITIONER");
    expect(body.qualification.unitsCovered).toBe(1);
    expect(body.qualification.unitsTotal).toBe(2);
    expect(body.qualification.weakestUnitSlug).toBe("standard-unit-09");

    // 2 units (catalog order — Unit 04 then Unit 09 by sortOrder).
    expect(body.units).toHaveLength(2);
    const unit04 = body.units.find((u: { moduleSlug: string }) => u.moduleSlug === "standard-unit-04");
    expect(unit04.displayName).toBe("IT Operations and Infrastructure");
    expect(unit04.tier).toBe("PRACTITIONER");
    expect(unit04.losCovered).toBe(2);
    expect(unit04.learningObjectives).toHaveLength(2);
    // LO tier classification reflects the lo_mastery numeric scores.
    expect(unit04.learningObjectives.find((lo: { ref: string }) => lo.ref === "OUT-04-01").tier).toBe("PRACTITIONER");

    const unit09 = body.units.find((u: { moduleSlug: string }) => u.moduleSlug === "standard-unit-09");
    expect(unit09.tier).toBe("DEVELOPING");
    expect(unit09.weakestLoRef).toBe("OUT-09-01");

    // Skills: 1 catalog entry, tier classified from skill_mastery row.
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0]).toEqual({ ref: "SKILL-01", name: "Stakeholder anticipation", tier: "PRACTITIONER" });

    // Next Best Step → weakest unit (09) + its weakest LO + the Playbook's
    // course type ("Revision Aid" from getCourseTypeDisplayName).
    expect(body.nextBestStep).toEqual({
      courseType: "Revision Aid",
      moduleSlug: "standard-unit-09",
      loRef: "OUT-09-01",
      reason: "weakest LO in your weakest Unit",
    });

    // Slice A returns an empty activity feed (Slice B work).
    expect(body.recentActivity).toEqual([]);
  });

  it("nextBestStep is null when qualification_readiness has no weakestUnitSlug (all units at qual tier)", async () => {
    mockPrisma.callerPlaybook.findFirst.mockResolvedValue({
      playbook: {
        id: "pb",
        config: {},
        playbookCurricula: [
          {
            role: "primary",
            curriculum: {
              id: "cur-1",
              slug: "cur-1",
              name: "C",
              qualificationAnchor: "anchor",
              qualificationBody: null,
              qualificationNumber: null,
              qualificationLevel: null,
            },
          },
        ],
      },
    });
    mockPrisma.curriculum.findMany
      .mockResolvedValueOnce([
        {
          id: "cur-1",
          slug: "cur-1",
          name: "C",
          qualificationAnchor: "anchor",
          qualificationBody: null,
          qualificationNumber: null,
          qualificationLevel: null,
        },
      ])
      .mockResolvedValueOnce([{ crossCuttingSkillsConfig: null }]);
    mockPrisma.curriculumModule.findMany.mockResolvedValue([
      {
        slug: "u-1",
        title: "U1",
        description: null,
        sortOrder: 1,
        learningObjectives: [{ ref: "L1", description: "x", performanceStatement: null, sortOrder: 0 }],
      },
    ]);
    mockPrisma.callerAttribute.findMany.mockResolvedValue([
      {
        key: "qualification_readiness:anchor",
        jsonValue: { tier: "PRACTITIONER", unitsCovered: 1, unitsTotal: 1, weakestUnitSlug: null },
        numberValue: null,
      },
    ]);

    const res = await GET(new Request("http://localhost/api/student/qualification-progress"));
    const body = await res.json();
    expect(body.nextBestStep).toBeNull();
  });
});

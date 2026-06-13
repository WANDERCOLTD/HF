/**
 * Tests for GET /api/courses/[courseId]/skills-rubric-calibration — SP3-A.
 *
 * Coverage:
 *   - Auth gate (OPERATOR+)
 *   - 404 when playbook missing
 *   - empty=true when no skills resolved
 *   - Per-skill payload threads tierScheme / tiers / bandThresholds from Parameter.config
 *   - MEASURE triggers matched to skills via notes-parsing (skillRef:SKILL-NN)
 *   - LEARN actions (parameterId === null) are filtered out of measure.actions
 *   - Cascade chips wired for skillTierMapping + skillScoringEmaHalfLifeDays
 *   - Variant-preset block reads Playbook.config for the 3 intrinsic knobs
 *   - measureSpecSlug returned even when spec carries no triggers
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
  parameter: { findMany: vi.fn() },
  analysisSpec: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/curriculum/resolve-skill", () => ({
  resolveAllSkillsForPlaybook: vi.fn(),
}));

vi.mock("@/lib/cascade/effective-value", () => ({
  resolveEffective: vi.fn(),
}));

type GetHandler = (
  req: unknown,
  ctx: { params: Promise<{ courseId: string }> },
) => Promise<Response>;

const COURSE_ID = "course-12345678-aaaa-bbbb-cccc-deadbeefdead";
const EXPECTED_SPEC_SLUG = `skill-measure-${COURSE_ID.slice(0, 8)}`;

describe("GET /api/courses/[id]/skills-rubric-calibration", () => {
  let GET: GetHandler;
  let mockResolveAllSkills: ReturnType<typeof vi.fn>;
  let mockResolveEffective: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: COURSE_ID,
      status: "ACTIVE",
      config: {},
    });
    mockPrisma.parameter.findMany.mockResolvedValue([]);
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(null);

    const skillMod = await import("@/lib/curriculum/resolve-skill");
    mockResolveAllSkills = skillMod.resolveAllSkillsForPlaybook as ReturnType<typeof vi.fn>;
    mockResolveAllSkills.mockResolvedValue([]);

    const cascadeMod = await import("@/lib/cascade/effective-value");
    mockResolveEffective = cascadeMod.resolveEffective as ReturnType<typeof vi.fn>;
    mockResolveEffective.mockResolvedValue({
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    });

    const mod = await import(
      "@/app/api/courses/[courseId]/skills-rubric-calibration/route"
    );
    GET = mod.GET as GetHandler;
  });

  function call() {
    return GET(
      new Request(`http://localhost/api/courses/${COURSE_ID}/skills-rubric-calibration`),
      { params: Promise.resolve({ courseId: COURSE_ID }) },
    );
  }

  it("returns 404 when the playbook is missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("returns empty=true when no skills resolve", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.empty).toBe(true);
    expect(json.skills).toEqual([]);
    expect(json.measureSpecSlug).toBeNull();
    expect(json.courseId).toBe(COURSE_ID);
  });

  it("threads tierScheme/tiers/bandThresholds from Parameter.config", async () => {
    mockResolveAllSkills.mockResolvedValue([
      {
        skillRef: "SKILL-01",
        parameterId: "param-speaking",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
    ]);
    mockPrisma.parameter.findMany.mockResolvedValue([
      {
        parameterId: "param-speaking",
        name: "Speaking",
        definition: "Spoken fluency descriptor",
        config: {
          tierScheme: ["emerging", "developing", "secure"],
          tiers: {
            emerging: "Halting speech",
            developing: "Connected speech",
            secure: "Fluent extended speech",
          },
          bandThresholds: { "7": "Practitioner-level fluency" },
        },
      },
    ]);

    const json = await (await call()).json();
    expect(json.skills).toHaveLength(1);
    const s = json.skills[0];
    expect(s.skillRef).toBe("SKILL-01");
    expect(s.parameterName).toBe("Speaking");
    expect(s.description).toBe("Spoken fluency descriptor");
    expect(s.tierScheme).toEqual(["emerging", "developing", "secure"]);
    expect(s.tiers.emerging).toBe("Halting speech");
    expect(s.bandThresholds).toEqual({ "7": "Practitioner-level fluency" });
    expect(s.targetValue).toBe(0.7);
  });

  it("matches MEASURE triggers to skills via notes parsing", async () => {
    mockResolveAllSkills.mockResolvedValue([
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
      {
        skillRef: "SKILL-02",
        parameterId: "p2",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
    ]);
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      slug: EXPECTED_SPEC_SLUG,
      triggers: [
        {
          name: "Speaking",
          given: "A learner is speaking on a topic",
          when: "They form sentences",
          then: "Score against the speaking rubric",
          notes: "skillRef:SKILL-01 (#417)",
          sortOrder: 0,
          actions: [
            { description: "Connected speech", parameterId: "p1", weight: 1.0, sortOrder: 0 },
          ],
        },
        {
          name: "Listening",
          given: "A learner hears prompts",
          when: "They respond",
          then: "Score against the listening rubric",
          notes: "skillRef:SKILL-02 (#417)",
          sortOrder: 1,
          actions: [
            { description: "Accurate response", parameterId: "p2", weight: 1.0, sortOrder: 0 },
          ],
        },
      ],
    });

    const json = await (await call()).json();
    expect(json.measureSpecSlug).toBe(EXPECTED_SPEC_SLUG);
    expect(json.skills[0].measure?.triggerName).toBe("Speaking");
    expect(json.skills[0].measure?.given).toMatch(/learner is speaking/);
    expect(json.skills[0].measure?.actions).toHaveLength(1);
    expect(json.skills[1].measure?.triggerName).toBe("Listening");
  });

  it("filters LEARN actions (parameterId=null) out of measure.actions", async () => {
    mockResolveAllSkills.mockResolvedValue([
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
    ]);
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      slug: EXPECTED_SPEC_SLUG,
      triggers: [
        {
          name: "Speaking",
          given: "g",
          when: "w",
          then: "t",
          notes: "skillRef:SKILL-01",
          sortOrder: 0,
          actions: [
            { description: "MEASURE action", parameterId: "p1", weight: 1.0, sortOrder: 0 },
            { description: "LEARN action", parameterId: null, weight: 0, sortOrder: 1 },
          ],
        },
      ],
    });

    const json = await (await call()).json();
    expect(json.skills[0].measure?.actions).toHaveLength(1);
    expect(json.skills[0].measure?.actions[0].description).toBe("MEASURE action");
  });

  it("falls back to skillRef when AnalysisTrigger.name is null", async () => {
    mockResolveAllSkills.mockResolvedValue([
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
    ]);
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      slug: EXPECTED_SPEC_SLUG,
      triggers: [
        {
          name: null,
          given: "g",
          when: "w",
          then: "t",
          notes: "skillRef:SKILL-01",
          sortOrder: 0,
          actions: [],
        },
      ],
    });

    const json = await (await call()).json();
    expect(json.skills[0].measure?.triggerName).toBe("SKILL-01");
  });

  it("returns measure=null for skills with no matching trigger", async () => {
    mockResolveAllSkills.mockResolvedValue([
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
    ]);
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      id: "spec-1",
      slug: EXPECTED_SPEC_SLUG,
      triggers: [
        // Notes don't reference SKILL-01 — orphan trigger.
        {
          name: "Other",
          given: "g",
          when: "w",
          then: "t",
          notes: "skillRef:SKILL-99",
          sortOrder: 0,
          actions: [],
        },
      ],
    });

    const json = await (await call()).json();
    expect(json.skills[0].measure).toBeNull();
  });

  it("dispatches resolveEffective for both mastery-policy knobs", async () => {
    mockResolveAllSkills.mockResolvedValue([
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
    ]);
    mockResolveEffective.mockResolvedValueOnce({
      value: { thresholds: {}, tierBands: {} },
      source: "DOMAIN",
      layers: [],
      isInherited: true,
      recommendedLayerForEdit: "PLAYBOOK",
    });
    mockResolveEffective.mockResolvedValueOnce({
      value: 14,
      source: "PLAYBOOK",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    });

    const json = await (await call()).json();

    expect(mockResolveEffective).toHaveBeenCalledTimes(2);
    expect(mockResolveEffective).toHaveBeenCalledWith({
      knobKey: "skillTierMapping",
      scopeChain: { playbookId: COURSE_ID },
    });
    expect(mockResolveEffective).toHaveBeenCalledWith({
      knobKey: "skillScoringEmaHalfLifeDays",
      scopeChain: { playbookId: COURSE_ID },
    });

    expect(json.masteryPolicyChips).toHaveLength(2);
    expect(json.masteryPolicyChips[0].knobKey).toBe("skillTierMapping");
    expect(json.masteryPolicyChips[1].knobKey).toBe("skillScoringEmaHalfLifeDays");
    expect(json.masteryPolicyChips[0].envelope.source).toBe("DOMAIN");
    expect(json.masteryPolicyChips[1].envelope.value).toBe(14);
  });

  it("threads the 3 variant-intrinsic knobs from Playbook.config without cascade", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: COURSE_ID,
      status: "ACTIVE",
      config: {
        useFreshMastery: true,
        maxMasteryTier: "practitioner",
        scoringMode: "evidence-first",
      },
    });
    mockResolveAllSkills.mockResolvedValue([
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
    ]);

    const json = await (await call()).json();
    expect(json.variantPreset).toEqual({
      useFreshMastery: true,
      maxMasteryTier: "practitioner",
      scoringMode: "evidence-first",
    });
  });

  it("variantPreset uses null when Playbook.config keys are unset or wrong type", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: COURSE_ID,
      status: "ACTIVE",
      config: { useFreshMastery: "not-a-bool", maxMasteryTier: 42 },
    });
    mockResolveAllSkills.mockResolvedValue([
      {
        skillRef: "SKILL-01",
        parameterId: "p1",
        targetValue: 0.7,
        tierScheme: ["emerging", "developing", "secure"],
      },
    ]);

    const json = await (await call()).json();
    expect(json.variantPreset).toEqual({
      useFreshMastery: null,
      maxMasteryTier: null,
      scoringMode: null,
    });
  });

  it("uses the correct MEASURE spec slug derived from courseId prefix", async () => {
    mockResolveAllSkills.mockResolvedValue([]);
    await call();
    expect(mockPrisma.analysisSpec.findUnique).toHaveBeenCalledWith({
      where: { slug: EXPECTED_SPEC_SLUG },
      select: expect.any(Object),
    });
  });
});

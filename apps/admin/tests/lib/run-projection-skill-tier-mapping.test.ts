/**
 * Pins #1630 wire-up inside `runProjectionForPlaybook`.
 *
 * The helper logic itself is pinned by
 * `derive-skill-tier-mapping-from-source.test.ts`. This file pins the
 * orchestrator-level cascade gate (Q3) + write/skip paths:
 *
 *   (a) Cascade source === SYSTEM AND derived non-null → write fires;
 *       `skillTierMappingDerived.written === true`.
 *   (b) Cascade source === DOMAIN → write SUPPRESSED; reason recorded.
 *   (c) Cascade source === PLAYBOOK → write SUPPRESSED; reason recorded.
 *   (d) Derived === null (no skills) → no cascade read; no write.
 *   (e) Cascade read throws → reason recorded; no write; orchestrator
 *       does NOT throw (degraded behaviour).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
const mockUpdatePlaybookConfig = vi.fn();
const mockResolveMasteryPolicyKnob = vi.fn();
const mockApplyProjection = vi.fn();
const mockProjectCourseReference = vi.fn();
const mockExtractText = vi.fn();
const mockStorageDownload = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playbookSource: { findMany: (...a: any[]) => mockFindMany(...a) },
  },
}));

vi.mock("@/lib/storage", () => ({
  getStorageAdapter: () => ({
    download: (...a: any[]) => mockStorageDownload(...a),
  }),
}));

vi.mock("@/lib/content-trust/extract-assertions", () => ({
  extractTextFromBuffer: (...a: any[]) => mockExtractText(...a),
}));

vi.mock("@/lib/wizard/project-course-reference", async () => {
  // Re-export the real KNOWN_TIER_SCHEMES + ParsedSkill type, mock the
  // projector function itself. The deriveSkillTierMappingFromSkills helper
  // imports KNOWN_TIER_SCHEMES from this module — keeping it real means
  // the helper actually runs against parsed skill arrays we synthesize.
  const actual = await vi.importActual<
    typeof import("@/lib/wizard/project-course-reference")
  >("@/lib/wizard/project-course-reference");
  return {
    ...actual,
    projectCourseReference: (...a: any[]) => mockProjectCourseReference(...a),
  };
});

vi.mock("@/lib/wizard/apply-projection", () => ({
  applyProjection: (...a: any[]) => mockApplyProjection(...a),
  writeBandThresholds: vi.fn().mockResolvedValue({
    parametersUpdated: 0,
    unmatchedCodes: [],
  }),
}));

vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: (...a: any[]) => mockUpdatePlaybookConfig(...a),
}));

vi.mock("@/lib/cascade/resolvers/mastery-policy", () => ({
  resolveMasteryPolicyKnob: (...a: any[]) =>
    mockResolveMasteryPolicyKnob(...a),
}));

import { runProjectionForPlaybook } from "@/lib/wizard/run-projection-for-playbook";

const CTO = ["foundation", "developing", "practitioner", "distinction"];

function makeSourceLink(id: string, name: string) {
  return {
    source: {
      id,
      name,
      mediaAssets: [{ storageKey: `key-${id}`, fileName: `${name}.md` }],
    },
  };
}

function makeCtoProjection() {
  return {
    skills: [
      { ref: "SKILL-01", name: "S1", tiers: {}, tierScheme: CTO },
      { ref: "SKILL-02", name: "S2", tiers: {}, tierScheme: CTO },
    ],
    parameters: [],
    behaviorTargets: [],
    curriculumModules: [],
    configPatch: { modulesAuthored: null, goalTemplates: [] },
    contentDeclaration: {},
    pedagogy: {},
    validationWarnings: [],
  };
}

describe("runProjectionForPlaybook — #1630 source-derived skillTierMapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockImplementation((args: any) => {
      const types = args.where.source.documentType;
      // Main loop: COURSE_REFERENCE family — return one source.
      if (typeof types === "object" && Array.isArray(types?.in)) {
        return Promise.resolve([makeSourceLink("src-1", "Course Ref")]);
      }
      // Rubric pass: no rubric docs.
      return Promise.resolve([]);
    });
    mockStorageDownload.mockResolvedValue(Buffer.from("doc text"));
    mockExtractText.mockResolvedValue({ text: "doc text" });
    mockProjectCourseReference.mockReturnValue(makeCtoProjection());
    mockApplyProjection.mockResolvedValue({
      parametersUpserted: 2,
      behaviorTargetsCreated: 0,
      behaviorTargetsUpdated: 0,
      behaviorTargetsRemoved: 0,
      curriculumModulesCreated: 0,
      curriculumModulesUpdated: 0,
      curriculumModulesRemoved: 0,
      learningObjectivesCreated: 0,
      learningObjectivesUpdated: 0,
      learningObjectivesRemoved: 0,
      goalTemplatesWritten: 0,
      noop: false,
    });
  });

  it("(a) writes skillTierMapping when cascade source === SYSTEM", async () => {
    mockResolveMasteryPolicyKnob.mockResolvedValue({
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    });
    mockUpdatePlaybookConfig.mockResolvedValue({});

    const result = await runProjectionForPlaybook("pb-1");

    expect(mockUpdatePlaybookConfig).toHaveBeenCalledTimes(1);
    const [playbookId, transformer, options] =
      mockUpdatePlaybookConfig.mock.calls[0];
    expect(playbookId).toBe("pb-1");
    expect(options.reason).toMatch(/source-derived/);

    const next = transformer({});
    expect(next.skillTierMapping.tierLabels).toEqual({
      approachingEmerging: "Foundation",
      emerging: "Developing",
      developing: "Practitioner",
      secure: "Distinction",
    });

    expect(result.skillTierMappingDerived).toEqual({
      derivedScheme: "cto",
      written: true,
    });
  });

  it("(b) suppresses write when cascade source === DOMAIN", async () => {
    mockResolveMasteryPolicyKnob.mockResolvedValue({
      value: { thresholds: {}, tierBands: {} },
      source: "DOMAIN",
      layers: [],
      isInherited: true,
      recommendedLayerForEdit: "PLAYBOOK",
    });

    const result = await runProjectionForPlaybook("pb-1");

    expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    expect(result.skillTierMappingDerived.written).toBe(false);
    expect(result.skillTierMappingDerived.derivedScheme).toBe("cto");
    expect(result.skillTierMappingDerived.reason).toMatch(/DOMAIN/);
  });

  it("(c) suppresses write when cascade source === PLAYBOOK", async () => {
    mockResolveMasteryPolicyKnob.mockResolvedValue({
      value: { thresholds: {}, tierBands: {} },
      source: "PLAYBOOK",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    });

    const result = await runProjectionForPlaybook("pb-1");

    expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    expect(result.skillTierMappingDerived.written).toBe(false);
    expect(result.skillTierMappingDerived.reason).toMatch(/PLAYBOOK/);
  });

  it("(d) skips cascade read entirely when no skills are parsed (derived === null)", async () => {
    mockProjectCourseReference.mockReturnValue({
      ...makeCtoProjection(),
      skills: [],
    });

    const result = await runProjectionForPlaybook("pb-1");

    expect(mockResolveMasteryPolicyKnob).not.toHaveBeenCalled();
    expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    expect(result.skillTierMappingDerived).toEqual({
      derivedScheme: null,
      written: false,
    });
  });

  it("(e) records reason and does not throw when cascade read fails", async () => {
    mockResolveMasteryPolicyKnob.mockRejectedValue(
      new Error("playbook not found"),
    );

    const result = await runProjectionForPlaybook("pb-1");

    expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    expect(result.skillTierMappingDerived.written).toBe(false);
    expect(result.skillTierMappingDerived.reason).toMatch(/cascade-read-failed/);
  });
});

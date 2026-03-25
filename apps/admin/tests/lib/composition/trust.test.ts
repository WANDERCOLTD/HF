import { describe, it, expect } from "vitest";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";

// Trigger transform registration
import "@/lib/prompt/composition/transforms/trust";

// --- helpers ---

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    loadedData: {
      caller: null,
      memories: [],
      personality: null,
      learnerProfile: null,
      recentCalls: [],
      callCount: 0,
      behaviorTargets: [],
      callerTargets: [],
      callerAttributes: [],
      goals: [],
      playbooks: [],
      systemSpecs: [],
      onboardingSpec: null,
    },
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      modules: [],
      isFirstCall: false,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: null,
      reviewType: "",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(): CompositionSectionDef {
  return {
    id: "trust",
    name: "Content Trust",
    priority: 6,
    dataSource: "_assembled",
    activateWhen: { condition: "curriculumDataExists" },
    fallback: { action: "null" },
    transform: "computeTrustContext",
    outputKey: "contentTrust",
  };
}

// =====================================================
// computeTrustContext transform
// =====================================================

describe("computeTrustContext transform", () => {
  it("is registered", () => {
    expect(getTransform("computeTrustContext")).toBeDefined();
  });

  it("returns empty trust data when no content spec", () => {
    const ctx = makeContext();
    const result = getTransform("computeTrustContext")!(null, ctx, makeSectionDef());

    expect(result.hasTrustData).toBe(false);
    expect(result.primarySource).toBeNull();
    expect(result.freshnessWarnings).toEqual([]);
  });

  it("returns empty trust data when content spec has no sourceAuthority", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: null,
    });

    const result = getTransform("computeTrustContext")!(null, ctx, makeSectionDef());
    expect(result.hasTrustData).toBe(false);
  });

  it("builds trust context from sourceAuthority with primary source", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: null,
              secondarySources: [],
            },
          },
          description: null,
        },
        voiceSpec: null,
      },
    });

    const result = getTransform("computeTrustContext")!(null, ctx, makeSectionDef());

    expect(result.hasTrustData).toBe(true);
    expect(result.trustLevel).toBe("ACCREDITED_MATERIAL");
    expect(result.primarySource.name).toBe("Wealth & Finance Syllabus");
    expect(result.contentAuthority).toContain("CERTIFIED MATERIALS");
    expect(result.contentAuthority).toContain("ACCREDITED MATERIAL");
    expect(result.trustRules).toContain("TRUST RULES");
  });

  it("includes secondary sources in content authority", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: null,
              secondarySources: [
                { slug: "ref-1", name: "Reference Book", trustLevel: "EXPERT_CURATED", authors: ["Author A"], edition: "3rd Ed." },
              ],
            },
          },
          description: null,
        },
        voiceSpec: null,
      },
    });

    const result = getTransform("computeTrustContext")!(null, ctx, makeSectionDef());
    expect(result.secondarySources).toHaveLength(1);
    expect(result.contentAuthority).toContain("Reference Book");
    expect(result.contentAuthority).toContain("Author A");
    expect(result.contentAuthority).toContain("3rd Ed.");
  });

  it("detects expired content in freshness warnings", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30);

    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: null,
              secondarySources: [],
            },
          },
          description: null,
        },
        voiceSpec: null,
      },
    });

    const result = getTransform("computeTrustContext")!(null, ctx, makeSectionDef());
    expect(result.freshnessWarnings.length).toBeGreaterThan(0);
    expect(result.freshnessWarnings[0].severity).toBe("expired");
  });

  it("detects expiring content (within 60 days)", () => {
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 30);

    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: null,
              secondarySources: [],
            },
          },
          description: null,
        },
        voiceSpec: null,
      },
    });

    const result = getTransform("computeTrustContext")!(null, ctx, makeSectionDef());
    expect(result.freshnessWarnings.length).toBeGreaterThan(0);
    expect(result.freshnessWarnings[0].severity).toBe("expiring");
  });

  it("builds reference card for current module with sourceRefs", () => {
    const ctx = makeContext({
      resolvedSpecs: {
        identitySpec: null,
              secondarySources: [],
            },
          },
          description: null,
        },
        voiceSpec: null,
      },
      sharedState: {
        ...makeContext().sharedState,
        nextModule: {
          slug: "m1",
          name: "Module 1",
          content: {
            sourceRefs: [
              { sourceSlug: "main", ref: "Chapter 3, p.45", trustLevel: "ACCREDITED_MATERIAL" },
            ],
          },
        },
      },
    });

    const result = getTransform("computeTrustContext")!(null, ctx, makeSectionDef());
    expect(result.referenceCard).toContain("REFERENCE CARD");
    expect(result.referenceCard).toContain("Chapter 3, p.45");
    expect(result.referenceSourceRefs).toHaveLength(1);
  });

  describe("subject-based trust fallback", () => {
    it("builds trust from subject sources when no sourceAuthority", () => {
      const ctx = makeContext({
        resolvedSpecs: {
          identitySpec: null,
        loadedData: {
          ...makeContext().loadedData,
          subjectSources: {
            subjects: [{
              id: "s1",
              slug: "wnf",
              name: "Wealth and Finance",
              defaultTrustLevel: "ACCREDITED_MATERIAL",
              qualificationRef: "WNF-001",
              sources: [
                {
                  slug: "syllabus-1",
                  name: "WNF Syllabus",
                  trustLevel: "ACCREDITED_MATERIAL",
                  tags: ["syllabus"],
                  publisherOrg: "LIBF",
                  accreditingBody: null,
                  qualificationRef: null,
                  validUntil: null,
                  isActive: true,
                },
                {
                  slug: "textbook-1",
                  name: "Textbook",
                  trustLevel: "PUBLISHED_REFERENCE",
                  tags: ["textbook"],
                  publisherOrg: "Publisher",
                  accreditingBody: null,
                  qualificationRef: null,
                  validUntil: null,
                  isActive: true,
                },
              ],
              curriculum: null,
            }],
          },
        },
      });

      const result = getTransform("computeTrustContext")!(null, ctx, makeSectionDef());
      expect(result.hasTrustData).toBe(true);
      expect(result.primarySource).not.toBeNull();
      expect(result.primarySource.name).toBe("WNF Syllabus");
      expect(result.secondarySources).toHaveLength(1);
      expect(result.contentAuthority).toContain("Wealth and Finance");
    });
  });
});

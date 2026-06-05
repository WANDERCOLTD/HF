/**
 * Tests for `lib/curriculum/display-names.ts` — #1098 Slice A C3.
 *
 * Covers: catalog load (cross-sibling merge), the four resolvers, the
 * course-type inference table, and the slug-strip fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  curriculum: { findMany: vi.fn() },
  curriculumModule: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("display-names — #1098 Slice A C3", () => {
  let mod: typeof import("@/lib/curriculum/display-names");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/curriculum/display-names");
  });

  describe("stripSlugToTitle — fallback humaniser", () => {
    it("turns kebab-case into Title Case with short tokens upper-cased", () => {
      expect(mod.stripSlugToTitle("standard-unit-04-it-operations-infrastructure")).toBe(
        "Standard Unit 04 IT Operations Infrastructure",
      );
    });
    it("handles underscores too", () => {
      expect(mod.stripSlugToTitle("module_alpha_beta")).toBe("Module Alpha Beta");
    });
    it("returns empty string for empty input", () => {
      expect(mod.stripSlugToTitle("")).toBe("");
    });
  });

  describe("getCourseTypeDisplayName — inference table", () => {
    it("explicit courseTypeLabel override wins", () => {
      expect(mod.getCourseTypeDisplayName({ courseTypeLabel: "Workshop" })).toBe("Workshop");
    });
    it("useFreshMastery → Exam Assessment", () => {
      expect(mod.getCourseTypeDisplayName({ useFreshMastery: true })).toBe("Exam Assessment");
    });
    it("maxMasteryTier=DEVELOPING → Pop Quiz", () => {
      expect(mod.getCourseTypeDisplayName({ maxMasteryTier: "DEVELOPING" })).toBe("Pop Quiz");
    });
    it("maxMasteryTier=FOUNDATION → Pop Quiz (any cap below PRACTITIONER)", () => {
      expect(mod.getCourseTypeDisplayName({ maxMasteryTier: "FOUNDATION" })).toBe("Pop Quiz");
    });
    it("maxMasteryTier=PRACTITIONER (or absent) → Revision Aid", () => {
      expect(mod.getCourseTypeDisplayName({ maxMasteryTier: "PRACTITIONER" })).toBe("Revision Aid");
      expect(mod.getCourseTypeDisplayName({})).toBe("Revision Aid");
      expect(mod.getCourseTypeDisplayName(null)).toBe("Revision Aid");
      expect(mod.getCourseTypeDisplayName(undefined)).toBe("Revision Aid");
    });
    it("courseTypeLabel beats useFreshMastery + maxMasteryTier", () => {
      expect(
        mod.getCourseTypeDisplayName({
          courseTypeLabel: "Diagnostic",
          useFreshMastery: true,
          maxMasteryTier: "DEVELOPING",
        }),
      ).toBe("Diagnostic");
    });
  });

  describe("loadQualificationCatalog — cross-sibling merge", () => {
    it("returns null when anchor is null/empty", async () => {
      mockPrisma.curriculum.findMany.mockResolvedValue([]);
      expect(await mod.loadQualificationCatalog(null)).toBeNull();
      expect(await mod.loadQualificationCatalog("")).toBeNull();
    });

    it("returns null when no siblings carry the anchor", async () => {
      mockPrisma.curriculum.findMany.mockResolvedValue([]);
      expect(await mod.loadQualificationCatalog("nonexistent-anchor")).toBeNull();
    });

    it("merges modules + LOs deduped across siblings (Slice 2B.3 parity guard)", async () => {
      // findSiblingCurricula → 2 siblings.
      mockPrisma.curriculum.findMany.mockResolvedValueOnce([
        {
          id: "cur-revision",
          slug: "cio-cto-revision-aid-v1",
          name: "Revision Aid",
          qualificationAnchor: "sias-cio-cto-v6",
          qualificationBody: null,
          qualificationNumber: null,
          qualificationLevel: null,
        },
        {
          id: "cur-pop",
          slug: "cio-cto-pop-quiz-v1",
          name: "Pop Quiz",
          qualificationAnchor: "sias-cio-cto-v6",
          qualificationBody: null,
          qualificationNumber: null,
          qualificationLevel: null,
        },
      ]);
      // Each sibling declares the same module + LOs (Slice 2B.3 guarantee).
      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        {
          slug: "standard-unit-04",
          title: "IT Operations and Infrastructure",
          description: "Unit 4 of the Standard.",
          sortOrder: 4,
          learningObjectives: [
            { ref: "OUT-04-01", description: "Plan capacity", performanceStatement: null, sortOrder: 0 },
            { ref: "OUT-04-02", description: "Recover from incidents", performanceStatement: "Learner can run a DR drill", sortOrder: 1 },
          ],
        },
        // Same module slug from the sibling — must NOT duplicate entries.
        {
          slug: "standard-unit-04",
          title: "IT Operations and Infrastructure",
          description: "Unit 4 of the Standard.",
          sortOrder: 4,
          learningObjectives: [
            { ref: "OUT-04-01", description: "Plan capacity", performanceStatement: null, sortOrder: 0 },
            { ref: "OUT-04-02", description: "Recover from incidents", performanceStatement: "Learner can run a DR drill", sortOrder: 1 },
          ],
        },
      ]);
      mockPrisma.curriculum.findMany.mockResolvedValueOnce([
        { crossCuttingSkillsConfig: null },
        { crossCuttingSkillsConfig: null },
      ]);

      const cat = await mod.loadQualificationCatalog("sias-cio-cto-v6");
      expect(cat).not.toBeNull();
      expect(cat!.units.size).toBe(1);
      const unit = cat!.units.get("standard-unit-04");
      expect(unit?.title).toBe("IT Operations and Infrastructure");
      expect(unit?.learningObjectives.length).toBe(2);
      expect(unit?.learningObjectives.map((l) => l.ref)).toEqual(["OUT-04-01", "OUT-04-02"]);
      // loToModule index built correctly.
      expect(cat!.loToModule.get("OUT-04-01")).toBe("standard-unit-04");
      expect(cat!.loToModule.get("OUT-04-02")).toBe("standard-unit-04");
    });

    it("populates the skill catalog from crossCuttingSkillsConfig JSON", async () => {
      mockPrisma.curriculum.findMany.mockResolvedValueOnce([
        {
          id: "cur-1",
          slug: "cur-1",
          name: "Course",
          qualificationAnchor: "anchor",
          qualificationBody: null,
          qualificationNumber: null,
          qualificationLevel: null,
        },
      ]);
      mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
      mockPrisma.curriculum.findMany.mockResolvedValueOnce([
        {
          crossCuttingSkillsConfig: {
            skills: [
              { ref: "SKILL-01", name: "Stakeholder anticipation" },
              { ref: "SKILL-02", name: "Risk articulation", tierRubric: { FOUNDATION: "spots risk" } },
              { ref: "SKILL-bad" }, // missing name — skipped
              { name: "skill-no-ref" }, // missing ref — skipped
            ],
          },
        },
      ]);

      const cat = await mod.loadQualificationCatalog("anchor");
      expect(cat?.skills.size).toBe(2);
      expect(cat?.skills.get("SKILL-01")?.name).toBe("Stakeholder anticipation");
      expect(cat?.skills.get("SKILL-02")?.tierRubric).toEqual({ FOUNDATION: "spots risk" });
    });
  });

  describe("sync resolvers", () => {
    const catalog = {
      anchor: "sias-cio-cto-v6",
      units: new Map([
        [
          "standard-unit-04",
          {
            slug: "standard-unit-04",
            title: "IT Operations and Infrastructure",
            description: null,
            sortOrder: 4,
            learningObjectives: [
              {
                ref: "OUT-04-03",
                description: "Disaster Recovery & Business Continuity",
                performanceStatement: "The learner can run a DR test from scratch",
                sortOrder: 2,
              },
            ],
          },
        ],
      ]),
      loToModule: new Map([["OUT-04-03", "standard-unit-04"]]),
      skills: new Map([
        ["SKILL-03", { ref: "SKILL-03", name: "Commercial framing", tierRubric: null }],
      ]),
    } satisfies Awaited<ReturnType<typeof mod.loadQualificationCatalog>>;

    it("getUnitDisplayName returns the catalog title", () => {
      expect(mod.getUnitDisplayName("standard-unit-04", catalog)).toBe(
        "IT Operations and Infrastructure",
      );
    });
    it("getUnitDisplayName falls back to slug-strip when not in catalog", () => {
      expect(mod.getUnitDisplayName("missing-unit-99", catalog)).toBe("Missing Unit 99");
    });
    it("getLoDisplayName returns verbatim description (regulated wording)", () => {
      expect(mod.getLoDisplayName("OUT-04-03", catalog)).toBe(
        "Disaster Recovery & Business Continuity",
      );
    });
    it("getLoDisplayName resolves moduleSlug from loToModule when not supplied", () => {
      expect(mod.getLoDisplayName("OUT-04-03", catalog)).toBe(
        "Disaster Recovery & Business Continuity",
      );
    });
    it("getLoDisplayName falls back to ref when not in catalog", () => {
      expect(mod.getLoDisplayName("OUT-09-99", catalog)).toBe("OUT-09-99");
    });
    it("getLoLearnerStatement prefers performanceStatement when present", () => {
      expect(mod.getLoLearnerStatement("OUT-04-03", catalog)).toBe(
        "The learner can run a DR test from scratch",
      );
    });
    it("getSkillDisplayName returns the catalog name", () => {
      expect(mod.getSkillDisplayName("SKILL-03", catalog)).toBe("Commercial framing");
    });
    it("getSkillDisplayName falls back to the ref when no catalog entry", () => {
      expect(mod.getSkillDisplayName("SKILL-99", catalog)).toBe("SKILL-99");
    });
    it("resolvers return ref/slug when catalog is null (graceful)", () => {
      expect(mod.getUnitDisplayName("any-slug", null)).toBe("Any Slug");
      expect(mod.getLoDisplayName("ref-x", null)).toBe("ref-x");
      expect(mod.getSkillDisplayName("SKILL-x", null)).toBe("SKILL-x");
    });
  });
});

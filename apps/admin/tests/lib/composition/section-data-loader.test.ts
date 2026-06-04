/**
 * SectionDataLoader — tutor-only document filtering (L1 fix)
 *
 * Tests for the `visualAids` and `subjectSources` loaders ensure
 * COURSE_REFERENCE / LESSON_PLAN / QUESTION_BANK / POLICY_DOCUMENT documents
 * are NOT surfaced as a learner-shareable media palette.
 *
 * Refs CONTENT-PIPELINE.md §8 L1.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/prisma BEFORE importing the loader registry — the loader closes
// over the prisma singleton at import time.
vi.mock("@/lib/prisma", () => {
  const mock = {
    subjectMedia: { findMany: vi.fn() },
    assertionMedia: { findMany: vi.fn() },
    subject: { findMany: vi.fn() },
    curriculum: { findFirst: vi.fn() },
    caller: { findUnique: vi.fn() },
    callerPlaybook: { findMany: vi.fn() },
    playbookSubject: { findMany: vi.fn() },
    playbookSource: { findMany: vi.fn() },
    behaviorTarget: { findMany: vi.fn() },
    contentAssertion: { findMany: vi.fn() },
    // Added 2026-06-04: SectionDataLoader subjectSources loader reads
    // prisma.playbookCurriculum.findFirst (peer #1034). Without this
    // mock the tutorOnly-hint test 500s. Returns null → loader falls
    // through to its existing curriculum-by-name path.
    playbookCurriculum: { findFirst: vi.fn() },
  };
  return { prisma: mock, db: () => mock };
});

import { prisma } from "@/lib/prisma";
import { getLoader } from "@/lib/prompt/composition/SectionDataLoader";

const scope = {
  domainId: "d1",
  playbookId: "pb1",
  subjectIds: ["s1"],
  subjects: [
    {
      id: "s1",
      teachingDepth: null,
      sources: [],
    },
  ],
  scoped: true,
} as const;

describe("visualAids loader — documentType filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes media whose source is COURSE_REFERENCE", async () => {
    (prisma.subjectMedia.findMany as any).mockResolvedValue([
      {
        sortOrder: 0,
        media: {
          id: "media-textbook",
          fileName: "diagram.png",
          captionText: "Figure 1",
          figureRef: "Figure 1",
          mimeType: "image/png",
          pageNumber: 3,
          source: { documentType: "TEXTBOOK" },
        },
      },
      {
        sortOrder: 1,
        media: {
          id: "media-courseref",
          fileName: "course-ref.png",
          captionText: null,
          figureRef: null,
          mimeType: "image/png",
          pageNumber: null,
          source: { documentType: "COURSE_REFERENCE" },
        },
      },
    ]);
    (prisma.assertionMedia.findMany as any).mockResolvedValue([]);

    const visualAids = getLoader("visualAids");
    expect(visualAids).toBeDefined();
    const result = await visualAids!("caller-1", { contentScope: scope });

    expect(result).toHaveLength(1);
    expect(result[0].mediaId).toBe("media-textbook");
  });

  it("excludes LESSON_PLAN and QUESTION_BANK media", async () => {
    (prisma.subjectMedia.findMany as any).mockResolvedValue([
      {
        sortOrder: 0,
        media: {
          id: "m-lesson",
          fileName: "lesson-plan.png",
          captionText: null,
          figureRef: null,
          mimeType: "image/png",
          pageNumber: null,
          source: { documentType: "LESSON_PLAN" },
        },
      },
      {
        sortOrder: 1,
        media: {
          id: "m-qbank",
          fileName: "qbank.png",
          captionText: null,
          figureRef: null,
          mimeType: "image/png",
          pageNumber: null,
          source: { documentType: "QUESTION_BANK" },
        },
      },
      {
        sortOrder: 2,
        media: {
          id: "m-policy",
          fileName: "policy.png",
          captionText: null,
          figureRef: null,
          mimeType: "image/png",
          pageNumber: null,
          source: { documentType: "POLICY_DOCUMENT" },
        },
      },
      {
        sortOrder: 3,
        media: {
          id: "m-passage",
          fileName: "passage.png",
          captionText: null,
          figureRef: null,
          mimeType: "image/png",
          pageNumber: null,
          source: { documentType: "READING_PASSAGE" },
        },
      },
    ]);
    (prisma.assertionMedia.findMany as any).mockResolvedValue([]);

    const result = await getLoader("visualAids")!("c1", { contentScope: scope });
    expect(result.map((r: any) => r.mediaId)).toEqual(["m-passage"]);
  });

  it("includes media with null source (manual upload, no documentType)", async () => {
    (prisma.subjectMedia.findMany as any).mockResolvedValue([
      {
        sortOrder: 0,
        media: {
          id: "m-manual",
          fileName: "upload.png",
          captionText: null,
          figureRef: null,
          mimeType: "image/png",
          pageNumber: null,
          source: null,
        },
      },
    ]);
    (prisma.assertionMedia.findMany as any).mockResolvedValue([]);

    const result = await getLoader("visualAids")!("c1", { contentScope: scope });
    expect(result).toHaveLength(1);
  });
});

describe("subjectSources loader — documentType + tutorOnly hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tags COURSE_REFERENCE sources as tutorOnly=true and TEXTBOOK as tutorOnly=false", async () => {
    (prisma.subject.findMany as any).mockResolvedValue([
      {
        id: "s1",
        slug: "ielts",
        name: "IELTS Speaking",
        defaultTrustLevel: "EXPERT_CURATED",
        qualificationRef: null,
        teachingProfile: null,
        teachingOverrides: null,
        sources: [
          {
            trustLevelOverride: null,
            tags: ["content"],
            source: {
              id: "src-textbook",
              slug: "textbook",
              name: "Textbook",
              documentType: "TEXTBOOK",
              trustLevel: "EXPERT_CURATED",
              publisherOrg: null,
              accreditingBody: null,
              qualificationRef: null,
              validUntil: null,
              isActive: true,
            },
          },
          {
            trustLevelOverride: null,
            tags: ["content"],
            source: {
              id: "src-cref",
              slug: "course-ref",
              name: "course-ref.md",
              documentType: "COURSE_REFERENCE",
              trustLevel: "EXPERT_CURATED",
              publisherOrg: null,
              accreditingBody: null,
              qualificationRef: null,
              validUntil: null,
              isActive: true,
            },
          },
        ],
        curricula: [],
      },
    ]);
    (prisma.curriculum.findFirst as any).mockResolvedValue(null);

    const result = await getLoader("subjectSources")!("c1", { contentScope: scope });
    expect(result).not.toBeNull();
    const sources = result.subjects[0].sources;
    const textbook = sources.find((s: any) => s.slug === "textbook");
    const cref = sources.find((s: any) => s.slug === "course-ref");
    expect(textbook.tutorOnly).toBe(false);
    expect(cref.tutorOnly).toBe(true);
    expect(textbook.documentType).toBe("TEXTBOOK");
    expect(cref.documentType).toBe("COURSE_REFERENCE");
  });
});

describe("behaviorTargets loader — #713 bug 4 cross-learner scope=CALLER filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters scope=CALLER targets to those whose callerIdentity belongs to the caller", async () => {
    vi.mocked(prisma.behaviorTarget.findMany).mockResolvedValue([]);
    await getLoader("behaviorTargets")!("caller-A");

    // Inspect the `where` clause that was passed to prisma
    const call = vi.mocked(prisma.behaviorTarget.findMany).mock.calls[0][0];
    expect(call?.where).toMatchObject({ effectiveUntil: null });
    expect(call?.where?.OR).toEqual([
      { scope: { not: "CALLER" } },
      { callerIdentity: { callerId: "caller-A" } },
    ]);
  });

  it("does not surface scope=CALLER targets belonging to other callers", async () => {
    type OrClause = { scope?: { not?: string }; callerIdentity?: { callerId?: string } };
    type FindManyArgs = { where?: { OR?: OrClause[] } };
    // Simulate Bob asking for his targets; the DB filter should ensure
    // Alice's scope=CALLER row never even enters the result set.
    vi.mocked(prisma.behaviorTarget.findMany).mockImplementation(((args: FindManyArgs) => {
      const all = [
        // Alice's per-caller tune
        { id: "bt-alice", scope: "CALLER", targetValue: 0.9, callerIdentityId: "ident-alice", callerIdentity: { callerId: "alice" }, parameter: { parameterId: "BEH-WARMTH" } },
        // PLAYBOOK target (broad — should appear for Bob)
        { id: "bt-pb", scope: "PLAYBOOK", targetValue: 0.4, playbookId: "pb1", parameter: { parameterId: "BEH-WARMTH" } },
        // Bob's own per-caller tune
        { id: "bt-bob", scope: "CALLER", targetValue: 0.7, callerIdentityId: "ident-bob", callerIdentity: { callerId: "bob" }, parameter: { parameterId: "BEH-WARMTH" } },
      ];
      // Mimic the OR filter from the real implementation
      const orClauses = args?.where?.OR ?? [];
      return Promise.resolve(
        all.filter((t) => {
          if (orClauses.length === 0) return true;
          return orClauses.some((c: OrClause) => {
            if (c.scope?.not && t.scope !== c.scope.not) return true;
            if (c.callerIdentity?.callerId && t.callerIdentity?.callerId === c.callerIdentity.callerId) return true;
            return false;
          });
        }),
      );
    }) as never);

    const bobTargets = await getLoader("behaviorTargets")!("bob");
    const ids = (bobTargets as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain("bt-bob");      // Bob sees his own
    expect(ids).toContain("bt-pb");        // Playbook target still applies broadly
    expect(ids).not.toContain("bt-alice"); // Alice's row is filtered out
  });
});

/**
 * #814 story 2 — teachingDepth as a typed sibling field on the loader result.
 *
 * Before this refactor the loader stashed teachingDepth as `(result as any).__teachingDepth`
 * on the assertions array. Any downstream `.filter()` / `.map()` / `.slice()` silently
 * lost it because array property assignment doesn't survive functional operations.
 * The four cases below pin the new contract: `{ assertions, teachingDepth }` shape.
 */
describe("curriculumAssertions loader — teachingDepth typed field (#814)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Shared helper — minimal ContentAssertion mock row matching the loader's select shape.
  function makeRawAssertion(id: string, sourceId = "src-A") {
    return {
      id,
      assertion: `assertion ${id}`,
      category: "fact",
      chapter: null,
      section: null,
      pageRef: null,
      tags: [],
      trustLevel: "ACCREDITED_MATERIAL",
      examRelevance: 0.5,
      learningOutcomeRef: null,
      learningObjectiveId: null,
      depth: 1,
      parentId: null,
      orderIndex: 0,
      topicSlug: null,
      teachMethod: null,
      sourceId,
      source: { name: "Source A", trustLevel: "ACCREDITED_MATERIAL" },
    };
  }

  // Scope helper — one subject, one source, configurable teachingDepth.
  function makeScope(teachingDepth: number | null) {
    return {
      domainId: "d1",
      playbookId: "pb1",
      subjectIds: ["s1"],
      subjects: [
        {
          id: "s1",
          teachingDepth,
          sources: [
            {
              subjectSourceId: "ss-1",
              sourceId: "src-A",
              documentType: "TEXTBOOK",
              sortOrder: 0,
              tags: [],
            },
          ],
        },
      ],
      scoped: true,
    };
  }

  it("Case 1 — returns the playbook-configured teachingDepth on the result object", async () => {
    vi.mocked(prisma.contentAssertion.findMany).mockResolvedValue([
      makeRawAssertion("a1"),
      makeRawAssertion("a2"),
    ] as never);

    const loader = getLoader("curriculumAssertions");
    expect(loader).toBeDefined();
    const result = await loader!("caller-1", { contentScope: makeScope(3) });

    expect(result).toEqual(
      expect.objectContaining({
        teachingDepth: 3,
        assertions: expect.any(Array),
      }),
    );
    expect(result.assertions).toHaveLength(2);
  });

  it("Case 2 — defaults teachingDepth to null when no subject sets it", async () => {
    vi.mocked(prisma.contentAssertion.findMany).mockResolvedValue([
      makeRawAssertion("a1"),
    ] as never);

    const result = await getLoader("curriculumAssertions")!(
      "caller-1",
      { contentScope: makeScope(null) },
    );

    expect(result.teachingDepth).toBeNull();
    expect(result.assertions).toHaveLength(1);
  });

  it("Case 3 — teachingDepth survives a downstream .filter() on the result (regression for the array-property hack)", async () => {
    vi.mocked(prisma.contentAssertion.findMany).mockResolvedValue([
      makeRawAssertion("a1"),
      makeRawAssertion("a2"),
      makeRawAssertion("a3"),
    ] as never);

    const result = await getLoader("curriculumAssertions")!(
      "caller-1",
      { contentScope: makeScope(2) },
    );

    // The exact downstream pattern that silently dropped __teachingDepth pre-refactor:
    // filter the assertions array and check the metadata is still accessible.
    const filtered = result.assertions.filter((a: { id: string }) => a.id !== "a2");
    expect(filtered).toHaveLength(2);
    // teachingDepth lives on the result object — `.filter()` on `.assertions`
    // does NOT touch it. This would FAIL under the legacy array-property scheme.
    expect(result.teachingDepth).toBe(2);
  });

  it("Case 4 — teachingDepth survives a downstream .map() on the result", async () => {
    vi.mocked(prisma.contentAssertion.findMany).mockResolvedValue([
      makeRawAssertion("a1"),
      makeRawAssertion("a2"),
    ] as never);

    const result = await getLoader("curriculumAssertions")!(
      "caller-1",
      { contentScope: makeScope(4) },
    );

    const mapped = result.assertions.map((a: { id: string; assertion: string }) => ({
      id: a.id,
      text: a.assertion.toUpperCase(),
    }));
    expect(mapped).toHaveLength(2);
    expect(mapped[0].text).toBe("ASSERTION A1");
    // teachingDepth is unaffected — it's a sibling field, not an array prop.
    expect(result.teachingDepth).toBe(4);
  });
});

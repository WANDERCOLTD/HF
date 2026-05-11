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

/**
 * #1167 — retrieval-question-selector source resolution.
 *
 * The legacy filter `source: { curricula: { some: { id: curriculumId } } }`
 * only matched ContentSources where `Curriculum.primarySourceId = source.id`
 * (the `@relation("CurriculumPrimarySource")` back-relation). For every
 * modern course that attaches Question Banks via `PlaybookSource` — i.e.
 * CIO/CTO Standard variants + every product family on the market test —
 * that filter silently returned zero questions.
 *
 * Fix: when the caller passes `playbookId`, resolve sources via
 * `getSourceIdsForPlaybook` (the canonical helper that walks
 * `PlaybookSource → ContentSource`). Fall back to the legacy filter only
 * when `playbookId` is missing (back-compat for callers not yet updated).
 *
 * These vitests pin the contract without spinning up the DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  contentQuestion: { findMany: vi.fn() },
};
const mockGetSourceIdsForPlaybook = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/knowledge/domain-sources", () => ({
  getSourceIdsForPlaybook: (...args: unknown[]) => mockGetSourceIdsForPlaybook(...args),
}));

describe("selectRetrievalQuestions — #1167 source resolution", () => {
  let selectRetrievalQuestions: typeof import("@/lib/assessment/retrieval-question-selector").selectRetrievalQuestions;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/assessment/retrieval-question-selector");
    selectRetrievalQuestions = mod.selectRetrievalQuestions;
  });

  it("uses getSourceIdsForPlaybook when playbookId is provided", async () => {
    mockGetSourceIdsForPlaybook.mockResolvedValue(["src-a", "src-b", "src-c"]);
    mockPrisma.contentQuestion.findMany.mockResolvedValue([]);

    await selectRetrievalQuestions({
      curriculumId: "cur-1",
      playbookId: "pb-revision-aid",
      outcomeRefs: [],
      count: 5,
      bloomFloor: "REMEMBER",
      recentQuestionIds: [],
      channel: "text",
    });

    expect(mockGetSourceIdsForPlaybook).toHaveBeenCalledWith("pb-revision-aid");
    // Verify the actual Prisma WHERE used the source-id filter (not the
    // broken curricula relation filter).
    const where = mockPrisma.contentQuestion.findMany.mock.calls.at(-1)?.[0].where;
    expect(where.sourceId).toEqual({ in: ["src-a", "src-b", "src-c"] });
    expect(where.source).toBeUndefined();
  });

  it("falls back to legacy curricula relation filter when playbookId is null", async () => {
    mockPrisma.contentQuestion.findMany.mockResolvedValue([]);

    await selectRetrievalQuestions({
      curriculumId: "cur-1",
      playbookId: null,
      outcomeRefs: [],
      count: 5,
      bloomFloor: "REMEMBER",
      recentQuestionIds: [],
      channel: "text",
    });

    expect(mockGetSourceIdsForPlaybook).not.toHaveBeenCalled();
    const where = mockPrisma.contentQuestion.findMany.mock.calls.at(-1)?.[0].where;
    expect(where.source).toEqual({ curricula: { some: { id: "cur-1" } } });
    expect(where.sourceId).toBeUndefined();
  });

  it("falls back to legacy filter when playbookId is undefined (legacy callers)", async () => {
    mockPrisma.contentQuestion.findMany.mockResolvedValue([]);

    await selectRetrievalQuestions({
      curriculumId: "cur-1",
      outcomeRefs: [],
      count: 5,
      bloomFloor: "REMEMBER",
      recentQuestionIds: [],
      channel: "text",
    });

    expect(mockGetSourceIdsForPlaybook).not.toHaveBeenCalled();
    const where = mockPrisma.contentQuestion.findMany.mock.calls.at(-1)?.[0].where;
    expect(where.source).toEqual({ curricula: { some: { id: "cur-1" } } });
  });

  it("count=0 short-circuits — no source lookup, no DB hit", async () => {
    const result = await selectRetrievalQuestions({
      curriculumId: "cur-1",
      playbookId: "pb-1",
      outcomeRefs: [],
      count: 0,
      bloomFloor: "REMEMBER",
      recentQuestionIds: [],
      channel: "text",
    });

    expect(result).toEqual([]);
    expect(mockGetSourceIdsForPlaybook).not.toHaveBeenCalled();
    expect(mockPrisma.contentQuestion.findMany).not.toHaveBeenCalled();
  });

  it("threads recentQuestionIds + channel filters into the WHERE alongside the new source filter", async () => {
    mockGetSourceIdsForPlaybook.mockResolvedValue(["src-x"]);
    mockPrisma.contentQuestion.findMany.mockResolvedValue([]);

    await selectRetrievalQuestions({
      curriculumId: "cur-1",
      playbookId: "pb-x",
      outcomeRefs: [],
      count: 3,
      bloomFloor: "REMEMBER",
      recentQuestionIds: ["q-old-1", "q-old-2"],
      channel: "voice",
    });

    const where = mockPrisma.contentQuestion.findMany.mock.calls.at(-1)?.[0].where;
    expect(where.sourceId).toEqual({ in: ["src-x"] });
    expect(where.id).toEqual({ notIn: ["q-old-1", "q-old-2"] });
    expect(where.questionType).toBeDefined(); // voice channel adds VISUAL_ONLY exclusion
  });
});

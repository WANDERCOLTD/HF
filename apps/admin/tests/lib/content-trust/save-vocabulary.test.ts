/**
 * Tests for save-vocabulary.ts
 *
 * Verifies:
 * - Empty array returns zero stats
 * - Deduplication by term (case-insensitive)
 * - Creates only new vocabulary items
 * - deleteVocabularyForSource returns count
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentVocabulary: {
      findMany: mocks.findMany,
      createMany: mocks.createMany,
      deleteMany: mocks.deleteMany,
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { saveVocabulary, deleteVocabularyForSource } from "@/lib/content-trust/save-vocabulary";
import type { ExtractedVocabulary } from "@/lib/content-trust/extractors/base-extractor";

const makeVocab = (overrides: Partial<ExtractedVocabulary> = {}): ExtractedVocabulary => ({
  term: "to clash",
  definition: "to be in conflict",
  contentHash: "v1",
  ...overrides,
});

describe("saveVocabulary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.createMany.mockResolvedValue({ count: 0 });
  });

  it("returns zero stats for empty array", async () => {
    const result = await saveVocabulary("src-1", []);
    expect(result).toEqual({ created: 0, duplicatesSkipped: 0 });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("creates all vocabulary when none exist", async () => {
    const vocab = [
      makeVocab({ term: "to clash", contentHash: "v1" }),
      makeVocab({ term: "to negotiate", definition: "to discuss terms", contentHash: "v2" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 2 });

    const result = await saveVocabulary("src-1", vocab);
    expect(result).toEqual({ created: 2, duplicatesSkipped: 0 });
    expect(mocks.createMany).toHaveBeenCalledOnce();

    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(2);
    expect(createData[0].sourceId).toBe("src-1");
    expect(createData[0].term).toBe("to clash");
    expect(createData[1].sortOrder).toBe(1);
  });

  it("skips duplicates by term (case-insensitive)", async () => {
    mocks.findMany.mockResolvedValue([{ term: "To Clash" }]);

    const vocab = [
      makeVocab({ term: "to clash", contentHash: "v1" }),
      makeVocab({ term: "to negotiate", contentHash: "v2" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 1 });

    const result = await saveVocabulary("src-1", vocab);
    expect(result).toEqual({ created: 1, duplicatesSkipped: 1 });

    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(1);
    expect(createData[0].term).toBe("to negotiate");
  });

  it("returns all skipped when all are duplicates", async () => {
    mocks.findMany.mockResolvedValue([{ term: "to clash" }, { term: "to negotiate" }]);

    const vocab = [
      makeVocab({ term: "to clash" }),
      makeVocab({ term: "To Negotiate" }),
    ];

    const result = await saveVocabulary("src-1", vocab);
    expect(result).toEqual({ created: 0, duplicatesSkipped: 2 });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("maps optional fields correctly", async () => {
    const v = makeVocab({
      term: "hazard",
      definition: "something that could cause harm",
      partOfSpeech: "noun",
      exampleUsage: "Identify the hazard in this scenario.",
      pronunciation: "/ˈhæzərd/",
      topic: "Food Safety",
      difficulty: 2,
      chapter: "Ch 1",
      pageRef: "p.5",
      tags: ["safety", "HACCP"],
      contentHash: "v1",
    });
    mocks.createMany.mockResolvedValue({ count: 1 });

    await saveVocabulary("src-1", [v]);

    const data = mocks.createMany.mock.calls[0][0].data[0];
    expect(data.partOfSpeech).toBe("noun");
    expect(data.exampleUsage).toBe("Identify the hazard in this scenario.");
    expect(data.pronunciation).toBe("/ˈhæzərd/");
    expect(data.topic).toBe("Food Safety");
    expect(data.difficulty).toBe(2);
    expect(data.chapter).toBe("Ch 1");
    expect(data.pageRef).toBe("p.5");
    expect(data.tags).toEqual(["safety", "HACCP"]);
  });
});

describe("deleteVocabularyForSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns deleted count", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 12 });

    const result = await deleteVocabularyForSource("src-1");
    expect(result).toBe(12);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { sourceId: "src-1" } });
  });
});

/**
 * Tests for save-assertions.ts
 *
 * Verifies:
 * - Empty array returns zero stats
 * - Deduplication by contentHash (skips existing DB records)
 * - Within-batch dedup (same hash twice in input)
 * - Creates only new assertions with correct field mapping
 * - skipDuplicates flag on createMany
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentAssertion: {
      findMany: mocks.findMany,
      createMany: mocks.createMany,
    },
  },
};
  return { ..._p, db: (tx) => tx ?? _p.prisma };
});

import { saveAssertions } from "@/lib/content-trust/save-assertions";
import type { ExtractedAssertion } from "@/lib/content-trust/extract-assertions";

const makeAssertion = (overrides: Partial<ExtractedAssertion> = {}): ExtractedAssertion => ({
  assertion: "The annual ISA allowance is £20,000 for 2025/26",
  category: "fact",
  tags: ["isa", "allowance"],
  contentHash: "abc123",
  ...overrides,
});

describe("saveAssertions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.createMany.mockResolvedValue({ count: 0 });
  });

  it("returns zero stats for empty array", async () => {
    const result = await saveAssertions("src-1", []);
    expect(result).toEqual({ created: 0, duplicatesSkipped: 0 });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("creates all assertions when none exist in DB", async () => {
    const assertions = [
      makeAssertion({ contentHash: "h1" }),
      makeAssertion({ contentHash: "h2", assertion: "Capital gains tax rate is 20%" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 2 });

    const result = await saveAssertions("src-1", assertions);
    expect(result).toEqual({ created: 2, duplicatesSkipped: 0 });
    expect(mocks.createMany).toHaveBeenCalledOnce();

    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(2);
    expect(createData[0].sourceId).toBe("src-1");
    expect(createData[0].contentHash).toBe("h1");
    expect(createData[1].contentHash).toBe("h2");
  });

  it("skips assertions with existing contentHash in DB", async () => {
    mocks.findMany.mockResolvedValue([{ contentHash: "h1" }]);

    const assertions = [
      makeAssertion({ contentHash: "h1" }),
      makeAssertion({ contentHash: "h2", assertion: "New assertion" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 1 });

    const result = await saveAssertions("src-1", assertions);
    expect(result).toEqual({ created: 1, duplicatesSkipped: 1 });

    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(1);
    expect(createData[0].contentHash).toBe("h2");
  });

  it("deduplicates within the same batch (same hash twice)", async () => {
    const assertions = [
      makeAssertion({ contentHash: "h1", assertion: "First copy" }),
      makeAssertion({ contentHash: "h1", assertion: "Second copy" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 1 });

    const result = await saveAssertions("src-1", assertions);
    expect(result).toEqual({ created: 1, duplicatesSkipped: 1 });

    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(1);
    expect(createData[0].assertion).toBe("First copy");
  });

  it("returns all skipped when all are duplicates", async () => {
    mocks.findMany.mockResolvedValue([{ contentHash: "h1" }, { contentHash: "h2" }]);

    const assertions = [
      makeAssertion({ contentHash: "h1" }),
      makeAssertion({ contentHash: "h2" }),
    ];

    const result = await saveAssertions("src-1", assertions);
    expect(result).toEqual({ created: 0, duplicatesSkipped: 2 });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it("maps all optional fields correctly", async () => {
    const a = makeAssertion({
      contentHash: "h1",
      chapter: "Ch 3",
      section: "3.2",
      examRelevance: 0.85,
      learningOutcomeRef: "LO-2.1",
      validUntil: "2026-04-05",
      taxYear: "2025/26",
      teachMethod: "recall_quiz",
      figureRefs: ["fig-1", "fig-2"],
    });
    mocks.createMany.mockResolvedValue({ count: 1 });

    await saveAssertions("src-1", [a]);

    const data = mocks.createMany.mock.calls[0][0].data[0];
    expect(data.chapter).toBe("Ch 3");
    expect(data.section).toBe("3.2");
    expect(data.examRelevance).toBe(0.85);
    expect(data.learningOutcomeRef).toBe("LO-2.1");
    expect(data.validUntil).toEqual(new Date("2026-04-05"));
    expect(data.taxYear).toBe("2025/26");
    expect(data.teachMethod).toBe("recall_quiz");
    expect(data.figureRefs).toEqual(["fig-1", "fig-2"]);
  });

  it("nullifies missing optional fields", async () => {
    const a = makeAssertion({ contentHash: "h1" });
    mocks.createMany.mockResolvedValue({ count: 1 });

    await saveAssertions("src-1", [a]);

    const data = mocks.createMany.mock.calls[0][0].data[0];
    expect(data.chapter).toBeNull();
    expect(data.section).toBeNull();
    expect(data.examRelevance).toBeNull();
    expect(data.learningOutcomeRef).toBeNull();
    expect(data.validUntil).toBeNull();
    expect(data.taxYear).toBeNull();
    expect(data.teachMethod).toBeNull();
    expect(data.figureRefs).toEqual([]);
  });

  it("passes skipDuplicates to createMany", async () => {
    mocks.createMany.mockResolvedValue({ count: 1 });
    await saveAssertions("src-1", [makeAssertion()]);

    expect(mocks.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it("scopes findMany to sourceId and subjectSourceId", async () => {
    mocks.createMany.mockResolvedValue({ count: 1 });

    await saveAssertions("src-1", [makeAssertion()], "ss-1");

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { sourceId: "src-1", subjectSourceId: "ss-1" },
      select: { contentHash: true },
    });
  });

  it("sets subjectSourceId on created records", async () => {
    mocks.createMany.mockResolvedValue({ count: 1 });

    await saveAssertions("src-1", [makeAssertion()], "ss-1");

    const data = mocks.createMany.mock.calls[0][0].data[0];
    expect(data.subjectSourceId).toBe("ss-1");
  });

  it("sets subjectSourceId to null when not provided", async () => {
    mocks.createMany.mockResolvedValue({ count: 1 });

    await saveAssertions("src-1", [makeAssertion()]);

    const data = mocks.createMany.mock.calls[0][0].data[0];
    expect(data.subjectSourceId).toBeNull();
  });

  it("skips assertions with empty or whitespace-only text", async () => {
    const assertions = [
      makeAssertion({ contentHash: "h1", assertion: "Valid one" }),
      makeAssertion({ contentHash: "h2", assertion: "" }),
      makeAssertion({ contentHash: "h3", assertion: "   \n  \t" }),
      makeAssertion({ contentHash: "h4", assertion: "Valid two" }),
    ];
    mocks.createMany.mockResolvedValue({ count: 2 });

    const result = await saveAssertions("src-1", assertions);

    expect(result.created).toBe(2);
    const createData = mocks.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(2);
    expect(createData.map((d: any) => d.contentHash)).toEqual(["h1", "h4"]);
  });

  it("does not call createMany when all assertions are empty", async () => {
    const assertions = [
      makeAssertion({ contentHash: "h1", assertion: "" }),
      makeAssertion({ contentHash: "h2", assertion: "  " }),
    ];

    const result = await saveAssertions("src-1", assertions);

    expect(result).toEqual({ created: 0, duplicatesSkipped: 0 });
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});

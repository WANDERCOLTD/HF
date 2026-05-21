import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  curriculum: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  domain: {
    findUnique: vi.fn(),
  },
  subjectSource: {
    findMany: vi.fn(),
  },
  contentAssertion: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  playbookSubject: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/content-trust/extract-curriculum", () => ({
  extractCurriculumFromAssertions: vi.fn(),
}));

vi.mock("@/lib/curriculum/sync-modules", () => ({
  syncModulesToDB: vi.fn().mockResolvedValue({ count: 0 }),
}));

import { generateContentSpec } from "@/lib/domain/generate-content-spec";
import { extractCurriculumFromAssertions } from "@/lib/content-trust/extract-curriculum";

describe("generateContentSpec — #590 idempotency vs authored curriculum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.domain.findUnique.mockResolvedValue({
      id: "domain-1",
      slug: "test",
      name: "Test Domain",
    });
    mockPrisma.subjectSource.findMany.mockResolvedValue([
      {
        sourceId: "source-1",
        tags: [],
        subject: { name: "Test Subject", qualificationRef: null },
      },
    ]);
    mockPrisma.contentAssertion.findMany.mockResolvedValue([
      { id: "a1", assertion: "fact one", category: "fact", chapter: null, section: null, tags: [] },
    ]);
  });

  it("skips when an authored curriculum already exists for the playbook (no subjectId match)", async () => {
    // Authored curriculum: has playbookId, no subjectId — the 2026-05-21 IELTS shape.
    // The previous filter ({ subjectId: { in: [...] } }) would have missed this.
    mockPrisma.curriculum.findFirst.mockImplementation(async ({ where }: any) => {
      const isPlaybookScopedQuery =
        where?.OR?.some?.((clause: any) => clause.playbookId === "pb-authored");
      return isPlaybookScopedQuery ? { id: "curr-authored" } : null;
    });

    const result = await generateContentSpec("domain-1", {
      subjectIds: ["subj-1"],
      playbookId: "pb-authored",
    });

    expect(result.skipped).toContain("Curriculum already exists");
    expect(result.addedToPlaybook).toBe(false);
    expect(extractCurriculumFromAssertions).not.toHaveBeenCalled();
    expect(mockPrisma.curriculum.create).not.toHaveBeenCalled();
  });

  it("preserves the original subjectId-only filter when no playbookId is given", async () => {
    // Non-authored / legacy callers: behavior unchanged when options.playbookId is undefined.
    mockPrisma.curriculum.findFirst.mockResolvedValue({ id: "curr-existing-via-subject" });

    const result = await generateContentSpec("domain-1", {
      subjectIds: ["subj-1"],
    });

    expect(result.skipped).toContain("Curriculum already exists");
    const findFirstCall = mockPrisma.curriculum.findFirst.mock.calls[0][0];
    expect(findFirstCall.where).toEqual({ subjectId: { in: ["subj-1"] } });
    expect(findFirstCall.where.OR).toBeUndefined();
  });

  it("runs the AI path when no curriculum exists yet — non-authored case still works", async () => {
    // The "leave 2x routes for Authored and non-Authored to work" constraint:
    // when nothing exists yet, AI extraction must fire and produce a curriculum.
    mockPrisma.curriculum.findFirst.mockResolvedValue(null);
    (extractCurriculumFromAssertions as any).mockResolvedValue({
      ok: true,
      modules: [],
      assertionTags: [],
    });

    const result = await generateContentSpec("domain-1", {
      subjectIds: ["subj-1"],
      playbookId: "pb-non-authored",
    });

    expect(extractCurriculumFromAssertions).toHaveBeenCalled();
    expect(result.skipped).not.toContain("Curriculum already exists");
  });
});

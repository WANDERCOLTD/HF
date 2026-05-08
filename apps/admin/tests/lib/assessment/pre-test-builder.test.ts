/**
 * #302: Module-locked MCQ selection — when a learner has picked a module via
 * the picker, the pre-test pool must restrict to that module's outcomesPrimary.
 *
 * Covers the four cases in the story:
 *   - locked pool fully satisfies questionCount
 *   - locked pool is thin (fill-up from full pool)
 *   - locked pool is empty (full fallback + warning)
 *   - no lock provided (no regression)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contentQuestion: {
      findMany: vi.fn(),
    },
    curriculum: {
      findUnique: vi.fn(),
    },
    subjectSource: {
      findMany: vi.fn(),
    },
    callerAttribute: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    getContract: vi.fn(),
  },
}));

vi.mock("@/lib/knowledge/domain-sources", () => ({
  getSourceIdsForPlaybook: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { ContractRegistry } from "@/lib/contracts/registry";
import * as domainSources from "@/lib/knowledge/domain-sources";
import { buildPreTestForPlaybook } from "@/lib/assessment/pre-test-builder";

interface MockMcq {
  id: string;
  ref: string | null;
  text?: string;
}

function mcq({ id, ref, text }: MockMcq) {
  return {
    id,
    questionText: text ?? `Q ${id}`,
    questionType: "MCQ",
    options: [
      { label: "A", text: "alpha", isCorrect: true },
      { label: "B", text: "beta" },
      { label: "C", text: "gamma" },
      { label: "D", text: "delta" },
    ],
    correctAnswer: "A",
    answerExplanation: null,
    chapter: ref ?? null,
    section: null,
    learningOutcomeRef: ref,
    difficulty: 2,
    bloomLevel: "REMEMBER",
    skillRef: null,
  };
}

describe("buildPreTestForPlaybook — module-locked selection (#302)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Assessment config: random strategy, 5-question pre-test
    vi.mocked(ContractRegistry.getContract).mockResolvedValue({
      config: {
        phases: {
          pre_test: { questionCount: 5, selectionStrategy: "random", questionTypes: ["MCQ"] },
        },
      },
    } as Awaited<ReturnType<typeof ContractRegistry.getContract>>);
    vi.mocked(domainSources.getSourceIdsForPlaybook).mockResolvedValue(["src-1"]);
  });

  it("locked pool fully satisfies count → all questions are part1 outcomes", async () => {
    const part1Refs = ["OUT-01", "OUT-02", "OUT-05", "OUT-06", "OUT-07", "OUT-24"];
    const allMcqs = [
      ...part1Refs.flatMap((r) =>
        [0, 1].map((j) => mcq({ id: `p1-${r}-${j}`, ref: r })),
      ), // 12 part1 questions
      ...["OUT-08", "OUT-10", "OUT-11", "OUT-25"].map((r) => mcq({ id: `other-${r}`, ref: r })),
    ];
    vi.mocked(prisma.contentQuestion.findMany).mockResolvedValue(allMcqs);

    const res = await buildPreTestForPlaybook("pb-1", { lockedOutcomeRefs: part1Refs });

    expect(res.skipped).toBe(false);
    expect(res.questions).toHaveLength(5);
    for (const q of res.questions) {
      expect(part1Refs).toContain(allMcqs.find((m) => m.id === q.id)!.learningOutcomeRef);
    }
  });

  it("locked pool is thin (3 of 5) → filled from full pool, locked 3 still appear first", async () => {
    const part1Refs = ["OUT-01", "OUT-06"];
    const lockedQs = [
      mcq({ id: "p1-a", ref: "OUT-01" }),
      mcq({ id: "p1-b", ref: "OUT-01" }),
      mcq({ id: "p1-c", ref: "OUT-06" }),
    ];
    const otherQs = [
      mcq({ id: "p2-a", ref: "OUT-08" }),
      mcq({ id: "p2-b", ref: "OUT-10" }),
      mcq({ id: "p3-a", ref: "OUT-15" }),
      mcq({ id: "p3-b", ref: "OUT-19" }),
    ];
    vi.mocked(prisma.contentQuestion.findMany).mockResolvedValue([...lockedQs, ...otherQs]);

    const res = await buildPreTestForPlaybook("pb-1", { lockedOutcomeRefs: part1Refs });

    expect(res.skipped).toBe(false);
    expect(res.questions).toHaveLength(5);
    const lockedIds = new Set(lockedQs.map((q) => q.id));
    const includedLocked = res.questions.filter((q) => lockedIds.has(q.id));
    expect(includedLocked).toHaveLength(3); // all 3 locked appear
    // The first 3 should be the locked set (selectRandom on locked pool first, then fillUp)
    expect(res.questions.slice(0, 3).every((q) => lockedIds.has(q.id))).toBe(true);
  });

  it("locked pool is empty → full fallback with warning", async () => {
    const allMcqs = [
      mcq({ id: "p2-a", ref: "OUT-08" }),
      mcq({ id: "p2-b", ref: "OUT-10" }),
      mcq({ id: "p3-a", ref: "OUT-15" }),
      mcq({ id: "p3-b", ref: "OUT-19" }),
      mcq({ id: "mock-a", ref: "OUT-25" }),
    ];
    vi.mocked(prisma.contentQuestion.findMany).mockResolvedValue(allMcqs);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await buildPreTestForPlaybook("pb-1", { lockedOutcomeRefs: ["OUT-99"] });

    expect(res.skipped).toBe(false);
    expect(res.questions).toHaveLength(5);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Locked module pool empty"),
    );
    warnSpy.mockRestore();
  });

  it("no lock provided → no regression, full pool used", async () => {
    const allMcqs = [
      mcq({ id: "p1-a", ref: "OUT-01" }),
      mcq({ id: "p2-a", ref: "OUT-08" }),
      mcq({ id: "p3-a", ref: "OUT-15" }),
      mcq({ id: "mock-a", ref: "OUT-25" }),
      mcq({ id: "p1-b", ref: "OUT-06" }),
    ];
    vi.mocked(prisma.contentQuestion.findMany).mockResolvedValue(allMcqs);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await buildPreTestForPlaybook("pb-1");

    expect(res.skipped).toBe(false);
    expect(res.questions).toHaveLength(5);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("ignores empty lockedOutcomeRefs array → behaves like no lock", async () => {
    const allMcqs = [
      mcq({ id: "p1-a", ref: "OUT-01" }),
      mcq({ id: "p2-a", ref: "OUT-08" }),
    ];
    vi.mocked(prisma.contentQuestion.findMany).mockResolvedValue(allMcqs);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await buildPreTestForPlaybook("pb-1", { lockedOutcomeRefs: [] });

    expect(res.skipped).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

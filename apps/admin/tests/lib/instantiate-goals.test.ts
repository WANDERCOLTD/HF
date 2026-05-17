/**
 * Tests for lib/enrollment/instantiate-goals.ts — #413 P5a.
 *
 * The wizard projection persists `ref` and `sourceContentId` on
 * `Playbook.config.goals[]`. instantiate-goals must propagate both onto the
 * created `Goal` rows so P5b derivation can resolve per-LO / per-skill
 * progress. Before #413 these were silently dropped.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  goal: {
    count: vi.fn(),
    create: vi.fn(),
  },
  callerPlaybook: {
    findMany: vi.fn(),
  },
  curriculumModule: {
    findMany: vi.fn(),
  },
  playbookSubject: {
    findMany: vi.fn(),
  },
  analysisSpec: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

import { instantiatePlaybookGoals } from "@/lib/enrollment/instantiate-goals";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.goal.count.mockResolvedValue(0);
  mockPrisma.goal.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: "goal-x", ...data }),
  );
  mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
  mockPrisma.playbookSubject.findMany.mockResolvedValue([]);
  mockPrisma.analysisSpec.findUnique.mockResolvedValue(null);
});

describe("instantiatePlaybookGoals — #413 ref + sourceContentId propagation", () => {
  it("persists `ref` on the Goal when the goalConfig carries one", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      {
        playbookId: "pb-1",
        playbook: {
          id: "pb-1",
          status: "PUBLISHED",
          config: {
            goals: [
              {
                type: "LEARN",
                name: "Speak fluently for 5 minutes",
                ref: "OUT-01",
                sourceContentId: "src-1",
                priority: 5,
              },
            ],
          },
        },
      },
    ]);

    await instantiatePlaybookGoals("caller-1");

    expect(mockPrisma.goal.create).toHaveBeenCalledTimes(1);
    const created = mockPrisma.goal.create.mock.calls[0][0].data;
    expect(created.ref).toBe("OUT-01");
    expect(created.sourceContentId).toBe("src-1");
    expect(created.name).toBe("Speak fluently for 5 minutes");
  });

  it("persists `ref: null` when the goalConfig has no ref (graceful)", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      {
        playbookId: "pb-2",
        playbook: {
          id: "pb-2",
          status: "PUBLISHED",
          config: {
            goals: [
              {
                type: "ACHIEVE",
                name: "Hand-authored goal — no projection provenance",
              },
            ],
          },
        },
      },
    ]);

    await instantiatePlaybookGoals("caller-1");

    expect(mockPrisma.goal.create).toHaveBeenCalledTimes(1);
    const created = mockPrisma.goal.create.mock.calls[0][0].data;
    expect(created.ref).toBeNull();
    expect(created.sourceContentId).toBeNull();
  });

  it("propagates SKILL-NN refs unchanged (ACHIEVE goal path for #417)", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([
      {
        playbookId: "pb-3",
        playbook: {
          id: "pb-3",
          status: "PUBLISHED",
          config: {
            goals: [
              {
                type: "ACHIEVE",
                name: "Reach Secure on Fluency & Coherence",
                ref: "SKILL-01",
                sourceContentId: "src-skill",
                isAssessmentTarget: true,
                priority: 8,
              },
            ],
          },
        },
      },
    ]);

    await instantiatePlaybookGoals("caller-1");

    const created = mockPrisma.goal.create.mock.calls[0][0].data;
    expect(created.ref).toBe("SKILL-01");
    expect(created.type).toBe("ACHIEVE");
    expect(created.isAssessmentTarget).toBe(true);
  });
});

/**
 * Tests for auto-trigger curriculum generation.
 *
 * Verifies that checkAutoTriggerCurriculum:
 *   - Skips if active extraction tasks remain for the subject
 *   - Skips if a curriculum generation task is already running
 *   - Skips if there are no assertions
 *   - Triggers curriculum generation when all conditions are met
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup (vi.hoisted to avoid TDZ in mock factories) ──

const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  contentAssertion: {
    count: vi.fn(),
  },
  subject: {
    findUnique: vi.fn(),
  },
  userTask: {
    create: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
}));

const mockStartCurriculumGeneration = vi.hoisted(() =>
  vi.fn().mockResolvedValue("curriculum-task-123")
);

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/ai/task-guidance", () => ({
  startTaskTracking: vi.fn().mockResolvedValue("task-123"),
  updateTaskProgress: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn().mockResolvedValue(undefined),
  backgroundRun: (taskId: string, fn: () => Promise<void>) => {
    fn().catch(() => {});
  },
}));

vi.mock("@/lib/jobs/curriculum-runner", () => ({
  startCurriculumGeneration: (...args: any[]) => mockStartCurriculumGeneration(...args),
}));

import { checkAutoTriggerCurriculum } from "@/lib/jobs/auto-trigger";

// ── Tests ──

describe("checkAutoTriggerCurriculum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.subject.findUnique.mockResolvedValue({
      id: "sub-1",
      name: "Food Safety L2",
    });
  });

  it("skips if active extraction tasks remain", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(2) }]); // active extractions

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBeNull();
    expect(mockStartCurriculumGeneration).not.toHaveBeenCalled();
  });

  it("skips if a curriculum generation task is already running", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])  // no active extractions
      .mockResolvedValueOnce([{ count: BigInt(1) }]); // active curriculum

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBeNull();
    expect(mockStartCurriculumGeneration).not.toHaveBeenCalled();
  });

  it("skips if there are no assertions", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])  // no active extractions
      .mockResolvedValueOnce([{ count: BigInt(0) }]); // no active curriculum
    mockPrisma.contentAssertion.count.mockResolvedValue(0);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBeNull();
    expect(mockStartCurriculumGeneration).not.toHaveBeenCalled();
  });

  it("skips if subject not found", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])
      .mockResolvedValueOnce([{ count: BigInt(0) }]);
    mockPrisma.contentAssertion.count.mockResolvedValue(50);
    mockPrisma.subject.findUnique.mockResolvedValue(null);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBeNull();
    expect(mockStartCurriculumGeneration).not.toHaveBeenCalled();
  });

  it("triggers curriculum generation when all conditions met", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }])  // no active extractions
      .mockResolvedValueOnce([{ count: BigInt(0) }]); // no active curriculum
    mockPrisma.contentAssertion.count.mockResolvedValue(50);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBe("curriculum-task-123");
    expect(mockStartCurriculumGeneration).toHaveBeenCalledWith(
      "sub-1",
      "Food Safety L2",
      "user-1"
    );
  });
});

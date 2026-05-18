/**
 * #469 — auto-trigger.ts modulesAuthored guard.
 *
 * checkAutoTriggerCurriculum() must NOT fire startCurriculumGeneration
 * when the playbook attached to the subject has authored modules. The
 * wizard's applyProjection() path is the canonical write path for
 * authored catalogues.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn().mockResolvedValue([{ count: BigInt(0) }]),
  contentAssertion: { count: vi.fn().mockResolvedValue(1) },
  playbookSubject: { findFirst: vi.fn() },
  subjectSource: { findMany: vi.fn().mockResolvedValue([]) },
  subject: { findUnique: vi.fn().mockResolvedValue({ name: "Test Subject" }) },
}));

const mockStartCurriculumGeneration = vi.hoisted(() => vi.fn().mockResolvedValue("task-auto"));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/jobs/curriculum-runner", () => ({
  startCurriculumGeneration: (...args: unknown[]) => mockStartCurriculumGeneration(...args),
}));

import { checkAutoTriggerCurriculum } from "@/lib/jobs/auto-trigger";

describe("auto-trigger modulesAuthored guard (#469)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    mockPrisma.contentAssertion.count.mockResolvedValue(1);
    mockPrisma.subject.findUnique.mockResolvedValue({ name: "Test Subject" });
  });

  it("returns null when playbook.config.modulesAuthored === true", async () => {
    mockPrisma.playbookSubject.findFirst.mockResolvedValue({
      playbookId: "pb-authored",
      playbook: { config: { modulesAuthored: true } },
    });

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBeNull();
    expect(mockStartCurriculumGeneration).not.toHaveBeenCalled();
  });

  it("fires curriculum generation when modulesAuthored === false", async () => {
    mockPrisma.playbookSubject.findFirst.mockResolvedValue({
      playbookId: "pb-1",
      playbook: { config: { modulesAuthored: false } },
    });

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBe("task-auto");
    expect(mockStartCurriculumGeneration).toHaveBeenCalledWith("sub-1", "Test Subject", "user-1");
  });

  it("fires curriculum generation when no playbook is linked", async () => {
    mockPrisma.playbookSubject.findFirst.mockResolvedValue(null);

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBe("task-auto");
    expect(mockStartCurriculumGeneration).toHaveBeenCalled();
  });

  it("fires curriculum generation when modulesAuthored is undefined (legacy)", async () => {
    mockPrisma.playbookSubject.findFirst.mockResolvedValue({
      playbookId: "pb-legacy",
      playbook: { config: { subjectDiscipline: "Maths" } },
    });

    const result = await checkAutoTriggerCurriculum("sub-1", "user-1");

    expect(result).toBe("task-auto");
    expect(mockStartCurriculumGeneration).toHaveBeenCalled();
  });
});

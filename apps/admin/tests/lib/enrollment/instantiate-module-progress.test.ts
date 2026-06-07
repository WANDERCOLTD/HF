import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      callerPlaybook: { findMany: vi.fn() },
      playbook: { findMany: vi.fn() },
      curriculumModule: { findMany: vi.fn() },
      callerModuleProgress: { createMany: vi.fn() },
    },
  };
});

import { instantiatePlaybookModuleProgress } from "@/lib/enrollment/instantiate-module-progress";
import { prisma } from "@/lib/prisma";

const callerId = "caller-1";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("instantiatePlaybookModuleProgress (#1254)", () => {
  test("no enrolments → no writes", async () => {
    (prisma.callerPlaybook.findMany as any).mockResolvedValueOnce([]);
    const r = await instantiatePlaybookModuleProgress(callerId);
    expect(r).toEqual({ created: 0, skipped: 0, structuredPlaybooks: 0, continuousPlaybooks: 0 });
    expect(prisma.callerModuleProgress.createMany).not.toHaveBeenCalled();
  });

  test("STRUCTURED playbook → seeds NOT_STARTED rows for every CurriculumModule", async () => {
    (prisma.callerPlaybook.findMany as any).mockResolvedValueOnce([{ playbookId: "pb-1" }]);
    (prisma.playbook.findMany as any).mockResolvedValueOnce([
      {
        id: "pb-1",
        config: { lessonPlanMode: "structured" },
        playbookCurricula: [{ curriculumId: "curr-1" }],
      },
    ]);
    (prisma.curriculumModule.findMany as any).mockResolvedValueOnce([
      { id: "mod-1" },
      { id: "mod-2" },
      { id: "mod-3" },
    ]);
    (prisma.callerModuleProgress.createMany as any).mockResolvedValueOnce({ count: 3 });

    const r = await instantiatePlaybookModuleProgress(callerId);
    expect(r).toEqual({ created: 3, skipped: 0, structuredPlaybooks: 1, continuousPlaybooks: 0 });
    expect(prisma.callerModuleProgress.createMany).toHaveBeenCalledWith({
      data: [
        { callerId, moduleId: "mod-1", mastery: 0, status: "NOT_STARTED", callCount: 0 },
        { callerId, moduleId: "mod-2", mastery: 0, status: "NOT_STARTED", callCount: 0 },
        { callerId, moduleId: "mod-3", mastery: 0, status: "NOT_STARTED", callCount: 0 },
      ],
      skipDuplicates: true,
    });
  });

  test("CONTINUOUS playbook → skipped (no seeds, no curriculum lookup)", async () => {
    (prisma.callerPlaybook.findMany as any).mockResolvedValueOnce([{ playbookId: "pb-1" }]);
    (prisma.playbook.findMany as any).mockResolvedValueOnce([
      {
        id: "pb-1",
        config: { lessonPlanMode: "continuous" },
        playbookCurricula: [{ curriculumId: "curr-1" }],
      },
    ]);

    const r = await instantiatePlaybookModuleProgress(callerId);
    expect(r).toEqual({ created: 0, skipped: 0, structuredPlaybooks: 0, continuousPlaybooks: 1 });
    expect(prisma.curriculumModule.findMany).not.toHaveBeenCalled();
    expect(prisma.callerModuleProgress.createMany).not.toHaveBeenCalled();
  });

  test("missing lessonPlanMode → CONTINUOUS (default-deny), skipped", async () => {
    (prisma.callerPlaybook.findMany as any).mockResolvedValueOnce([{ playbookId: "pb-1" }]);
    (prisma.playbook.findMany as any).mockResolvedValueOnce([
      { id: "pb-1", config: {}, playbookCurricula: [{ curriculumId: "curr-1" }] },
    ]);

    const r = await instantiatePlaybookModuleProgress(callerId);
    expect(r.structuredPlaybooks).toBe(0);
    expect(r.continuousPlaybooks).toBe(1);
    expect(prisma.callerModuleProgress.createMany).not.toHaveBeenCalled();
  });

  test("STRUCTURED playbook with no primary curriculum → no seeds", async () => {
    (prisma.callerPlaybook.findMany as any).mockResolvedValueOnce([{ playbookId: "pb-1" }]);
    (prisma.playbook.findMany as any).mockResolvedValueOnce([
      { id: "pb-1", config: { lessonPlanMode: "structured" }, playbookCurricula: [] },
    ]);

    const r = await instantiatePlaybookModuleProgress(callerId);
    expect(r).toEqual({ created: 0, skipped: 0, structuredPlaybooks: 1, continuousPlaybooks: 0 });
    expect(prisma.callerModuleProgress.createMany).not.toHaveBeenCalled();
  });

  test("idempotent — createMany skipDuplicates is true", async () => {
    (prisma.callerPlaybook.findMany as any).mockResolvedValueOnce([{ playbookId: "pb-1" }]);
    (prisma.playbook.findMany as any).mockResolvedValueOnce([
      {
        id: "pb-1",
        config: { lessonPlanMode: "structured" },
        playbookCurricula: [{ curriculumId: "curr-1" }],
      },
    ]);
    (prisma.curriculumModule.findMany as any).mockResolvedValueOnce([{ id: "mod-1" }]);
    (prisma.callerModuleProgress.createMany as any).mockResolvedValueOnce({ count: 0 });

    const r = await instantiatePlaybookModuleProgress(callerId);
    expect(r).toEqual({ created: 0, skipped: 1, structuredPlaybooks: 1, continuousPlaybooks: 0 });
  });
});

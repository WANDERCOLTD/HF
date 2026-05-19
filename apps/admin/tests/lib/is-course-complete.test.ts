/**
 * Tests for isCourseComplete — #494 E2 Slice 2.7
 *
 * Pure predicate: given a learner + curriculum + course-level completionMode,
 * decide whether the course is "done". Three modes:
 *
 *   - "all-modules"   → every module COMPLETED
 *   - "terminal-only" → at least one terminal module COMPLETED (default)
 *   - "any"           → at least one module COMPLETED
 *
 * Mocks Prisma — no DB.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import { isCourseComplete } from "@/lib/curriculum/is-course-complete";

// =====================================================
// FIXTURES
// =====================================================

const CALLER_ID = "caller-1";
const CURRICULUM_ID = "curr-1";

interface FakeModule {
  id: string;
  slug: string;
  terminal?: boolean;
  prerequisites?: string[];
  coversModules?: string[];
  masteryThreshold?: number | null;
}

interface FakeProgress {
  moduleId: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  completedAt?: Date | null;
}

function mkModule(
  slug: string,
  opts: { terminal?: boolean; prerequisites?: string[] } = {},
): FakeModule {
  return {
    id: `mod-${slug}`,
    slug,
    terminal: opts.terminal ?? false,
    prerequisites: opts.prerequisites ?? [],
    coversModules: [],
    masteryThreshold: null,
  };
}

function mkPrisma(
  modules: FakeModule[],
  progress: FakeProgress[],
): {
  prisma: PrismaClient;
  moduleFindMany: ReturnType<typeof vi.fn>;
  progressFindMany: ReturnType<typeof vi.fn>;
} {
  const moduleFindMany = vi.fn().mockResolvedValue(modules);
  const progressFindMany = vi.fn().mockResolvedValue(
    progress.map((p) => ({
      moduleId: p.moduleId,
      status: p.status,
      completedAt: p.completedAt ?? null,
    })),
  );
  const prisma = {
    curriculumModule: { findMany: moduleFindMany },
    callerModuleProgress: { findMany: progressFindMany },
  } as unknown as PrismaClient;
  return { prisma, moduleFindMany, progressFindMany };
}

// =====================================================
// TESTS
// =====================================================

describe("isCourseComplete (#494 Slice 2.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not-complete for a curriculum with zero modules", async () => {
    const { prisma } = mkPrisma([], []);
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "all-modules" } as PlaybookConfig,
    });
    expect(result).toEqual({
      complete: false,
      mode: "all-modules",
      completedAt: null,
      triggeringModuleIds: [],
    });
  });

  it('all-modules: every module COMPLETED → complete, triggeringModuleIds = all', async () => {
    const t1 = new Date("2026-01-02T10:00:00.000Z");
    const t2 = new Date("2026-01-03T10:00:00.000Z");
    const { prisma } = mkPrisma(
      [mkModule("m1"), mkModule("m2")],
      [
        { moduleId: "mod-m1", status: "COMPLETED", completedAt: t1 },
        { moduleId: "mod-m2", status: "COMPLETED", completedAt: t2 },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "all-modules" } as PlaybookConfig,
    });
    expect(result.complete).toBe(true);
    expect(result.mode).toBe("all-modules");
    expect(result.triggeringModuleIds.sort()).toEqual(["mod-m1", "mod-m2"]);
    expect(result.completedAt).toBe(t2.toISOString());
  });

  it("all-modules: one IN_PROGRESS → not complete", async () => {
    const { prisma } = mkPrisma(
      [mkModule("m1"), mkModule("m2")],
      [
        { moduleId: "mod-m1", status: "COMPLETED", completedAt: new Date() },
        { moduleId: "mod-m2", status: "IN_PROGRESS" },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "all-modules" } as PlaybookConfig,
    });
    expect(result.complete).toBe(false);
    expect(result.triggeringModuleIds).toEqual([]);
    expect(result.completedAt).toBeNull();
  });

  it("terminal-only: terminal module COMPLETED → complete, triggering = [terminal]", async () => {
    const t = new Date("2026-02-10T09:30:00.000Z");
    const { prisma } = mkPrisma(
      [
        mkModule("m1"),
        mkModule("mock", { terminal: true }),
      ],
      [
        { moduleId: "mod-m1", status: "IN_PROGRESS" },
        { moduleId: "mod-mock", status: "COMPLETED", completedAt: t },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "terminal-only" } as PlaybookConfig,
    });
    expect(result.complete).toBe(true);
    expect(result.mode).toBe("terminal-only");
    expect(result.triggeringModuleIds).toEqual(["mod-mock"]);
    expect(result.completedAt).toBe(t.toISOString());
  });

  it("terminal-only: terminal NOT_STARTED but others COMPLETED → not complete", async () => {
    const { prisma } = mkPrisma(
      [
        mkModule("m1"),
        mkModule("m2"),
        mkModule("mock", { terminal: true }),
      ],
      [
        { moduleId: "mod-m1", status: "COMPLETED", completedAt: new Date() },
        { moduleId: "mod-m2", status: "COMPLETED", completedAt: new Date() },
        { moduleId: "mod-mock", status: "NOT_STARTED" },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "terminal-only" } as PlaybookConfig,
    });
    expect(result.complete).toBe(false);
    expect(result.triggeringModuleIds).toEqual([]);
  });

  it("terminal-only: no module is marked terminal → not complete + console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { prisma } = mkPrisma(
      [mkModule("m1"), mkModule("m2")],
      [
        { moduleId: "mod-m1", status: "COMPLETED", completedAt: new Date() },
        { moduleId: "mod-m2", status: "COMPLETED", completedAt: new Date() },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "terminal-only" } as PlaybookConfig,
    });
    expect(result.complete).toBe(false);
    expect(result.mode).toBe("terminal-only");
    expect(warnSpy).toHaveBeenCalledWith(
      "[is-course-complete] terminal-only mode with no terminal modules",
    );
    warnSpy.mockRestore();
  });

  it("terminal-only: multiple terminals, only one COMPLETED → complete, triggering = [that one]", async () => {
    const t = new Date("2026-03-01T12:00:00.000Z");
    const { prisma } = mkPrisma(
      [
        mkModule("speak-mock", { terminal: true }),
        mkModule("write-mock", { terminal: true }),
      ],
      [
        { moduleId: "mod-speak-mock", status: "COMPLETED", completedAt: t },
        { moduleId: "mod-write-mock", status: "NOT_STARTED" },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "terminal-only" } as PlaybookConfig,
    });
    expect(result.complete).toBe(true);
    expect(result.triggeringModuleIds).toEqual(["mod-speak-mock"]);
    expect(result.completedAt).toBe(t.toISOString());
  });

  it('"any": zero completed → not complete', async () => {
    const { prisma } = mkPrisma(
      [mkModule("m1"), mkModule("m2")],
      [{ moduleId: "mod-m1", status: "IN_PROGRESS" }],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "any" } as PlaybookConfig,
    });
    expect(result.complete).toBe(false);
    expect(result.mode).toBe("any");
  });

  it('"any": one COMPLETED → complete, triggering = [that one]', async () => {
    const t = new Date("2026-04-15T14:22:00.000Z");
    const { prisma } = mkPrisma(
      [mkModule("m1"), mkModule("m2"), mkModule("m3")],
      [
        { moduleId: "mod-m1", status: "NOT_STARTED" },
        { moduleId: "mod-m2", status: "COMPLETED", completedAt: t },
        { moduleId: "mod-m3", status: "IN_PROGRESS" },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "any" } as PlaybookConfig,
    });
    expect(result.complete).toBe(true);
    expect(result.mode).toBe("any");
    expect(result.triggeringModuleIds).toEqual(["mod-m2"]);
    expect(result.completedAt).toBe(t.toISOString());
  });

  it("completedAt is the latest among triggering completedAts (any mode)", async () => {
    const early = new Date("2026-05-01T00:00:00.000Z");
    const mid = new Date("2026-05-10T00:00:00.000Z");
    const late = new Date("2026-05-19T00:00:00.000Z");
    const { prisma } = mkPrisma(
      [mkModule("m1"), mkModule("m2"), mkModule("m3")],
      [
        { moduleId: "mod-m1", status: "COMPLETED", completedAt: early },
        { moduleId: "mod-m2", status: "COMPLETED", completedAt: late },
        { moduleId: "mod-m3", status: "COMPLETED", completedAt: mid },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: { completionMode: "any" } as PlaybookConfig,
    });
    expect(result.complete).toBe(true);
    expect(result.completedAt).toBe(late.toISOString());
  });

  it("defaults completionMode to 'terminal-only' when playbookConfig is null", async () => {
    const t = new Date("2026-05-19T08:00:00.000Z");
    const { prisma } = mkPrisma(
      [mkModule("m1"), mkModule("final", { terminal: true })],
      [
        { moduleId: "mod-m1", status: "COMPLETED", completedAt: new Date() },
        { moduleId: "mod-final", status: "COMPLETED", completedAt: t },
      ],
    );
    const result = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: CURRICULUM_ID,
      playbookConfig: null,
    });
    expect(result.mode).toBe("terminal-only");
    expect(result.complete).toBe(true);
    expect(result.triggeringModuleIds).toEqual(["mod-final"]);
    expect(result.completedAt).toBe(t.toISOString());
  });

  it("returns not-complete when callerId or curriculumId is empty (no DB calls)", async () => {
    const { prisma, moduleFindMany, progressFindMany } = mkPrisma([], []);
    const a = await isCourseComplete(prisma, {
      callerId: "",
      curriculumId: CURRICULUM_ID,
      playbookConfig: null,
    });
    const b = await isCourseComplete(prisma, {
      callerId: CALLER_ID,
      curriculumId: "",
      playbookConfig: null,
    });
    expect(a.complete).toBe(false);
    expect(b.complete).toBe(false);
    expect(moduleFindMany).not.toHaveBeenCalled();
    expect(progressFindMany).not.toHaveBeenCalled();
  });
});

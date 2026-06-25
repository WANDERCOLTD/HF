/**
 * fix/module-binding-null-on-fresh-callers — pinFirstModuleForCaller
 *
 * Pins the AC: `Caller.lastSelectedModuleId` is set to the playbook's first
 * `CurriculumModule` (by `sortOrder ASC`) ONLY when the caller's current
 * `lastSelectedModuleId` is null. Returning callers with module continuity
 * are NOT clobbered.
 *
 * Defends against the race that produces `Call.curriculumModuleId = NULL`:
 * tied `updatedAt` on bulk-created `CallerModuleProgress` rows →
 * `resolve-default-module.ts` Step 1 returns the wrong slug → call writes
 * NULL FK. Pinning short-circuits the resolver's cascade at Step 2
 * (`Caller.lastSelectedModuleId`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallerFindUnique = vi.fn();
const mockPlaybookFindUnique = vi.fn();
const mockCurriculumModuleFindFirst = vi.fn();
const mockCallerUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caller: { findUnique: mockCallerFindUnique, update: mockCallerUpdate },
    playbook: { findUnique: mockPlaybookFindUnique },
    curriculumModule: { findFirst: mockCurriculumModuleFindFirst },
  },
}));

// `@prisma/client` is imported by the helper only for the
// `PlaybookCurriculumRole` enum value. Stub it so the unit test runs
// without the full Prisma client compiled.
vi.mock("@prisma/client", () => ({
  PlaybookCurriculumRole: { primary: "primary", linked: "linked" },
}));

beforeEach(() => {
  mockCallerFindUnique.mockReset();
  mockPlaybookFindUnique.mockReset();
  mockCurriculumModuleFindFirst.mockReset();
  mockCallerUpdate.mockReset();
});

describe("pinFirstModuleForCaller", () => {
  it("returns caller-missing when callerId is empty", async () => {
    const { pinFirstModuleForCaller } = await import("@/lib/enrollment/pin-first-module");
    const r = await pinFirstModuleForCaller("", "pb1");
    expect(r).toEqual({ pinned: false, reason: "caller-missing" });
    expect(mockCallerFindUnique).not.toHaveBeenCalled();
  });

  it("returns caller-missing when playbookId is empty", async () => {
    const { pinFirstModuleForCaller } = await import("@/lib/enrollment/pin-first-module");
    const r = await pinFirstModuleForCaller("c1", "");
    expect(r).toEqual({ pinned: false, reason: "caller-missing" });
    expect(mockCallerFindUnique).not.toHaveBeenCalled();
  });

  it("returns already-pinned when caller's lastSelectedModuleId is non-null (returning learner)", async () => {
    mockCallerFindUnique.mockResolvedValueOnce({ lastSelectedModuleId: "mod-touched" });
    const { pinFirstModuleForCaller } = await import("@/lib/enrollment/pin-first-module");
    const r = await pinFirstModuleForCaller("c1", "pb1");
    expect(r).toEqual({
      pinned: false,
      reason: "already-pinned",
      moduleId: "mod-touched",
    });
    expect(mockPlaybookFindUnique).not.toHaveBeenCalled();
    expect(mockCallerUpdate).not.toHaveBeenCalled();
  });

  it("returns caller-missing when the Caller row doesn't exist", async () => {
    mockCallerFindUnique.mockResolvedValueOnce(null);
    const { pinFirstModuleForCaller } = await import("@/lib/enrollment/pin-first-module");
    const r = await pinFirstModuleForCaller("c-ghost", "pb1");
    expect(r).toEqual({ pinned: false, reason: "caller-missing" });
    expect(mockCallerUpdate).not.toHaveBeenCalled();
  });

  it("returns no-primary-curriculum when the playbook has no primary curriculum link", async () => {
    mockCallerFindUnique.mockResolvedValueOnce({ lastSelectedModuleId: null });
    mockPlaybookFindUnique.mockResolvedValueOnce({ playbookCurricula: [] });
    const { pinFirstModuleForCaller } = await import("@/lib/enrollment/pin-first-module");
    const r = await pinFirstModuleForCaller("c1", "pb1");
    expect(r).toEqual({ pinned: false, reason: "no-primary-curriculum" });
    expect(mockCurriculumModuleFindFirst).not.toHaveBeenCalled();
    expect(mockCallerUpdate).not.toHaveBeenCalled();
  });

  it("returns no-modules when the curriculum has no CurriculumModule rows", async () => {
    mockCallerFindUnique.mockResolvedValueOnce({ lastSelectedModuleId: null });
    mockPlaybookFindUnique.mockResolvedValueOnce({
      playbookCurricula: [{ curriculumId: "curr1" }],
    });
    mockCurriculumModuleFindFirst.mockResolvedValueOnce(null);
    const { pinFirstModuleForCaller } = await import("@/lib/enrollment/pin-first-module");
    const r = await pinFirstModuleForCaller("c1", "pb1");
    expect(r).toEqual({ pinned: false, reason: "no-modules" });
    expect(mockCallerUpdate).not.toHaveBeenCalled();
  });

  it("pins the first module by sortOrder ASC for a fresh caller", async () => {
    mockCallerFindUnique.mockResolvedValueOnce({ lastSelectedModuleId: null });
    mockPlaybookFindUnique.mockResolvedValueOnce({
      playbookCurricula: [{ curriculumId: "curr1" }],
    });
    mockCurriculumModuleFindFirst.mockResolvedValueOnce({ id: "mod-baseline" });
    mockCallerUpdate.mockResolvedValueOnce({ id: "c1", lastSelectedModuleId: "mod-baseline" });

    const { pinFirstModuleForCaller } = await import("@/lib/enrollment/pin-first-module");
    const r = await pinFirstModuleForCaller("c1", "pb1");

    expect(r).toEqual({ pinned: true, reason: "pinned", moduleId: "mod-baseline" });
    expect(mockCurriculumModuleFindFirst).toHaveBeenCalledWith({
      where: { curriculumId: "curr1" },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    expect(mockCallerUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { lastSelectedModuleId: "mod-baseline" },
    });
  });

  it("queries the playbook's primary-role curriculum (not linked variants)", async () => {
    mockCallerFindUnique.mockResolvedValueOnce({ lastSelectedModuleId: null });
    mockPlaybookFindUnique.mockResolvedValueOnce({
      playbookCurricula: [{ curriculumId: "curr-primary" }],
    });
    mockCurriculumModuleFindFirst.mockResolvedValueOnce({ id: "mod-first" });
    mockCallerUpdate.mockResolvedValueOnce({});

    const { pinFirstModuleForCaller } = await import("@/lib/enrollment/pin-first-module");
    await pinFirstModuleForCaller("c1", "pb1");

    // The Lattice survey requires we filter by the canonical primary join row
    // to avoid landing on a linked-variant curriculum.
    expect(mockPlaybookFindUnique).toHaveBeenCalledWith({
      where: { id: "pb1" },
      select: {
        playbookCurricula: {
          where: { role: "primary" },
          select: { curriculumId: true },
          take: 1,
        },
      },
    });
  });
});

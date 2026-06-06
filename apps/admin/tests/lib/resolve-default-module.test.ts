/**
 * G6 / #1154 — resolveDefaultModuleForCaller
 *
 * Verifies the resolution chain:
 *   1. Latest CallerModuleProgress for this caller in this curriculum
 *   2. Playbook's first CurriculumModule by sortOrder
 *   3. null when curriculum has no modules
 *   4. null when playbook has no curriculum
 *
 * AC defended:
 *   - Step 1 wins when progress exists (continuation behaviour)
 *   - Step 2 falls back to sortOrder=0 module when no progress
 *   - Helper returns null gracefully when callerId / playbookId are empty
 *
 * Defends I-C1: when the resolver returns non-null, Call.requestedModuleId
 * gets set at call-create, which arms the widened I-C1 gate at compose-time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindFirstCMP = vi.fn();
const mockFindFirstCM = vi.fn();
const mockResolveCurriculumIdForPlaybook = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerModuleProgress: { findFirst: mockFindFirstCMP },
    curriculumModule: { findFirst: mockFindFirstCM },
  },
}));

vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveCurriculumIdForPlaybook: mockResolveCurriculumIdForPlaybook,
}));

beforeEach(() => {
  mockFindFirstCMP.mockReset();
  mockFindFirstCM.mockReset();
  mockResolveCurriculumIdForPlaybook.mockReset();
});

describe("resolveDefaultModuleForCaller", () => {
  it("returns null when callerId is empty", async () => {
    const { resolveDefaultModuleForCaller } = await import(
      "@/lib/curriculum/resolve-default-module"
    );
    const r = await resolveDefaultModuleForCaller("", "pb1");
    expect(r).toBeNull();
    expect(mockResolveCurriculumIdForPlaybook).not.toHaveBeenCalled();
  });

  it("returns null when playbookId is empty", async () => {
    const { resolveDefaultModuleForCaller } = await import(
      "@/lib/curriculum/resolve-default-module"
    );
    const r = await resolveDefaultModuleForCaller("c1", "");
    expect(r).toBeNull();
  });

  it("returns null when playbook has no curriculum", async () => {
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce(null);
    const { resolveDefaultModuleForCaller } = await import(
      "@/lib/curriculum/resolve-default-module"
    );
    const r = await resolveDefaultModuleForCaller("c1", "pb1");
    expect(r).toBeNull();
    expect(mockFindFirstCMP).not.toHaveBeenCalled();
    expect(mockFindFirstCM).not.toHaveBeenCalled();
  });

  it("returns caller_progress when CallerModuleProgress exists", async () => {
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr1");
    mockFindFirstCMP.mockResolvedValueOnce({
      module: { id: "mod-touched", slug: "part2" },
    });
    const { resolveDefaultModuleForCaller } = await import(
      "@/lib/curriculum/resolve-default-module"
    );
    const r = await resolveDefaultModuleForCaller("c1", "pb1");
    expect(r).toEqual({
      moduleSlug: "part2",
      curriculumModuleId: "mod-touched",
      source: "caller_progress",
    });
    expect(mockFindFirstCM).not.toHaveBeenCalled(); // step 2 skipped
  });

  it("falls through to playbook_first_module when no progress", async () => {
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr1");
    mockFindFirstCMP.mockResolvedValueOnce(null);
    mockFindFirstCM.mockResolvedValueOnce({
      id: "mod-first",
      slug: "part1",
    });
    const { resolveDefaultModuleForCaller } = await import(
      "@/lib/curriculum/resolve-default-module"
    );
    const r = await resolveDefaultModuleForCaller("c1", "pb1");
    expect(r).toEqual({
      moduleSlug: "part1",
      curriculumModuleId: "mod-first",
      source: "playbook_first_module",
    });
    expect(mockFindFirstCM).toHaveBeenCalledWith({
      where: { curriculumId: "curr1" },
      select: { id: true, slug: true },
      orderBy: { sortOrder: "asc" },
    });
  });

  it("returns null when curriculum has no modules at all", async () => {
    mockResolveCurriculumIdForPlaybook.mockResolvedValueOnce("curr1");
    mockFindFirstCMP.mockResolvedValueOnce(null);
    mockFindFirstCM.mockResolvedValueOnce(null);
    const { resolveDefaultModuleForCaller } = await import(
      "@/lib/curriculum/resolve-default-module"
    );
    const r = await resolveDefaultModuleForCaller("c1", "pb1");
    expect(r).toBeNull();
  });
});

describe("I-C1 widening (compose-invariants)", () => {
  it("fires on lockedModuleName alone when requestedModuleId is null", async () => {
    const { checkComposeInvariants } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const violations = checkComposeInvariants({
      requestedModuleId: null,
      lockedModuleName: "Part 2",
      callerContextMarkdown:
        "## Curriculum\ncurrent: Part 1\n## Pedagogy\nspaced-retrieve Part 1",
      callNumber: 3,
      keyMemoriesNull: true,
      priorCallFeedbackHasFeedback: false,
    } as any);
    const ic1 = violations.find((v) => v.id === "I-C1");
    expect(ic1).toBeDefined();
    expect(ic1!.severity).toBe("error");
    expect(ic1!.message).toContain('scheduler / default-module resolver');
  });

  it("fires on requestedModuleId + lockedModuleName when prompt omits the lock", async () => {
    const { checkComposeInvariants } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const violations = checkComposeInvariants({
      requestedModuleId: "part2",
      lockedModuleName: "Part 2",
      callerContextMarkdown: "## Curriculum\ncurrent: Part 1\n",
      callNumber: 3,
      keyMemoriesNull: true,
      priorCallFeedbackHasFeedback: false,
    } as any);
    const ic1 = violations.find((v) => v.id === "I-C1");
    expect(ic1).toBeDefined();
    expect(ic1!.message).toContain('Call.requestedModuleId="part2"');
  });

  it("does NOT fire when the prompt names the locked module", async () => {
    const { checkComposeInvariants } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const violations = checkComposeInvariants({
      requestedModuleId: "part2",
      lockedModuleName: "Part 2",
      callerContextMarkdown: "## Curriculum\ncurrent: Part 2\nFocus today is Part 2 cue cards.",
      callNumber: 3,
      keyMemoriesNull: true,
      priorCallFeedbackHasFeedback: false,
    } as any);
    const ic1 = violations.find((v) => v.id === "I-C1");
    expect(ic1).toBeUndefined();
  });
});

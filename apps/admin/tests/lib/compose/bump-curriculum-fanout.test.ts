/**
 * Tests for `lib/compose/bump-curriculum-fanout.ts` — CC-B (#1034).
 *
 * Verifies that a Curriculum-affecting mutation fans the
 * compose-inputs-updated bump out to every sibling Playbook sharing the
 * Curriculum (variant Course product line). Without fanout, learners on
 * variant Courses would receive stale prompts after teacher edits.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBumpPlaybookComposeTimestamp = vi.fn();
vi.mock("@/lib/compose/bump-timestamp", () => ({
  bumpPlaybookComposeTimestamp: mockBumpPlaybookComposeTimestamp,
}));

const mockResolvePlaybookIdForCurriculum = vi.fn();
const mockResolvePlaybookIdForCurriculumModule = vi.fn();
vi.mock("@/lib/curriculum/resolve-playbook-for-curriculum", () => ({
  resolvePlaybookIdForCurriculum: mockResolvePlaybookIdForCurriculum,
  resolvePlaybookIdForCurriculumModule: mockResolvePlaybookIdForCurriculumModule,
}));

describe("bumpCurriculumComposeFanout — CC-B (#1034)", () => {
  let mod: typeof import("@/lib/compose/bump-curriculum-fanout");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/compose/bump-curriculum-fanout");
  });

  it("bumps every sibling Playbook returned by the resolver", async () => {
    mockResolvePlaybookIdForCurriculum.mockResolvedValue([
      "pb-primary",
      "pb-popquiz",
      "pb-exam",
    ]);
    const result = await mod.bumpCurriculumComposeFanout("c-shared");
    expect(result.count).toBe(3);
    expect(result.representativePlaybookId).toBe("pb-primary");
    expect(mockBumpPlaybookComposeTimestamp).toHaveBeenCalledTimes(3);
    expect(mockBumpPlaybookComposeTimestamp).toHaveBeenNthCalledWith(1, "pb-primary");
    expect(mockBumpPlaybookComposeTimestamp).toHaveBeenNthCalledWith(2, "pb-popquiz");
    expect(mockBumpPlaybookComposeTimestamp).toHaveBeenNthCalledWith(3, "pb-exam");
  });

  it("returns count 0 + null representative when no siblings linked", async () => {
    mockResolvePlaybookIdForCurriculum.mockResolvedValue([]);
    const result = await mod.bumpCurriculumComposeFanout("c-orphan");
    expect(result.count).toBe(0);
    expect(result.representativePlaybookId).toBeNull();
    expect(mockBumpPlaybookComposeTimestamp).not.toHaveBeenCalled();
  });

  it("treats single-sibling case identically — count 1, that Playbook is the representative", async () => {
    mockResolvePlaybookIdForCurriculum.mockResolvedValue(["pb-only"]);
    const result = await mod.bumpCurriculumComposeFanout("c-1");
    expect(result.count).toBe(1);
    expect(result.representativePlaybookId).toBe("pb-only");
    expect(mockBumpPlaybookComposeTimestamp).toHaveBeenCalledExactlyOnceWith("pb-only");
  });
});

describe("bumpCurriculumModuleComposeFanout — CC-B (#1034)", () => {
  let mod: typeof import("@/lib/compose/bump-curriculum-fanout");

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await import("@/lib/compose/bump-curriculum-fanout");
  });

  it("walks moduleId → curriculum → siblings and bumps each", async () => {
    mockResolvePlaybookIdForCurriculumModule.mockResolvedValue([
      "pb-primary",
      "pb-variant",
    ]);
    const result = await mod.bumpCurriculumModuleComposeFanout("mod-1");
    expect(result.count).toBe(2);
    expect(result.representativePlaybookId).toBe("pb-primary");
    expect(mockBumpPlaybookComposeTimestamp).toHaveBeenCalledTimes(2);
  });

  it("no-op when moduleId resolves to no Playbooks", async () => {
    mockResolvePlaybookIdForCurriculumModule.mockResolvedValue([]);
    const result = await mod.bumpCurriculumModuleComposeFanout("mod-orphan");
    expect(result.count).toBe(0);
    expect(result.representativePlaybookId).toBeNull();
    expect(mockBumpPlaybookComposeTimestamp).not.toHaveBeenCalled();
  });
});

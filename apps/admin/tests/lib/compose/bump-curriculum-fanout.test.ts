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

// #1429 — bump-curriculum-fanout now fires the eager-reprompt helper
// once per sibling Playbook after the bump loop completes. Mock it so
// the existing tests don't pull in prisma.
const mockTriggerEagerRepromptForDemoCallers = vi.fn().mockResolvedValue({
  callerIds: [],
  attempted: 0,
  failures: [],
});
vi.mock("@/lib/compose/eager-reprompt-on-bump", () => ({
  triggerEagerRepromptForDemoCallers: mockTriggerEagerRepromptForDemoCallers,
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

  // #1429 — TL revision #1 AC: a multi-playbook curriculum edit fires
  // the eager reprompt fan-out EXACTLY ONCE PER PLAYBOOK, not once per
  // `bumpPlaybookComposeTimestamp` call (which would be the same N today
  // but is the architectural invariant we're locking).
  it("fires eager reprompt fan-out once per sibling Playbook (TL rev #1)", async () => {
    mockResolvePlaybookIdForCurriculum.mockResolvedValue([
      "pb-primary",
      "pb-popquiz",
      "pb-exam",
    ]);
    await mod.bumpCurriculumComposeFanout("c-shared");
    // The bump helper is called once per playbook (existing behaviour).
    expect(mockBumpPlaybookComposeTimestamp).toHaveBeenCalledTimes(3);
    // The eager reprompt helper is ALSO called once per playbook —
    // not once per bump call (which is the same N today but the
    // separation is the architectural lock).
    expect(mockTriggerEagerRepromptForDemoCallers).toHaveBeenCalledTimes(3);
    expect(mockTriggerEagerRepromptForDemoCallers).toHaveBeenNthCalledWith(1, "pb-primary");
    expect(mockTriggerEagerRepromptForDemoCallers).toHaveBeenNthCalledWith(2, "pb-popquiz");
    expect(mockTriggerEagerRepromptForDemoCallers).toHaveBeenNthCalledWith(3, "pb-exam");
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

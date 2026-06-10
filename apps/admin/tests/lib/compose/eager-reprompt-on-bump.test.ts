/**
 * Tests for `lib/compose/eager-reprompt-on-bump.ts` — #1429.
 *
 * Demo-policy eager reprompt fan-out: lists `policyMode='demo'`
 * callers on a playbook and calls `autoComposeForCaller` per row.
 *
 * Coverage:
 *   - production callers untouched (only demo rows enumerated)
 *   - structured `[demo-reprompt]` log line per success
 *   - structured failure log + caller id in result.failures on throw
 *   - empty playbookId → no DB read, no autoCompose call
 *   - zero demo callers → returns empty result, no autoCompose call
 *   - DB read failure → swallowed, returns empty result
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  callerPlaybook: {
    findMany: vi.fn(),
  },
}));
const mockAutoCompose = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/enrollment/auto-compose", () => ({
  autoComposeForCaller: mockAutoCompose,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

import { triggerEagerRepromptForDemoCallers } from "@/lib/compose/eager-reprompt-on-bump";

describe("triggerEagerRepromptForDemoCallers — #1429", () => {
  it("fans out autoComposeForCaller per demo caller, skipping production callers", async () => {
    // The findMany query filters policyMode='demo' so the helper only
    // sees demo rows. This test asserts that we DO call autoCompose for
    // each demo caller, AND that the query is scoped properly.
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c-demo-1" },
      { callerId: "c-demo-2" },
    ]);
    mockAutoCompose.mockResolvedValue(undefined);

    const result = await triggerEagerRepromptForDemoCallers("pb-1");

    expect(mockPrisma.callerPlaybook.findMany).toHaveBeenCalledWith({
      where: { playbookId: "pb-1", policyMode: "demo", status: "ACTIVE" },
      select: { callerId: true },
    });
    expect(mockAutoCompose).toHaveBeenCalledTimes(2);
    expect(mockAutoCompose).toHaveBeenCalledWith("c-demo-1", "pb-1");
    expect(mockAutoCompose).toHaveBeenCalledWith("c-demo-2", "pb-1");
    expect(result.callerIds).toEqual(["c-demo-1", "c-demo-2"]);
    expect(result.attempted).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it("emits structured [demo-reprompt] log line per success", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c-demo-1" },
    ]);
    mockAutoCompose.mockResolvedValueOnce(undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await triggerEagerRepromptForDemoCallers("pb-1");

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[demo-reprompt\] callerId=c-demo-1 playbookId=pb-1 success=true durationMs=\d+/),
    );
    logSpy.mockRestore();
  });

  it("captures per-caller failure in result.failures, continues for the rest", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c-demo-1" },
      { callerId: "c-demo-2" },
    ]);
    mockAutoCompose
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await triggerEagerRepromptForDemoCallers("pb-1");

    expect(result.attempted).toBe(2);
    expect(result.failures).toEqual(["c-demo-1"]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[demo-reprompt\] callerId=c-demo-1 .*success=false.*error=boom/),
    );
    warnSpy.mockRestore();
  });

  it("no-ops on empty playbookId", async () => {
    const result = await triggerEagerRepromptForDemoCallers("");
    expect(mockPrisma.callerPlaybook.findMany).not.toHaveBeenCalled();
    expect(mockAutoCompose).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
    expect(result.callerIds).toEqual([]);
  });

  it("no-ops on null playbookId", async () => {
    const result = await triggerEagerRepromptForDemoCallers(null);
    expect(mockPrisma.callerPlaybook.findMany).not.toHaveBeenCalled();
    expect(mockAutoCompose).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
  });

  it("zero demo callers → returns empty result without calling autoCompose", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([]);
    const result = await triggerEagerRepromptForDemoCallers("pb-1");
    expect(mockAutoCompose).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
    expect(result.callerIds).toEqual([]);
  });

  it("findMany failure is swallowed and logged, returns empty result", async () => {
    mockPrisma.callerPlaybook.findMany.mockRejectedValueOnce(new Error("db down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await triggerEagerRepromptForDemoCallers("pb-1");

    expect(result.attempted).toBe(0);
    expect(result.callerIds).toEqual([]);
    expect(mockAutoCompose).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to enumerate demo callers for playbookId=pb-1"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("bumpPlaybookComposeTimestamp does NOT fire the fan-out (architectural — #1429)", () => {
  it("does NOT import the eager-reprompt helper from bump-timestamp.ts", async () => {
    // The architectural rule from the TL review is that the fan-out is
    // NOT wired into bump-timestamp.ts. Curriculum/LO edits land in a
    // for-loop calling bumpPlaybookComposeTimestamp per sibling playbook;
    // wiring there would multiply the fan-out by playbook count. Static
    // assertion: source of bump-timestamp.ts must not reference
    // `triggerEagerRepromptForDemoCallers`.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "lib/compose/bump-timestamp.ts"),
      "utf-8",
    );
    expect(source).not.toContain("triggerEagerRepromptForDemoCallers");
    expect(source).not.toContain("eager-reprompt-on-bump");
  });
});

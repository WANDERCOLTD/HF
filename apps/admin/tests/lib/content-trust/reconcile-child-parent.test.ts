/**
 * Tests for reconcile-child-parent.ts — generic child→parent AI retag utility.
 *
 * Covers issue #348:
 * - Error handler logs dropped child IDs (no silent unmatched count)
 * - Call site does not pass explicit maxTokens / temperature (cascade owns it)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfiguredMeteredAICompletion: vi.fn(),
}));

vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: mocks.getConfiguredMeteredAICompletion,
}));

import { reconcileChildToParent } from "@/lib/content-trust/reconcile-child-parent";

interface Child {
  id: string;
  text: string;
}

interface Parent {
  ref: string;
  description: string;
  id: string;
}

function makeOpts(overrides: Partial<Parameters<typeof reconcileChildToParent>[0]> = {}) {
  return {
    children: [
      { id: "c1", text: "child one" },
      { id: "c2", text: "child two" },
    ] as Child[],
    parents: [{ ref: "P1", description: "parent one", id: "p1" }] as Parent[],
    getChildId: (c: Child) => c.id,
    getChildText: (c: Child) => c.text,
    getParentRef: (p: Parent) => p.ref,
    getParentDescription: (p: Parent) => p.description,
    getParentId: (p: Parent) => p.id,
    writeFk: vi.fn().mockResolvedValue(undefined),
    aiCallPoint: "test.retag",
    childLabel: "items",
    parentLabel: "buckets",
    ...overrides,
  };
}

describe("reconcileChildToParent — issue #348 hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not pass explicit maxTokens or temperature (cascade owns numeric params)", async () => {
    mocks.getConfiguredMeteredAICompletion.mockResolvedValue({
      content: JSON.stringify({ c1: "P1", c2: null }),
    });

    await reconcileChildToParent(makeOpts() as any);

    const callArgs = mocks.getConfiguredMeteredAICompletion.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("maxTokens");
    expect(callArgs).not.toHaveProperty("temperature");
    expect(callArgs.callPoint).toBe("test.retag");
  });

  it("logs dropped child IDs when the AI call fails (not just a count)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getConfiguredMeteredAICompletion.mockRejectedValue(new Error("Request was aborted."));

    const result = await reconcileChildToParent(makeOpts() as any);

    expect(result.unmatched).toBe(2);
    expect(result.matched).toBe(0);

    // The error log must include the actual dropped child IDs so operators
    // can re-run / investigate specific items.
    const logCalls = errSpy.mock.calls.flat();
    const logString = JSON.stringify(logCalls);
    expect(logString).toContain("c1");
    expect(logString).toContain("c2");

    errSpy.mockRestore();
  });

  it("still works on the happy path — matches child to parent and writes FK", async () => {
    const writeFk = vi.fn().mockResolvedValue(undefined);
    mocks.getConfiguredMeteredAICompletion.mockResolvedValue({
      content: JSON.stringify({ c1: "P1", c2: null }),
    });

    const result = await reconcileChildToParent(makeOpts({ writeFk }) as any);

    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(writeFk).toHaveBeenCalledWith("c1", "p1", expect.any(Number));
  });
});

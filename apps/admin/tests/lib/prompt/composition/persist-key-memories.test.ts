/**
 * Tests for `persistComposedPrompt` — `inputs.key_memories` surfacing.
 *
 * Root cause we're guarding against: pre-fix, the `key_memories` list
 * computed by `transforms/quickstart.ts` lived ONLY at
 * `llmPrompt._quickStart.key_memories`. The adaptive-loop canary
 * (#1514 Gate 4) reads `ComposedPrompt.inputs.key_memories` as the
 * external observability surface — that field was never written, so
 * Gate 4 tripped WARN even when CallerMemory writes were healthy.
 *
 * Fix: `persist.ts` now mirrors the already-computed list from
 * `llmPrompt._quickStart.key_memories` into `inputs.key_memories` as a
 * `string[]` (empty array, never null/undefined). The forensics blob
 * shape is otherwise unchanged.
 *
 * These tests pin:
 *   1. Populated case — `inputs.key_memories` matches the quickstart list.
 *   2. Empty / missing case — `inputs.key_memories` is `[]`, never null.
 *   3. Sibling `memoriesCount` still written (no regression of existing
 *      forensics shape).
 *   4. `llmPrompt` column still receives the full composition (no
 *      duplication that loses the structured `_quickStart`).
 *
 * Linked: docs/audit/compose-key-memories-empty-root-cause.md
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CompositionResult } from "@/lib/prompt/composition/types";

const mocks = vi.hoisted(() => ({
  composedPromptCreate: vi.fn(),
  composedPromptUpdateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    composedPrompt: {
      create: mocks.composedPromptCreate,
      updateMany: mocks.composedPromptUpdateMany,
    },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (cb: (innerTx: unknown) => Promise<unknown>) => cb(tx)),
    },
    db: (client: unknown) => client,
    type: {},
  };
});

import { persistComposedPrompt } from "@/lib/prompt/composition/persist";

beforeEach(() => {
  vi.clearAllMocks();
  // The route only reads back what `create` returned; we don't need a
  // realistic id, just enough fields to pass the `as PersistedPrompt` cast.
  mocks.composedPromptCreate.mockImplementation(async ({ data }) => ({
    id: "cp_test_123",
    callerId: data.callerId,
    prompt: data.prompt,
    llmPrompt: data.llmPrompt,
    status: data.status,
    composedAt: new Date(),
  }));
  mocks.composedPromptUpdateMany.mockResolvedValue({ count: 0 });
});

/** Build a minimal `CompositionResult` with whatever quickstart shape we want. */
function makeComposition(quickStart: Record<string, unknown> | undefined): CompositionResult {
  return {
    llmPrompt: {
      _version: "2.0",
      _format: "LLM_STRUCTURED",
      ...(quickStart !== undefined ? { _quickStart: quickStart } : {}),
    },
    callerContext: "## Caller Information\n- Name: Test",
    sections: {},
    loadedData: {
      caller: { id: "caller_x", name: "Test" },
      memories: [
        { category: "FACT", key: "name", value: "Test", confidence: 0.9 },
        { category: "FACT", key: "city", value: "London", confidence: 0.8 },
      ],
      personality: null,
      recentCalls: [],
      playbooks: [{ name: "Test Course" }],
    } as unknown as CompositionResult["loadedData"],
    resolvedSpecs: {
      identitySpec: { name: "TUT-001", config: {} },
      voiceSpec: null,
    } as unknown as CompositionResult["resolvedSpecs"],
    metadata: {
      sectionsActivated: ["caller_info", "memories", "quick_start"],
      sectionsSkipped: [],
      activationReasons: {},
      loadTimeMs: 100,
      transformTimeMs: 200,
      mergedTargetCount: 3,
    },
  };
}

describe("persistComposedPrompt → inputs.key_memories surfacing", () => {
  it("Gate 4 (#1514): mirrors llmPrompt._quickStart.key_memories into inputs.key_memories", async () => {
    const composition = makeComposition({
      key_memories: ["name: Test", "city: London", "interest: cooking"],
      this_caller: "Test (call #1)",
    });

    await persistComposedPrompt(composition, "rendered markdown", {
      callerId: "caller_x",
      playbookId: "pb_test",
    });

    expect(mocks.composedPromptCreate).toHaveBeenCalledTimes(1);
    const data = mocks.composedPromptCreate.mock.calls[0][0].data;
    expect(data.inputs.key_memories).toEqual([
      "name: Test",
      "city: London",
      "interest: cooking",
    ]);
    // Sibling forensics field unchanged.
    expect(data.inputs.memoriesCount).toBe(2);
  });

  it("returns [] when _quickStart is missing entirely (omitted section)", async () => {
    const composition = makeComposition(undefined);

    await persistComposedPrompt(composition, "rendered markdown", {
      callerId: "caller_x",
    });

    const data = mocks.composedPromptCreate.mock.calls[0][0].data;
    expect(data.inputs.key_memories).toEqual([]);
    expect(Array.isArray(data.inputs.key_memories)).toBe(true);
  });

  it("returns [] when key_memories is null (quickstart returned null because no memories)", async () => {
    const composition = makeComposition({
      key_memories: null,
      this_caller: "Test (call #1)",
    });

    await persistComposedPrompt(composition, "rendered markdown", {
      callerId: "caller_x",
    });

    const data = mocks.composedPromptCreate.mock.calls[0][0].data;
    expect(data.inputs.key_memories).toEqual([]);
  });

  it("returns [] when key_memories is missing from _quickStart (non-array)", async () => {
    const composition = makeComposition({
      this_caller: "Test (call #1)",
      // No key_memories field at all
    });

    await persistComposedPrompt(composition, "rendered markdown", {
      callerId: "caller_x",
    });

    const data = mocks.composedPromptCreate.mock.calls[0][0].data;
    expect(data.inputs.key_memories).toEqual([]);
  });

  it("filters non-string entries defensively (the shape comes from a transform)", async () => {
    const composition = makeComposition({
      // Defensive — quickstart should always return string[], but guard
      // against future drift / partial outputs.
      key_memories: ["name: Test", 42, null, "city: London", undefined],
    });

    await persistComposedPrompt(composition, "rendered markdown", {
      callerId: "caller_x",
    });

    const data = mocks.composedPromptCreate.mock.calls[0][0].data;
    expect(data.inputs.key_memories).toEqual(["name: Test", "city: London"]);
  });

  it("does NOT duplicate _quickStart into llmPrompt — full structure preserved", async () => {
    const quickStart = {
      key_memories: ["name: Test"],
      this_caller: "Test (call #1)",
    };
    const composition = makeComposition(quickStart);

    await persistComposedPrompt(composition, "rendered markdown", {
      callerId: "caller_x",
    });

    const data = mocks.composedPromptCreate.mock.calls[0][0].data;
    // llmPrompt column still contains the full structure
    expect(data.llmPrompt._quickStart).toEqual(quickStart);
    // inputs.key_memories is the mirror
    expect(data.inputs.key_memories).toEqual(["name: Test"]);
  });

  it("preserves all existing forensics-shape inputs fields (no regression)", async () => {
    const composition = makeComposition({
      key_memories: ["a: b"],
    });

    await persistComposedPrompt(composition, "rendered markdown", {
      callerId: "caller_x",
      playbookId: "pb_x",
      composeSpecSlug: "spec-comp-001",
      specConfig: { foo: "bar" },
    });

    const data = mocks.composedPromptCreate.mock.calls[0][0].data;
    expect(data.inputs).toEqual(
      expect.objectContaining({
        callerContext: expect.any(String),
        memoriesCount: 2,
        key_memories: ["a: b"],
        personalityAvailable: false,
        recentCallsCount: 0,
        behaviorTargetsCount: 3,
        playbooksUsed: ["Test Course"],
        playbooksCount: 1,
        identitySpec: "TUT-001",
        contentSpec: null,
        specUsed: "spec-comp-001",
        specConfig: { foo: "bar" },
        composition: expect.objectContaining({
          sectionsActivated: ["caller_info", "memories", "quick_start"],
          sectionsSkipped: [],
          loadTimeMs: 100,
          transformTimeMs: 200,
        }),
      }),
    );
  });
});

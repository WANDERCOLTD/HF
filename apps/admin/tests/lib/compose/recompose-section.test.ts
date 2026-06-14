/**
 * Tests for `lib/compose/recompose-section.ts` — #1558 S3b.
 *
 * Pins the contract documented in
 * `docs/decisions/2026-06-14-section-scoped-recompose.md`:
 *
 *   1. Patches ONLY the section's outputKeys; sibling outputKeys stay
 *      BYTE-IDENTICAL to the stored prompt (the AC + the ADR's
 *      byte-identical-sibling property).
 *   2. Re-renders the prose `prompt` field globally from the merged JSON
 *      (TL decision 2026-06-14 — option A: re-render globally).
 *   3. Bumps the section hash via `bumpSectionHash`; sibling section
 *      hashes are untouched (separate clocks — the S2 invariant).
 *   4. Idempotent: same hash → no write, no hash bump, `patched: false`.
 *   5. Returns null when no active baseline prompt exists — recompose is
 *      a PATCH primitive, not a fresh-mint flow.
 *   6. dryRun produces `{ before, after }` slices without writes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  composedPrompt: { findFirst: vi.fn(), update: vi.fn() },
  playbookSectionStaleness: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/prompt/composition", () => ({
  executeComposition: vi.fn(),
  loadComposeConfig: vi.fn(),
}));
vi.mock("@/lib/prompt/composition/renderPromptSummary", () => ({
  renderPromptSummary: vi.fn(() => "RENDERED PROSE"),
}));

describe("recomposeSectionForCaller — #1558 S3b", () => {
  let recomposeSectionForCaller: typeof import("@/lib/compose/recompose-section").recomposeSectionForCaller;
  let executeComposition: ReturnType<typeof vi.fn>;
  let loadComposeConfig: ReturnType<typeof vi.fn>;
  let renderPromptSummary: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/compose/recompose-section");
    recomposeSectionForCaller = mod.recomposeSectionForCaller;
    const composition = await import("@/lib/prompt/composition");
    executeComposition = composition.executeComposition as ReturnType<typeof vi.fn>;
    loadComposeConfig = composition.loadComposeConfig as ReturnType<typeof vi.fn>;
    const rps = await import("@/lib/prompt/composition/renderPromptSummary");
    renderPromptSummary = rps.renderPromptSummary as ReturnType<typeof vi.fn>;

    loadComposeConfig.mockResolvedValue({
      fullSpecConfig: {},
      sections: [],
      specSlug: "COMP-001",
    });
    mockPrisma.playbookSectionStaleness.findUnique.mockResolvedValue(null);
    mockPrisma.playbookSectionStaleness.create.mockResolvedValue({});
    mockPrisma.playbookSectionStaleness.update.mockResolvedValue({});
    mockPrisma.composedPrompt.update.mockResolvedValue({});
    // $transaction passes a `tx` proxy through to the callback. Reuse the
    // top-level mock client for simplicity — semantics match.
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
  });

  it("returns null when no active baseline ComposedPrompt exists", async () => {
    mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);
    const result = await recomposeSectionForCaller("caller-1", "pb-1", "welcome");
    expect(result).toBeNull();
    expect(executeComposition).not.toHaveBeenCalled();
  });

  it("dryRun returns { before, after } slices and writes nothing", async () => {
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({
      id: "cp-1",
      llmPrompt: {
        _quickStart: { first_line: "OLD welcome" },
        personality: { traits: ["calm"] },
      },
    });
    executeComposition.mockResolvedValue({
      llmPrompt: {
        _quickStart: { first_line: "NEW welcome" },
        _version: "2.0",
        agentIdentitySummary: "summary",
      },
    });

    const result = await recomposeSectionForCaller("caller-1", "pb-1", "welcome", {
      dryRun: true,
    });

    expect(result).not.toBeNull();
    if (!result || !result.dryRun) throw new Error("expected dryRun result");
    expect(result.sectionKey).toBe("welcome");
    expect(result.before).toEqual({
      _quickStart: { first_line: "OLD welcome" },
    });
    expect(result.after).toEqual({
      _quickStart: { first_line: "NEW welcome" },
    });
    expect(result.composedPromptId).toBe("cp-1");

    // No writes.
    expect(mockPrisma.composedPrompt.update).not.toHaveBeenCalled();
    expect(mockPrisma.playbookSectionStaleness.create).not.toHaveBeenCalled();
  });

  it("live: patches only the target outputKeys; siblings stay byte-identical", async () => {
    const storedLlmPrompt = {
      _quickStart: { first_line: "OLD welcome" },
      personality: { traits: ["calm"] },
      behaviorTargets: { totalCount: 3, byDomain: { skill: [] }, all: [] },
      _version: "2.0",
      _format: "LLM_STRUCTURED",
      agentIdentitySummary: "agent summary",
    };
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({
      id: "cp-1",
      llmPrompt: storedLlmPrompt,
    });
    executeComposition.mockResolvedValue({
      llmPrompt: {
        _quickStart: { first_line: "NEW welcome" },
        _version: "2.0",
        _format: "LLM_STRUCTURED",
        agentIdentitySummary: "agent summary",
      },
    });

    const result = await recomposeSectionForCaller("caller-1", "pb-1", "welcome");

    expect(result).not.toBeNull();
    if (!result || result.dryRun) throw new Error("expected live result");
    expect(result.patched).toBe(true);
    expect(result.sectionKey).toBe("welcome");

    expect(mockPrisma.composedPrompt.update).toHaveBeenCalledTimes(1);
    const updateCall = mockPrisma.composedPrompt.update.mock.calls[0][0];
    const written = updateCall.data.llmPrompt as Record<string, unknown>;

    // Target outputKey moved.
    expect(written._quickStart).toEqual({ first_line: "NEW welcome" });
    // **Siblings byte-identical** — the AC + ADR property.
    expect(written.personality).toEqual(storedLlmPrompt.personality);
    expect(written.behaviorTargets).toEqual(storedLlmPrompt.behaviorTargets);
    expect(written._version).toBe(storedLlmPrompt._version);
    expect(written._format).toBe(storedLlmPrompt._format);
    expect(written.agentIdentitySummary).toBe(storedLlmPrompt.agentIdentitySummary);
  });

  it("re-renders the prose summary globally from the merged JSON (TL decision: option A)", async () => {
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({
      id: "cp-1",
      llmPrompt: { _quickStart: { first_line: "OLD" } },
    });
    executeComposition.mockResolvedValue({
      llmPrompt: { _quickStart: { first_line: "NEW" } },
    });
    renderPromptSummary.mockReturnValue("FRESH PROSE");

    await recomposeSectionForCaller("caller-1", "pb-1", "welcome");

    expect(renderPromptSummary).toHaveBeenCalledTimes(1);
    expect(mockPrisma.composedPrompt.update.mock.calls[0][0].data.prompt).toBe(
      "FRESH PROSE",
    );
  });

  it("bumps PlaybookSectionStaleness for the target section only", async () => {
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({
      id: "cp-1",
      llmPrompt: { _quickStart: { first_line: "OLD" } },
    });
    executeComposition.mockResolvedValue({
      llmPrompt: { _quickStart: { first_line: "NEW" } },
    });

    await recomposeSectionForCaller("caller-1", "pb-1", "welcome");

    // bumpSectionHash for `welcome` — the only call.
    expect(mockPrisma.playbookSectionStaleness.findUnique).toHaveBeenCalledTimes(1);
    expect(
      mockPrisma.playbookSectionStaleness.findUnique.mock.calls[0][0],
    ).toMatchObject({
      where: { playbookId_sectionKey: { playbookId: "pb-1", sectionKey: "welcome" } },
    });
    expect(mockPrisma.playbookSectionStaleness.create).toHaveBeenCalledTimes(1);
    // No write for any sibling section.
    expect(mockPrisma.playbookSectionStaleness.create.mock.calls[0][0].data.sectionKey).toBe(
      "welcome",
    );
  });

  it("idempotent: same hash → no write, no hash bump, patched=false", async () => {
    // Stored + fresh agree byte-for-byte on the welcome section.
    const sameWelcome = { first_line: "SAME welcome" };
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({
      id: "cp-1",
      llmPrompt: { _quickStart: sameWelcome, personality: { traits: [] } },
    });
    executeComposition.mockResolvedValue({
      llmPrompt: { _quickStart: sameWelcome },
    });

    const result = await recomposeSectionForCaller("caller-1", "pb-1", "welcome");

    expect(result).not.toBeNull();
    if (!result || result.dryRun) throw new Error("expected live result");
    expect(result.patched).toBe(false);
    expect(mockPrisma.composedPrompt.update).not.toHaveBeenCalled();
    expect(mockPrisma.playbookSectionStaleness.create).not.toHaveBeenCalled();
  });

  it("handles undefined fresh-compose outputKey by DELETING from the stored llmPrompt (not leaving stale)", async () => {
    mockPrisma.composedPrompt.findFirst.mockResolvedValue({
      id: "cp-1",
      llmPrompt: {
        _quickStart: { first_line: "OLD welcome" },
        personality: { traits: ["calm"] },
      },
    });
    executeComposition.mockResolvedValue({
      llmPrompt: {
        // _quickStart absent — fresh compose dropped it (e.g. activation gate flipped)
      },
    });

    await recomposeSectionForCaller("caller-1", "pb-1", "welcome");

    expect(mockPrisma.composedPrompt.update).toHaveBeenCalledTimes(1);
    const written = mockPrisma.composedPrompt.update.mock.calls[0][0].data
      .llmPrompt as Record<string, unknown>;
    expect("_quickStart" in written).toBe(false);
    // Sibling still byte-identical.
    expect(written.personality).toEqual({ traits: ["calm"] });
  });
});

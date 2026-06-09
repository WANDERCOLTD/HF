/**
 * #1346 Slice 5 — carryThroughCompose (minimal-mode COMPOSE fallback) unit tests.
 *
 * Locks the contract:
 *   - Reads ONLY the I-CT2 cascade (no LLM)
 *   - Stamps `inputs.partialFailureMode = "minimal"` on the ComposedPrompt
 *   - Atomically flips Session.producedComposedPromptId
 *   - Atomically supersedes prior active for (callerId, playbookId)
 *   - NEVER throws when the cascade resolves to a non-null id
 *   - Throws ONLY when the cascade returns "none" (brand-new caller, no
 *     ENROLLMENT bootstrap)
 *   - Detects + handles the race when an in-flight pipeline beats us to
 *     the producedComposedPromptId flip
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTx = {
  composedPrompt: {
    create: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
  },
  session: {
    updateMany: vi.fn(),
  },
};

const mockPrisma = {
  composedPrompt: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};

const mockResolveUsedPromptId = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/voice/resolve-used-prompt", () => ({
  resolveUsedPromptId: mockResolveUsedPromptId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => {
    return await cb(mockTx);
  });
  // Default: cascade returns a usable previous-session prompt
  mockResolveUsedPromptId.mockResolvedValue({
    usedPromptId: "cp-prev-1",
    source: "previous-session",
  });
  // Default: the carried prompt exists
  mockPrisma.composedPrompt.findUnique.mockResolvedValue({
    prompt: "carried body",
    llmPrompt: { sections: ["a"] },
    model: "claude-sonnet-4",
  });
  // Default: create returns a new id
  mockTx.composedPrompt.create.mockResolvedValue({ id: "cp-new-1" });
  // Default: Session flip succeeds (count = 1)
  mockTx.session.updateMany.mockResolvedValue({ count: 1 });
  mockTx.composedPrompt.updateMany.mockResolvedValue({ count: 0 });
});

describe("carryThroughCompose", () => {
  it("throws when sessionId is missing", async () => {
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    await expect(
      // @ts-expect-error: runtime guard
      carryThroughCompose({ callerId: "c1" }),
    ).rejects.toThrow(/sessionId is required/);
  });

  it("throws when callerId is missing", async () => {
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    await expect(
      // @ts-expect-error: runtime guard
      carryThroughCompose({ sessionId: "s1" }),
    ).rejects.toThrow(/callerId is required/);
  });

  it("throws when I-CT2 cascade returns none — brand-new caller with no history", async () => {
    mockResolveUsedPromptId.mockResolvedValueOnce({ usedPromptId: null, source: "none" });
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    await expect(
      carryThroughCompose({ sessionId: "s1", callerId: "c-new" }),
    ).rejects.toThrow(/cascade returned null/);
  });

  it("happy path — stamps partialFailureMode=minimal + carryForwardSource on inputs", async () => {
    mockResolveUsedPromptId.mockResolvedValueOnce({
      usedPromptId: "cp-prev-1",
      source: "previous-session",
    });
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    const result = await carryThroughCompose({
      sessionId: "session-orphan",
      callerId: "caller-1",
      playbookId: "pb-1",
    });

    expect(result.composedPromptId).toBe("cp-new-1");
    expect(result.carryForwardSource).toBe("previous-session");
    expect(result.carryForwardPromptId).toBe("cp-prev-1");
    expect(result.raced).toBe(false);

    const createArgs = mockTx.composedPrompt.create.mock.calls[0][0];
    expect(createArgs.data.callerId).toBe("caller-1");
    expect(createArgs.data.playbookId).toBe("pb-1");
    expect(createArgs.data.triggerType).toBe("reconciler");
    expect(createArgs.data.triggerSessionId).toBe("session-orphan");
    expect(createArgs.data.status).toBe("active");
    expect(createArgs.data.inputs.partialFailureMode).toBe("minimal");
    expect(createArgs.data.inputs.carryForwardSource).toBe("previous-session");
    expect(createArgs.data.inputs.carryForwardPromptId).toBe("cp-prev-1");
    expect(typeof createArgs.data.inputs.reconciledAt).toBe("string");
  });

  it("flips Session.producedComposedPromptId atomically — only when still null", async () => {
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    await carryThroughCompose({ sessionId: "session-1", callerId: "c1" });
    const updateArgs = mockTx.session.updateMany.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "session-1", producedComposedPromptId: null });
    expect(updateArgs.data).toEqual({ producedComposedPromptId: "cp-new-1" });
  });

  it("supersedes prior active prompts for the same (callerId, playbookId)", async () => {
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    await carryThroughCompose({ sessionId: "s1", callerId: "c1", playbookId: "pb-1" });
    const supersedeArgs = mockTx.composedPrompt.updateMany.mock.calls[0][0];
    expect(supersedeArgs.where.callerId).toBe("c1");
    expect(supersedeArgs.where.playbookId).toBe("pb-1");
    expect(supersedeArgs.where.status).toBe("active");
    expect(supersedeArgs.where.id).toEqual({ not: "cp-new-1" });
    expect(supersedeArgs.data.status).toBe("superseded");
  });

  it("race detected — Session.updateMany count=0 → deletes the row we just created", async () => {
    mockTx.session.updateMany.mockResolvedValueOnce({ count: 0 });
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    const result = await carryThroughCompose({ sessionId: "s1", callerId: "c1" });

    expect(result.raced).toBe(true);
    expect(mockTx.composedPrompt.delete).toHaveBeenCalledWith({
      where: { id: "cp-new-1" },
    });
    // Supersede should NOT run when we lost the race — leave the winner alone.
    expect(mockTx.composedPrompt.updateMany).not.toHaveBeenCalled();
  });

  it("uses triggerType override when supplied (live pipeline minimal-mode)", async () => {
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    await carryThroughCompose({
      sessionId: "s1",
      callerId: "c1",
      triggerType: "pipeline-minimal-mode",
    });
    const createArgs = mockTx.composedPrompt.create.mock.calls[0][0];
    expect(createArgs.data.triggerType).toBe("pipeline-minimal-mode");
  });

  it("throws when carried prompt cannot be read back (hard-delete race)", async () => {
    mockPrisma.composedPrompt.findUnique.mockResolvedValueOnce(null);
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    await expect(
      carryThroughCompose({ sessionId: "s1", callerId: "c1" }),
    ).rejects.toThrow(/could not be read back/);
  });

  it("playbookId=null is supported (ENROLLMENT pre-link case)", async () => {
    const { carryThroughCompose } = await import("@/lib/voice/carry-through-compose");
    const result = await carryThroughCompose({ sessionId: "s1", callerId: "c1", playbookId: null });
    expect(result.composedPromptId).toBe("cp-new-1");
    const createArgs = mockTx.composedPrompt.create.mock.calls[0][0];
    expect(createArgs.data.playbookId).toBeNull();
    // Supersede WHERE should target playbookId IS NULL (not omit the filter)
    const supersedeArgs = mockTx.composedPrompt.updateMany.mock.calls[0][0];
    expect(supersedeArgs.where.playbookId).toBeNull();
  });
});

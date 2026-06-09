/**
 * #1342 — I-CT2 prompt-resolution cascade tests.
 *
 * Locks the 3-step cascade against silent re-ordering:
 *   1. previous Session's producedComposedPromptId
 *   2. most-recent ACTIVE ComposedPrompt for caller
 *   3. ENROLLMENT Session's producedComposedPromptId (Bootstrap)
 *
 * Each test exercises ONE step and asserts the cascade short-circuits
 * at that step.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  session: { findFirst: vi.fn() },
  composedPrompt: { findFirst: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

beforeEach(() => {
  vi.resetAllMocks();
  // Default both calls to null so each test only overrides what it needs.
  mockPrisma.session.findFirst.mockResolvedValue(null);
  mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);
});

describe("resolveUsedPromptId — I-CT2 cascade", () => {
  it("Step 1: previous Session has a produced prompt → uses it (short-circuits 2/3)", async () => {
    mockPrisma.session.findFirst.mockResolvedValueOnce({
      producedComposedPromptId: "cp-from-prev",
    });

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    const result = await resolveUsedPromptId({ callerId: "caller-1" });

    expect(result).toEqual({
      usedPromptId: "cp-from-prev",
      source: "previous-session",
    });
    expect(mockPrisma.composedPrompt.findFirst).not.toHaveBeenCalled();
  });

  it("Step 2: no prev-session prompt → falls back to most-recent ACTIVE ComposedPrompt", async () => {
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null) // step 1
      .mockResolvedValueOnce(null); // step 3
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce({ id: "cp-active" });

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    const result = await resolveUsedPromptId({ callerId: "caller-1" });

    expect(result).toEqual({
      usedPromptId: "cp-active",
      source: "active-composed-prompt",
    });
    // Step 3 must not have been queried (short-circuit at step 2)
    expect(mockPrisma.session.findFirst).toHaveBeenCalledTimes(1);
  });

  it("Step 3: brand-new caller with ENROLLMENT Session only → uses Bootstrap", async () => {
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null) // step 1 - no prior produced prompt
      .mockResolvedValueOnce({ producedComposedPromptId: "cp-bootstrap" }); // step 3
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null); // step 2 — none active

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    const result = await resolveUsedPromptId({ callerId: "caller-1" });

    expect(result).toEqual({
      usedPromptId: "cp-bootstrap",
      source: "enrollment-bootstrap",
    });
  });

  it("all three return null → resolution returns null + source 'none'", async () => {
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null);

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    const result = await resolveUsedPromptId({ callerId: "caller-1" });

    expect(result).toEqual({ usedPromptId: null, source: "none" });
  });

  it("Step 2 fallback respects ACTIVE status filter (not just any prompt)", async () => {
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null);

    const { resolveUsedPromptId } = await import("@/lib/voice/resolve-used-prompt");
    await resolveUsedPromptId({ callerId: "caller-1" });

    expect(mockPrisma.composedPrompt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ callerId: "caller-1", status: "active" }),
      }),
    );
  });
});

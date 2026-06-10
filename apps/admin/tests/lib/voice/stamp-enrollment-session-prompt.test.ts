/**
 * #1420 — stampEnrollmentSessionPrompt unit tests.
 *
 * Locks the contract:
 *   - Stamps the ENROLLMENT Session row when producedComposedPromptId is null
 *   - Idempotent — re-running on an already-stamped row leaves it alone
 *   - Returns noEnrollmentSession=true when no ENROLLMENT Session exists
 *     (V2 flag was off at enrol time)
 *   - Throws on missing callerId / composedPromptId (defensive)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  session: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stampEnrollmentSessionPrompt", () => {
  it("throws when callerId is missing", async () => {
    const { stampEnrollmentSessionPrompt } = await import(
      "@/lib/voice/stamp-enrollment-session-prompt"
    );
    await expect(stampEnrollmentSessionPrompt("", "cp-1")).rejects.toThrow(
      /callerId is required/,
    );
  });

  it("throws when composedPromptId is missing", async () => {
    const { stampEnrollmentSessionPrompt } = await import(
      "@/lib/voice/stamp-enrollment-session-prompt"
    );
    await expect(stampEnrollmentSessionPrompt("c1", "")).rejects.toThrow(
      /composedPromptId is required/,
    );
  });

  it("returns noEnrollmentSession=true when no ENROLLMENT Session exists", async () => {
    mockPrisma.session.findFirst.mockResolvedValueOnce(null);
    const { stampEnrollmentSessionPrompt } = await import(
      "@/lib/voice/stamp-enrollment-session-prompt"
    );
    const result = await stampEnrollmentSessionPrompt("c1", "cp-1");
    expect(result).toEqual({ stamped: false, noEnrollmentSession: true });
    expect(mockPrisma.session.updateMany).not.toHaveBeenCalled();
  });

  it("stamps the most-recent ENROLLMENT Session when its producedComposedPromptId is null", async () => {
    mockPrisma.session.findFirst.mockResolvedValueOnce({
      id: "session-enroll-1",
      producedComposedPromptId: null,
    });
    mockPrisma.session.updateMany.mockResolvedValueOnce({ count: 1 });

    const { stampEnrollmentSessionPrompt } = await import(
      "@/lib/voice/stamp-enrollment-session-prompt"
    );
    const result = await stampEnrollmentSessionPrompt("caller-1", "cp-new-1");

    expect(result.stamped).toBe(true);
    expect(result.noEnrollmentSession).toBe(false);
    expect(result.sessionId).toBe("session-enroll-1");

    // Verify the canonical findFirst shape — most-recent ENROLLMENT for caller.
    expect(mockPrisma.session.findFirst).toHaveBeenCalledWith({
      where: { callerId: "caller-1", kind: "ENROLLMENT" },
      orderBy: { startedAt: "desc" },
      select: { id: true, producedComposedPromptId: true },
    });

    // Verify the atomic write — must filter on producedComposedPromptId: null
    // so a concurrent reconciler write isn't clobbered.
    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: "session-enroll-1", producedComposedPromptId: null },
      data: { producedComposedPromptId: "cp-new-1" },
    });
  });

  it("returns stamped=false when the Session was already stamped by a reconciler race", async () => {
    // findFirst returns the row with a non-null producedComposedPromptId is
    // fine — the updateMany WHERE clause filters on `producedComposedPromptId: null`
    // and returns count=0, signalling the race.
    mockPrisma.session.findFirst.mockResolvedValueOnce({
      id: "session-enroll-1",
      producedComposedPromptId: "cp-from-reconciler",
    });
    mockPrisma.session.updateMany.mockResolvedValueOnce({ count: 0 });

    const { stampEnrollmentSessionPrompt } = await import(
      "@/lib/voice/stamp-enrollment-session-prompt"
    );
    const result = await stampEnrollmentSessionPrompt("caller-1", "cp-new-1");

    expect(result.stamped).toBe(false);
    expect(result.noEnrollmentSession).toBe(false);
    expect(result.sessionId).toBe("session-enroll-1");
  });
});

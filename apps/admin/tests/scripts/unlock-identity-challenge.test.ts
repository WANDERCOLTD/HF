/**
 * Tests for scripts/unlock-identity-challenge.ts (#1101).
 *
 * The TL review flagged: admin unlock must clear BOTH `lockedAt` AND
 * `attemptCount`. Clearing only lockedAt leaves attemptCount at the cap,
 * so the next wrong attempt re-locks immediately.
 *
 * This test verifies that property at the updateMany call site by importing
 * the script's main logic with mocked Prisma + argv.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = {
  caller: { findUnique: vi.fn() },
  callerIdentityChallenge: { updateMany: vi.fn() },
  $disconnect: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("scripts/unlock-identity-challenge", () => {
  let originalArgv: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalArgv = process.argv;
    // No-op the exit so the script's main().catch() chain doesn't actually
    // terminate the test process AND so the catch handler's process.exit(1)
    // doesn't surface as an unhandled rejection after the test body has
    // already asserted. Earlier this spy threw — that interrupted the catch
    // chain and produced 2 unhandled rejections in the test runner's
    // "Errors" pile. We assert call shape via exitSpy.toHaveBeenCalledWith
    // instead, which doesn't depend on actually halting execution.
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("clears BOTH lockedAt AND attemptCount on the 24h-window rows", async () => {
    process.argv = ["node", "script", "caller-1"];
    mockPrisma.caller.findUnique.mockResolvedValue({
      id: "caller-1",
      name: "Test Learner",
      email: "l@example.com",
    });
    mockPrisma.callerIdentityChallenge.updateMany.mockResolvedValue({ count: 2 });

    await import("@/scripts/unlock-identity-challenge");
    // Allow main() microtasks to flush
    await new Promise((r) => setImmediate(r));

    expect(mockPrisma.callerIdentityChallenge.updateMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.callerIdentityChallenge.updateMany.mock.calls[0][0];
    expect(call.where.callerId).toBe("caller-1");
    expect(call.where.issuedAt.gte).toBeInstanceOf(Date);
    // ★ critical: BOTH fields cleared, not just lockedAt
    expect(call.data).toEqual({ lockedAt: null, attemptCount: 0 });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unlocked 2 challenge row(s)"),
    );
  });

  it("exits non-zero when no callerId is supplied", async () => {
    process.argv = ["node", "script"];
    // The script's main() catches its own errors and calls process.exit(1).
    // The catch chain swallows our exitSpy throw, so the import() resolves —
    // we assert on the exit-spy call count, not on rejection.
    await import("@/scripts/unlock-identity-challenge");
    await new Promise((r) => setImmediate(r));

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage:"),
    );
    expect(mockPrisma.callerIdentityChallenge.updateMany).not.toHaveBeenCalled();
  });

  it("exits non-zero when caller does not exist", async () => {
    process.argv = ["node", "script", "missing"];
    mockPrisma.caller.findUnique.mockResolvedValue(null);

    await import("@/scripts/unlock-identity-challenge");
    await new Promise((r) => setImmediate(r));

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockPrisma.callerIdentityChallenge.updateMany).not.toHaveBeenCalled();
  });
});

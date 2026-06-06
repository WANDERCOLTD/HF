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

/**
 * Suppress the specific unhandled-rejection that the script's own
 * main().catch() throws back into our exitSpy. The script's flow:
 *   main() — calls process.exit(1) on bad argv → spy throws
 *   main().catch(err) — calls console.error(err) + process.exit(1) → spy throws again
 *   .finally(...) — runs $disconnect (mocked)
 *   The final throw goes out as an unhandled rejection.
 * Our test bodies have already asserted by then; we just need the
 * runner not to flag it as an error. Scoped listener so we don't
 * shadow real unhandled rejections from other tests.
 */
function suppressExitRejection(reason: unknown): void {
  if (reason instanceof Error && reason.message.startsWith("process.exit(")) {
    return;
  }
  // Non-matching rejection — rethrow so vitest still sees it.
  throw reason;
}

describe("scripts/unlock-identity-challenge", () => {
  let originalArgv: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    originalArgv = process.argv;
    // exit MUST throw — otherwise the script's main() continues past the
    // guard clauses and calls updateMany, breaking the "should not have
    // updateMany'd" assertions below. The throw is the test's only way to
    // interrupt the script's control flow without modifying the script.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.on("unhandledRejection", suppressExitRejection);
  });

  afterEach(() => {
    process.off("unhandledRejection", suppressExitRejection);
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

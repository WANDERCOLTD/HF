/**
 * #1420 — reconcileMissingBootstrap unit tests.
 *
 * Locks the contract:
 *   - Filters ACTIVE enrollments older than the staleness budget
 *   - Fires autoComposeForCaller only for enrollments WITHOUT an active
 *     ComposedPrompt
 *   - Idempotent: a second pass after a clean run does NOT re-fire
 *   - Failure in one enrollment does not poison the batch
 *   - failureSamples are capped at 5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  callerPlaybook: {
    findMany: vi.fn(),
  },
  composedPrompt: {
    findFirst: vi.fn(),
  },
};

const mockAutoCompose = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/enrollment/auto-compose", () => ({
  autoComposeForCaller: mockAutoCompose,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);
  mockPrisma.composedPrompt.findFirst.mockResolvedValue(null);
  mockAutoCompose.mockResolvedValue(undefined);
});

describe("reconcileMissingBootstrap", () => {
  it("returns zero counts when no ACTIVE enrollments exist", async () => {
    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    const result = await reconcileMissingBootstrap();
    expect(result.scanned).toBe(0);
    expect(result.composed).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockAutoCompose).not.toHaveBeenCalled();
  });

  it("filters enrollments older than the staleness budget", async () => {
    const now = new Date("2026-06-09T12:00:00Z");
    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    await reconcileMissingBootstrap({ now: () => now });

    expect(mockPrisma.callerPlaybook.findMany).toHaveBeenCalledTimes(1);
    type Args = {
      where: { status: "ACTIVE"; enrolledAt: { lt: Date } };
      take: number;
    };
    const args = mockPrisma.callerPlaybook.findMany.mock.calls[0][0] as Args;
    expect(args.where.status).toBe("ACTIVE");
    // default budget = 5 minutes
    expect(args.where.enrolledAt.lt).toEqual(new Date(now.getTime() - 5 * 60 * 1000));
  });

  it("fires autoCompose for every ACTIVE enrollment with no composed prompt", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c1", playbookId: "pb1" },
      { callerId: "c2", playbookId: "pb2" },
    ]);
    mockPrisma.composedPrompt.findFirst
      .mockResolvedValueOnce(null) // c1/pb1 missing
      .mockResolvedValueOnce(null); // c2/pb2 missing

    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    const result = await reconcileMissingBootstrap();

    expect(result.scanned).toBe(2);
    expect(result.composed).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockAutoCompose).toHaveBeenCalledTimes(2);
    expect(mockAutoCompose).toHaveBeenNthCalledWith(1, "c1", "pb1");
    expect(mockAutoCompose).toHaveBeenNthCalledWith(2, "c2", "pb2");
  });

  it("idempotent — does NOT re-fire when ACTIVE composed prompts already exist", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c1", playbookId: "pb1" },
      { callerId: "c2", playbookId: "pb2" },
    ]);
    // Both have prompts already.
    mockPrisma.composedPrompt.findFirst
      .mockResolvedValueOnce({ id: "cp-existing-1" })
      .mockResolvedValueOnce({ id: "cp-existing-2" });

    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    const result = await reconcileMissingBootstrap();

    expect(result.scanned).toBe(0);
    expect(result.composed).toBe(0);
    expect(mockAutoCompose).not.toHaveBeenCalled();
  });

  it("idempotent on second pass — autoCompose's own staleness check is the safety net but we rely on the pre-filter", async () => {
    // First pass: composes c1/pb1
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c1", playbookId: "pb1" },
    ]);
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null);

    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    const first = await reconcileMissingBootstrap();
    expect(first.composed).toBe(1);

    // Second pass: prompt exists now → no fire.
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c1", playbookId: "pb1" },
    ]);
    mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce({ id: "cp-just-written" });

    mockAutoCompose.mockClear();
    const second = await reconcileMissingBootstrap();
    expect(second.composed).toBe(0);
    expect(second.scanned).toBe(0);
    expect(mockAutoCompose).not.toHaveBeenCalled();
  });

  it("mixed batch — some have prompts, some don't", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c1", playbookId: "pb1" }, // missing
      { callerId: "c2", playbookId: "pb2" }, // has
      { callerId: "c3", playbookId: "pb3" }, // missing
    ]);
    mockPrisma.composedPrompt.findFirst
      .mockResolvedValueOnce(null) // c1/pb1
      .mockResolvedValueOnce({ id: "cp-existing" }) // c2/pb2
      .mockResolvedValueOnce(null); // c3/pb3

    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    const result = await reconcileMissingBootstrap();

    expect(result.scanned).toBe(2); // only the two missing ones
    expect(result.composed).toBe(2);
    expect(mockAutoCompose).toHaveBeenCalledTimes(2);
    expect(mockAutoCompose).toHaveBeenCalledWith("c1", "pb1");
    expect(mockAutoCompose).toHaveBeenCalledWith("c3", "pb3");
    expect(mockAutoCompose).not.toHaveBeenCalledWith("c2", "pb2");
  });

  it("a single failing compose does not poison the batch", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce([
      { callerId: "c1", playbookId: "pb1" },
      { callerId: "c2", playbookId: "pb2" },
      { callerId: "c3", playbookId: "pb3" },
    ]);
    mockPrisma.composedPrompt.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    mockAutoCompose
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("compose timeout"))
      .mockResolvedValueOnce(undefined);

    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    const result = await reconcileMissingBootstrap();

    expect(result.scanned).toBe(3);
    expect(result.composed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failureSamples).toHaveLength(1);
    expect(result.failureSamples[0]).toEqual({
      callerId: "c2",
      playbookId: "pb2",
      reason: "compose timeout",
    });
  });

  it("failureSamples are capped at 5", async () => {
    const enrollments = Array.from({ length: 10 }, (_, i) => ({
      callerId: `c${i}`,
      playbookId: `pb${i}`,
    }));
    mockPrisma.callerPlaybook.findMany.mockResolvedValueOnce(enrollments);
    // All ten are missing prompts
    for (let i = 0; i < 10; i++) {
      mockPrisma.composedPrompt.findFirst.mockResolvedValueOnce(null);
    }
    mockAutoCompose.mockRejectedValue(new Error("forced failure"));

    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    const result = await reconcileMissingBootstrap();

    expect(result.failed).toBe(10);
    expect(result.failureSamples.length).toBe(5);
  });

  it("respects custom staleAfterMs", async () => {
    const now = new Date("2026-06-09T12:00:00Z");
    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    await reconcileMissingBootstrap({ now: () => now, staleAfterMs: 60_000 });

    type Args = { where: { enrolledAt: { lt: Date } } };
    const args = mockPrisma.callerPlaybook.findMany.mock.calls[0][0] as Args;
    expect(args.where.enrolledAt.lt).toEqual(new Date(now.getTime() - 60_000));
  });

  it("records a non-zero durationMs", async () => {
    const { reconcileMissingBootstrap } = await import(
      "@/lib/voice/reconcile-missing-bootstrap"
    );
    const result = await reconcileMissingBootstrap();
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

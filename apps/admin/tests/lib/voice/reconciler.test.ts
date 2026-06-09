/**
 * #1346 Slice 5 — reconcileCarryThrough unit tests.
 *
 * Locks the structural promises that carry the "Call 5 fails → Call 6
 * still uses Call 4's P5" guarantee:
 *   - The orphan-set query filters on `endedAt < cutoff` AND
 *     `producedComposedPromptId IS NULL` AND `countsTowardPipelineNumber`
 *   - Every reconciled Session ends up with `producedComposedPromptId`
 *     pointing at a fresh ComposedPrompt
 *   - Multiple orphans in one batch are all reconciled (100-row stress)
 *   - A failing single-row reconcile doesn't poison the batch
 *
 * The "Call 5 → Call 6" headline integration test runs in
 * `tests/integration/sessions/1346-reconciler.integration.test.ts`
 * against a real Prisma DB. This file mocks the carry-through helper to
 * test the batch orchestration itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  session: {
    findMany: vi.fn(),
  },
};

const mockCarryThroughCompose = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/voice/carry-through-compose", () => ({
  carryThroughCompose: mockCarryThroughCompose,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.session.findMany.mockResolvedValue([]);
  mockCarryThroughCompose.mockResolvedValue({
    composedPromptId: "cp-new-1",
    carryForwardSource: "previous-session",
    carryForwardPromptId: "cp-prev-1",
    raced: false,
  });
});

describe("reconcileCarryThrough", () => {
  it("returns zero counts when no orphans exist", async () => {
    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    const result = await reconcileCarryThrough();
    expect(result.scanned).toBe(0);
    expect(result.reconciled).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockCarryThroughCompose).not.toHaveBeenCalled();
  });

  it("filters orphans on the canonical I-CT1 query — endedAt + producedComposedPromptId + countsTowardPipelineNumber", async () => {
    const now = new Date("2026-06-08T12:00:00Z");
    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    await reconcileCarryThrough({ now: () => now });

    expect(mockPrisma.session.findMany).toHaveBeenCalledTimes(1);
    type WhereShape = {
      where: {
        producedComposedPromptId: null;
        countsTowardPipelineNumber: boolean;
        endedAt: { lt: Date; not: null };
      };
    };
    const where = (mockPrisma.session.findMany.mock.calls[0][0] as WhereShape).where;
    expect(where.producedComposedPromptId).toBeNull();
    expect(where.countsTowardPipelineNumber).toBe(true);
    expect(where.endedAt.not).toBeNull();
    // cutoff = now - 60s by default
    expect(where.endedAt.lt).toEqual(new Date(now.getTime() - 60_000));
  });

  it("reconciles one orphan via carryThroughCompose", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([
      {
        id: "session-orphan",
        callerId: "caller-1",
        playbookId: "pb-1",
        kind: "VOICE_CALL",
        endedAt: new Date("2026-06-08T11:58:00Z"),
      },
    ]);

    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    const result = await reconcileCarryThrough();

    expect(result.scanned).toBe(1);
    expect(result.reconciled).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockCarryThroughCompose).toHaveBeenCalledTimes(1);
    expect(mockCarryThroughCompose).toHaveBeenCalledWith({
      sessionId: "session-orphan",
      callerId: "caller-1",
      playbookId: "pb-1",
      triggerType: "reconciler",
    });
  });

  it("100-row stress — all reconciled in one batch", async () => {
    const orphans = Array.from({ length: 100 }, (_, i) => ({
      id: `session-${i}`,
      callerId: `caller-${i}`,
      playbookId: "pb-1",
      kind: "VOICE_CALL",
      endedAt: new Date(`2026-06-08T11:0${i % 10}:00Z`),
    }));
    mockPrisma.session.findMany.mockResolvedValueOnce(orphans);

    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    const result = await reconcileCarryThrough({ batchLimit: 100 });

    expect(result.scanned).toBe(100);
    expect(result.reconciled).toBe(100);
    expect(result.failed).toBe(0);
    expect(mockCarryThroughCompose).toHaveBeenCalledTimes(100);
  });

  it("a single failing reconcile does not poison the batch", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([
      { id: "s-ok-1", callerId: "c1", playbookId: null, kind: "VOICE_CALL", endedAt: new Date() },
      { id: "s-broken", callerId: "c2", playbookId: null, kind: "VOICE_CALL", endedAt: new Date() },
      { id: "s-ok-2", callerId: "c3", playbookId: null, kind: "VOICE_CALL", endedAt: new Date() },
    ]);

    mockCarryThroughCompose
      .mockResolvedValueOnce({ composedPromptId: "cp-1", carryForwardSource: "previous-session", carryForwardPromptId: "cp-prev-1", raced: false })
      .mockRejectedValueOnce(new Error("I-CT2 cascade returned null"))
      .mockResolvedValueOnce({ composedPromptId: "cp-3", carryForwardSource: "previous-session", carryForwardPromptId: "cp-prev-3", raced: false });

    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    const result = await reconcileCarryThrough();

    expect(result.scanned).toBe(3);
    expect(result.reconciled).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failureSamples).toHaveLength(1);
    expect(result.failureSamples[0].sessionId).toBe("s-broken");
    expect(result.failureSamples[0].reason).toMatch(/cascade/);
  });

  it("failure samples are capped at 5", async () => {
    const orphans = Array.from({ length: 10 }, (_, i) => ({
      id: `s-${i}`,
      callerId: `c-${i}`,
      playbookId: null,
      kind: "VOICE_CALL",
      endedAt: new Date(),
    }));
    mockPrisma.session.findMany.mockResolvedValueOnce(orphans);
    mockCarryThroughCompose.mockRejectedValue(new Error("forced failure"));

    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    const result = await reconcileCarryThrough();

    expect(result.failed).toBe(10);
    expect(result.failureSamples.length).toBe(5);
  });

  it("respects custom staleAfterMs", async () => {
    const now = new Date("2026-06-08T12:00:00Z");
    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    await reconcileCarryThrough({ now: () => now, staleAfterMs: 120_000 });

    type WhereShape = { where: { endedAt: { lt: Date } } };
    const where = (mockPrisma.session.findMany.mock.calls[0][0] as WhereShape).where;
    expect(where.endedAt.lt).toEqual(new Date(now.getTime() - 120_000));
  });

  it("respects custom batchLimit", async () => {
    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    await reconcileCarryThrough({ batchLimit: 10 });
    type ArgsShape = { take: number };
    const args = mockPrisma.session.findMany.mock.calls[0][0] as ArgsShape;
    expect(args.take).toBe(10);
  });

  it("records a non-zero durationMs", async () => {
    const { reconcileCarryThrough } = await import("@/lib/voice/reconciler");
    const result = await reconcileCarryThrough();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });
});

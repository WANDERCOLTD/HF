/**
 * Tests for lib/voice/cost-aggregator.ts (AnyVoice #1028).
 *
 * Locks the aggregation contract the educator UI panel and the admin
 * system-wide page depend on:
 *   - Sum across calls with non-null voiceCostUsd
 *   - Null cost rows excluded (SIM calls, billing failures)
 *   - Per-provider grouping
 *   - 30-day default window
 *   - Zero-call result returns 0 / empty array, not throw
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: { groupBy: vi.fn() },
    caller: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  getVoiceCostForCaller,
  getVoiceCostForCohort,
  getVoiceCostForPlaybook,
  getVoiceCostByProviderSystemWide,
} from "@/lib/voice/cost-aggregator";

describe("voice cost aggregator (#1028)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums voiceCostUsd across a caller's calls and groups by provider", async () => {
    (prisma.call.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { voiceProvider: "vapi", _sum: { voiceCostUsd: 0.15 }, _count: { _all: 3 } },
    ]);

    const result = await getVoiceCostForCaller("caller-1");

    expect(result.totalUsd).toBeCloseTo(0.15, 6);
    expect(result.callCount).toBe(3);
    expect(result.byProvider).toEqual([
      { provider: "vapi", totalUsd: 0.15, callCount: 3 },
    ]);
    // groupBy must filter null voiceCostUsd — assert in the call args
    const callArgs = (prisma.call.groupBy as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.where.voiceCostUsd).toEqual({ not: null });
  });

  it("returns zero-summary when the caller has no recorded-cost calls", async () => {
    (prisma.call.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getVoiceCostForCaller("caller-noop");

    expect(result.totalUsd).toBe(0);
    expect(result.callCount).toBe(0);
    expect(result.byProvider).toEqual([]);
    expect(result.since).toBeTruthy();
  });

  it("rolls up across multiple providers in the same scope", async () => {
    (prisma.call.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { voiceProvider: "vapi", _sum: { voiceCostUsd: 0.12 }, _count: { _all: 2 } },
      { voiceProvider: "retell", _sum: { voiceCostUsd: 0.08 }, _count: { _all: 1 } },
    ]);

    const result = await getVoiceCostByProviderSystemWide();

    expect(result.totalUsd).toBeCloseTo(0.2, 6);
    expect(result.callCount).toBe(3);
    expect(result.byProvider).toHaveLength(2);
  });

  it("cohort aggregation expands members via both legacy + multi-cohort paths", async () => {
    (prisma.caller.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "caller-a" },
      { id: "caller-b" },
    ]);
    (prisma.call.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { voiceProvider: "vapi", _sum: { voiceCostUsd: 0.3 }, _count: { _all: 5 } },
    ]);

    const result = await getVoiceCostForCohort("cohort-1");

    // Members lookup was issued with both relations
    const memberArgs = (prisma.caller.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(memberArgs.where.OR).toEqual([
      { cohortGroupId: "cohort-1" },
      { cohortMemberships: { some: { cohortGroupId: "cohort-1" } } },
    ]);
    // groupBy scoped to the resolved member ids
    const callArgs = (prisma.call.groupBy as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.where.callerId).toEqual({ in: ["caller-a", "caller-b"] });
    expect(result.totalUsd).toBeCloseTo(0.3, 6);
  });

  it("cohort with zero members returns zero-summary without querying calls", async () => {
    (prisma.caller.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getVoiceCostForCohort("empty-cohort");

    expect(result.totalUsd).toBe(0);
    expect(result.callCount).toBe(0);
    expect(prisma.call.groupBy).not.toHaveBeenCalled();
  });

  it("playbook scope passes the playbookId straight to the groupBy filter", async () => {
    (prisma.call.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { voiceProvider: "vapi", _sum: { voiceCostUsd: 0.5 }, _count: { _all: 10 } },
    ]);

    await getVoiceCostForPlaybook("playbook-7");

    const callArgs = (prisma.call.groupBy as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.where.playbookId).toBe("playbook-7");
  });

  it("honours an explicit `since` Date, otherwise uses the 30-day default", async () => {
    (prisma.call.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const customSince = new Date("2026-01-01T00:00:00Z");

    await getVoiceCostForCaller("caller-x", customSince);
    const args1 = (prisma.call.groupBy as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args1.where.createdAt).toEqual({ gte: customSince });

    await getVoiceCostForCaller("caller-y");
    const args2 = (prisma.call.groupBy as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const defaultSince = args2.where.createdAt.gte;
    // Default is "now - 30 days" — verify roughly 30 days ago (allow 1 min skew)
    const diffMs = Date.now() - defaultSince.getTime();
    expect(diffMs).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 60_000);
    expect(diffMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 60_000);
  });
});

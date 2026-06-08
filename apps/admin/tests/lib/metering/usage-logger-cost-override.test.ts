/**
 * Lock tests for the explicit-`costCents` override on `UsageEventInput`
 * (surfaced 2026-06-08 during #1334 cost-baseline pull).
 *
 * Before this fix, every VOICE-category UsageEvent landed in the table
 * with `costCents = 0` because `calculateCost(1, 0, "count") = 0` and
 * the voice operation namespace isn't in DEFAULT_COST_RATES. The fix
 * lets callers pass `costCents` explicitly — voice telemetry uses this
 * to propagate VAPI's status-update cost deltas into the column.
 *
 * Companion: `tests/lib/voice/voice-telemetry-cost.test.ts` exercises
 * the voice-side wrapper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    usageEvent: { create: vi.fn(), createMany: vi.fn() },
  },
}));

vi.mock("@/lib/metering/cost-config", () => ({
  getCostRate: vi.fn().mockResolvedValue({ costPerUnit: 0, unitType: "count" }),
  calculateCost: vi.fn().mockReturnValue(0),
}));

import { prisma } from "@/lib/prisma";
import { logUsageEvent, logUsageEventsBatch } from "@/lib/metering/usage-logger";

describe("logUsageEvent — explicit costCents override (surfaced #1334)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.usageEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ue-1",
    });
  });

  it("writes provided costCents to the column when override supplied", async () => {
    await logUsageEvent({
      category: "VOICE",
      operation: "voice:vapi:webhook:status-update",
      costCents: 47,
    });

    const call = (prisma.usageEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.costCents).toBe(47);
  });

  it("falls back to calculateCost when no override supplied (preserves AI/other path)", async () => {
    await logUsageEvent({
      category: "AI",
      operation: "ai:claude:input",
      quantity: 1000,
    });
    // calculateCost is mocked to return 0 — confirms we hit the rate-table branch.
    const call = (prisma.usageEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.costCents).toBe(0);
  });

  it("treats `costCents: 0` as an explicit override (not a missing value)", async () => {
    // Edge case: a free turn legitimately has costCents=0. Must not
    // fall through to calculateCost(); ought to write 0 explicitly.
    await logUsageEvent({
      category: "VOICE",
      operation: "voice:vapi:webhook:status-update",
      costCents: 0,
    });
    const call = (prisma.usageEvent.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.costCents).toBe(0);
  });
});

describe("logUsageEventsBatch — explicit costCents override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.usageEvent.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 2,
    });
  });

  it("honors costCents override per-row in the batch payload", async () => {
    await logUsageEventsBatch([
      { category: "VOICE", operation: "voice:vapi:webhook:status-update", costCents: 12 },
      { category: "VOICE", operation: "voice:vapi:webhook:status-update", costCents: 38 },
    ]);
    const call = (prisma.usageEvent.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data[0].costCents).toBe(12);
    expect(call.data[1].costCents).toBe(38);
  });

  it("mixed-mode batch: respects override on some rows, calculates on others", async () => {
    await logUsageEventsBatch([
      { category: "VOICE", operation: "voice:vapi:webhook:status-update", costCents: 99 },
      { category: "AI", operation: "ai:claude:input", quantity: 500 },
    ]);
    const call = (prisma.usageEvent.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data[0].costCents).toBe(99);
    expect(call.data[1].costCents).toBe(0); // from mocked calculateCost
  });
});

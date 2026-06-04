/**
 * Tests for the VOICE UsageCategory rate + minutes/seconds calculation
 * (AnyVoice #1028).
 *
 * Locks the contract TL flagged in the #1015 epic re-review: VAPI bills
 * per-minute; do NOT extend EXTERNAL:vapi (per-call count semantics)
 * because mixing the two corrupts rollups in lib/metering/rollup.ts.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { usageCostRate: { findFirst: vi.fn().mockResolvedValue(null) } },
}));

import { DEFAULT_COST_RATES, calculateCost, getCostRate } from "@/lib/metering/cost-config";

describe("VOICE UsageCategory (#1028)", () => {
  it("DEFAULT_COST_RATES has VOICE:vapi:inbound and outbound entries", () => {
    expect(DEFAULT_COST_RATES["VOICE:vapi:inbound"]).toBeDefined();
    expect(DEFAULT_COST_RATES["VOICE:vapi:inbound"].unitType).toBe("minutes");
    expect(DEFAULT_COST_RATES["VOICE:vapi:outbound"]).toBeDefined();
    expect(DEFAULT_COST_RATES["VOICE:vapi:outbound"].unitType).toBe("minutes");
  });

  it("EXTERNAL:vapi remains per-call count — voice rates do not regress its semantics", () => {
    // Negative-space assertion. TL flag: do NOT extend EXTERNAL:vapi.
    expect(DEFAULT_COST_RATES["EXTERNAL:vapi"].unitType).toBe("count");
  });

  it('calculateCost("minutes") converts seconds → minutes before rate multiplication', () => {
    // 180 seconds × $0.05/minute = $0.15
    expect(calculateCost(180, 0.05, "minutes")).toBeCloseTo(0.15, 6);
    // 90 seconds × $0.05/minute = $0.075
    expect(calculateCost(90, 0.05, "minutes")).toBeCloseTo(0.075, 6);
  });

  it('calculateCost("seconds") passes quantity through (per-second billing)', () => {
    // 30 seconds × $0.001/second = $0.03
    expect(calculateCost(30, 0.001, "seconds")).toBeCloseTo(0.03, 6);
  });

  it("getCostRate falls back to the DEFAULT_COST_RATES entry when DB has no override", async () => {
    const rate = await getCostRate("VOICE", "vapi:inbound");
    expect(rate.costPerUnit).toBe(DEFAULT_COST_RATES["VOICE:vapi:inbound"].costPerUnit);
    expect(rate.unitType).toBe("minutes");
  });
});

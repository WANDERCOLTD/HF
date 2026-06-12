/**
 * Pins the SKILL_MEASURE_V1 contract → getSkillTierMapping() resolution chain.
 *
 * Regression guard for the silent-config-bypass bug: getSkillTierMapping (and the
 * sibling EMA config read in aggregate-runner) called the NON-EXISTENT
 * `ContractRegistry.get()` instead of `getContract()`. The TypeError was swallowed
 * by a bare catch, so tuned contract thresholds/bands were silently ignored and the
 * hardcoded SKILL_TIER_DEFAULTS always won — even when an org had seeded a contract.
 *
 * These tests assert that a seeded contract's values actually flow through. Under the
 * old `.get` typo the first test FAILS (defaults returned); after the fix it passes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPlaybookFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    playbook: { findUnique: (...a: any[]) => mockPlaybookFindUnique(...a) },
  },
  db: (tx?: unknown) => tx,
}));

const mockGetContract = vi.fn();
vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    getContract: (...a: any[]) => mockGetContract(...a),
  },
}));

import { getSkillTierMapping } from "@/lib/goals/track-progress";

// Tuned values deliberately distinct from SKILL_TIER_DEFAULTS so a default-fallthrough
// is unambiguously detectable.
const TUNED = {
  thresholds: { approachingEmerging: 0.2, emerging: 0.45, developing: 0.6, secure: 1.0 },
  tierBands: { approachingEmerging: 2, emerging: 4, developing: 6, secure: 8 },
};

describe("getSkillTierMapping — SKILL_MEASURE_V1 contract resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlaybookFindUnique.mockResolvedValue(null);
  });

  it("flows tuned contract thresholds + tierBands through (regression pin for the .get typo)", async () => {
    mockGetContract.mockResolvedValue(TUNED);

    const mapping = await getSkillTierMapping(null);

    expect(mockGetContract).toHaveBeenCalledWith("SKILL_MEASURE_V1");
    expect(mapping.thresholds.emerging).toBe(0.45);
    expect(mapping.tierBands.developing).toBe(6);
  });

  it("falls back to defaults when the contract is not seeded (getContract → null)", async () => {
    mockGetContract.mockResolvedValue(null);

    const mapping = await getSkillTierMapping(null);

    // SKILL_TIER_DEFAULTS.thresholds.emerging is 0.55 — distinct from the tuned 0.45.
    expect(mapping.thresholds.emerging).toBe(0.55);
  });

  it("falls back to defaults (does not throw) when the contract read errors", async () => {
    mockGetContract.mockRejectedValue(new Error("registry down"));

    const mapping = await getSkillTierMapping(null);

    expect(mapping.thresholds.emerging).toBe(0.55);
  });

  it("playbook config override takes precedence over the contract", async () => {
    mockPlaybookFindUnique.mockResolvedValue({
      config: {
        skillTierMapping: {
          thresholds: { approachingEmerging: 0.1, emerging: 0.3, developing: 0.5, secure: 1.0 },
          tierBands: { approachingEmerging: 1, emerging: 2, developing: 3, secure: 4 },
        },
      },
    });
    mockGetContract.mockResolvedValue(TUNED);

    const mapping = await getSkillTierMapping("pb-1");

    // Playbook wins → emerging 0.3, and the contract is never consulted.
    expect(mapping.thresholds.emerging).toBe(0.3);
    expect(mockGetContract).not.toHaveBeenCalled();
  });
});

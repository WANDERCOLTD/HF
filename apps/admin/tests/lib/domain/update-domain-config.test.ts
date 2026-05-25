/**
 * Tests for `lib/domain/update-domain-config.ts` — #828 Story 4.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  domain: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("updateDomainConfig — #828", () => {
  let updateDomainConfig: typeof import("@/lib/domain/update-domain-config").updateDomainConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/domain/update-domain-config");
    updateDomainConfig = mod.updateDomainConfig;
    mockPrisma.domain.update.mockImplementation(async ({ data }) => ({ id: "d1", ...data }));
  });

  it("onboardingFlowPhases change → timestampBumped", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingFlowPhases: { phases: [{ phase: "old" }] },
      onboardingDefaultTargets: null,
      onboardingWelcome: null,
      onboardingIdentitySpecId: null,
    });
    const r = await updateDomainConfig("d1", (d) => ({
      ...d,
      onboardingFlowPhases: { phases: [{ phase: "new" }] } as any,
    }));
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(true);
    expect(mockPrisma.domain.update.mock.calls[0][0].data.composeInputsUpdatedAt).toBeInstanceOf(Date);
  });

  it("onboardingWelcome change → bumped", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingFlowPhases: null,
      onboardingDefaultTargets: null,
      onboardingWelcome: "old",
      onboardingIdentitySpecId: null,
    });
    const r = await updateDomainConfig("d1", (d) => ({ ...d, onboardingWelcome: "new" }));
    expect(r.timestampBumped).toBe(true);
  });

  it("onboardingDefaultTargets change → bumped", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingFlowPhases: null,
      onboardingDefaultTargets: { "BEH-WARMTH": { value: 0.5, confidence: 0.5 } },
      onboardingWelcome: null,
      onboardingIdentitySpecId: null,
    });
    const r = await updateDomainConfig("d1", (d) => ({
      ...d,
      onboardingDefaultTargets: { "BEH-WARMTH": { value: 0.8, confidence: 0.5 } } as any,
    }));
    expect(r.timestampBumped).toBe(true);
  });

  it("onboardingIdentitySpecId change → bumped", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingFlowPhases: null,
      onboardingDefaultTargets: null,
      onboardingWelcome: null,
      onboardingIdentitySpecId: "spec-a",
    });
    const r = await updateDomainConfig("d1", (d) => ({ ...d, onboardingIdentitySpecId: "spec-b" }));
    expect(r.timestampBumped).toBe(true);
  });

  it("idempotent re-save (no diff) → no bump", async () => {
    const initial = {
      onboardingFlowPhases: { phases: [{ phase: "same" }] },
      onboardingDefaultTargets: null,
      onboardingWelcome: null,
      onboardingIdentitySpecId: null,
    };
    mockPrisma.domain.findUnique.mockResolvedValue(initial);
    const r = await updateDomainConfig("d1", (d) => d);
    expect(r.composeAffectingChanged).toBe(false);
    expect(r.timestampBumped).toBe(false);
  });

  it("skipTimestamp suppresses even when compose-affecting changed", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue({
      onboardingFlowPhases: null,
      onboardingDefaultTargets: null,
      onboardingWelcome: "old",
      onboardingIdentitySpecId: null,
    });
    const r = await updateDomainConfig(
      "d1",
      (d) => ({ ...d, onboardingWelcome: "new" }),
      { skipTimestamp: true },
    );
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(false);
  });

  it("missing domainId throws", async () => {
    await expect(updateDomainConfig("", (d) => d)).rejects.toThrow(/domainId is required/);
  });

  it("missing domain throws", async () => {
    mockPrisma.domain.findUnique.mockResolvedValue(null);
    await expect(updateDomainConfig("missing", (d) => d)).rejects.toThrow(/domain missing not found/);
  });
});

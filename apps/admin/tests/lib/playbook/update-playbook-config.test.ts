/**
 * Tests for `lib/playbook/update-playbook-config.ts` — #826 Story 2.
 *
 * Covers the post-#825 stamp-on-write mechanism:
 *  - compose-affecting key change → composeInputsUpdatedAt bumped
 *  - non-compose-affecting key change → no bump
 *  - idempotent re-save (same config) → no bump
 *  - skipTimestamp: true → no bump even when compose-affecting changed
 *  - multi-key diff with at least one compose-affecting → bump fires
 *  - transformer receives a deep clone (mutating it doesn't alias the caller's ref)
 *  - missing playbookId → throws clean error
 *  - missing playbook row → throws clean error
 *  - config is persisted regardless of whether timestamp bumped
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbook: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// #1429 — updatePlaybookConfig fires the eager-reprompt fan-out after
// a compose-affecting bump. Stub it so this test stays focused on the
// stamp-on-write mechanism. Production behaviour is covered by
// `tests/lib/compose/eager-reprompt-on-bump.test.ts`.
vi.mock("@/lib/compose/eager-reprompt-on-bump", () => ({
  triggerEagerRepromptForDemoCallers: vi.fn().mockResolvedValue({
    callerIds: [],
    attempted: 0,
    failures: [],
  }),
}));

describe("updatePlaybookConfig — #826 stamp-on-write helper", () => {
  let updatePlaybookConfig: typeof import("@/lib/playbook/update-playbook-config").updatePlaybookConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/playbook/update-playbook-config");
    updatePlaybookConfig = mod.updatePlaybookConfig;
    mockPrisma.playbook.update.mockImplementation(async ({ data }) => ({
      id: "pb1",
      ...data,
    }));
  });

  it("compose-affecting key change → composeInputsUpdatedAt bumped", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { firstCallMode: "onboarding" },
    });
    const result = await updatePlaybookConfig("pb1", (c) => ({
      ...c,
      firstCallMode: "baseline_assessment",
    }));
    expect(result.composeAffectingChanged).toBe(true);
    expect(result.timestampBumped).toBe(true);
    const updateArgs = mockPrisma.playbook.update.mock.calls[0][0];
    expect(updateArgs.data.composeInputsUpdatedAt).toBeInstanceOf(Date);
  });

  it("non-compose-affecting key change → no bump", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { skillScoringEmaHalfLifeDays: 14 },
    });
    const result = await updatePlaybookConfig("pb1", (c) => ({
      ...c,
      skillScoringEmaHalfLifeDays: 28,
    }));
    expect(result.composeAffectingChanged).toBe(false);
    expect(result.timestampBumped).toBe(false);
    const updateArgs = mockPrisma.playbook.update.mock.calls[0][0];
    expect(updateArgs.data.composeInputsUpdatedAt).toBeUndefined();
  });

  it("idempotent re-save (same config) → no bump", async () => {
    const cfg = { firstCallMode: "onboarding" as const, skillScoringEmaHalfLifeDays: 14 };
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: cfg });
    const result = await updatePlaybookConfig("pb1", (c) => c);
    expect(result.composeAffectingChanged).toBe(false);
    expect(result.timestampBumped).toBe(false);
  });

  it("skipTimestamp: true → no bump even when compose-affecting changed", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { firstCallMode: "onboarding" },
    });
    const result = await updatePlaybookConfig(
      "pb1",
      (c) => ({ ...c, firstCallMode: "teach_immediately" }),
      { skipTimestamp: true },
    );
    expect(result.composeAffectingChanged).toBe(true); // still detected
    expect(result.timestampBumped).toBe(false); // but suppressed
    const updateArgs = mockPrisma.playbook.update.mock.calls[0][0];
    expect(updateArgs.data.composeInputsUpdatedAt).toBeUndefined();
  });

  it("multi-key diff: at least one compose-affecting → bump fires", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { firstCallMode: "onboarding" as const, skillScoringEmaHalfLifeDays: 14 },
    });
    const result = await updatePlaybookConfig("pb1", (c) => ({
      ...c,
      firstCallMode: "baseline_assessment", // compose-affecting
      skillScoringEmaHalfLifeDays: 28, // not compose-affecting
    }));
    expect(result.composeAffectingChanged).toBe(true);
    expect(result.timestampBumped).toBe(true);
  });

  it("transformer receives a deep clone — mutating it doesn't alias the original", async () => {
    const originalConfig = { firstCallMode: "onboarding", nested: { a: 1 } };
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: originalConfig });
    let receivedRef: any = null;
    await updatePlaybookConfig("pb1", (c) => {
      receivedRef = c;
      c.firstCallMode = "baseline_assessment";
      (c as any).nested.a = 999; // mutate nested
      return c;
    });
    // The reference handed to the transformer is NOT the original DB row's object
    expect(receivedRef).not.toBe(originalConfig);
    expect(originalConfig.nested.a).toBe(1); // original is untouched
  });

  it("missing playbookId → throws clean error", async () => {
    await expect(
      updatePlaybookConfig("", () => ({ firstCallMode: "onboarding" })),
    ).rejects.toThrow(/playbookId is required/);
    expect(mockPrisma.playbook.findUnique).not.toHaveBeenCalled();
  });

  it("missing playbook row → throws clean error", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    await expect(
      updatePlaybookConfig("pb-missing", (c) => c),
    ).rejects.toThrow(/playbook pb-missing not found/);
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
  });

  it("config persisted in the update payload regardless of timestamp", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { skillScoringEmaHalfLifeDays: 7 },
    });
    await updatePlaybookConfig("pb1", (c) => ({
      ...c,
      skillScoringEmaHalfLifeDays: 21,
    }));
    const updateArgs = mockPrisma.playbook.update.mock.calls[0][0];
    expect(updateArgs.data.config).toEqual({ skillScoringEmaHalfLifeDays: 21 });
  });

  it("transformer can return a brand-new object (not a mutation of the input)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { firstCallMode: "onboarding" },
    });
    const result = await updatePlaybookConfig("pb1", () => ({
      firstCallMode: "baseline_assessment",
    }));
    expect(result.composeAffectingChanged).toBe(true);
    expect(result.timestampBumped).toBe(true);
  });

  it("null/undefined config on existing playbook treated as empty object", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: null });
    const result = await updatePlaybookConfig("pb1", () => ({
      firstCallMode: "baseline_assessment",
    }));
    expect(result.composeAffectingChanged).toBe(true);
    expect(result.timestampBumped).toBe(true);
  });
});

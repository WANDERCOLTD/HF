/**
 * Tests for `lib/playbook/update-playbook-config.ts` — central enforcement
 * of the TUNER -> COMPOSE chain-contract (Link 3 sub-contract).
 *
 * Covers:
 *  - Transformer mutates a deep-cloned copy (no DB-row aliasing).
 *  - COMPOSE-affecting key change triggers fan-out.
 *  - Non-compose-affecting key change skips fan-out.
 *  - Idempotent re-save (no real change) does NOT fan out.
 *  - Missing playbook throws.
 *  - `skipFanOut: true` honoured for seed/migration callsites.
 *  - Empty roster: write succeeds, no autoCompose calls.
 *  - Multiple compose-affecting keys reported in `changedKeys`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  playbook: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: () => mockPrisma }));

const mockAutoCompose = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/enrollment/auto-compose", () => ({
  autoComposeForCaller: mockAutoCompose,
}));

const mockGetRoster = vi.fn();
vi.mock("@/lib/enrollment", () => ({
  getPlaybookRoster: mockGetRoster,
}));

async function flushDynamicImports() {
  await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 10));
}

describe("updatePlaybookConfig — central chain-contract enforcement", () => {
  let updatePlaybookConfig: typeof import("@/lib/playbook/update-playbook-config").updatePlaybookConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetRoster.mockResolvedValue([
      { caller: { id: "u1" } },
      { caller: { id: "u2" } },
    ]);
    const mod = await import("@/lib/playbook/update-playbook-config");
    updatePlaybookConfig = mod.updatePlaybookConfig;
  });

  it("throws when playbook is missing", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    await expect(
      updatePlaybookConfig("missing", (c) => c),
    ).rejects.toThrow(/not found/);
  });

  it("compose-affecting key change fires fan-out, response reports it", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { firstCallMode: "onboarding" },
    });

    const result = await updatePlaybookConfig("pb1", (cfg) => {
      cfg.firstCallMode = "baseline_assessment";
      return cfg;
    });

    expect(result.composeAffected).toBe(true);
    expect(result.changedKeys).toEqual(["firstCallMode"]);
    expect(result.config.firstCallMode).toBe("baseline_assessment");

    await flushDynamicImports();
    expect(mockGetRoster).toHaveBeenCalledWith("pb1", "ACTIVE");
    expect(mockAutoCompose).toHaveBeenCalledTimes(2);
    expect(mockAutoCompose).toHaveBeenCalledWith("u1", "pb1");
    expect(mockAutoCompose).toHaveBeenCalledWith("u2", "pb1");
  });

  it("non-compose-affecting key (welcome/nps/banding) does NOT fan out", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });

    const result = await updatePlaybookConfig("pb1", (cfg) => {
      cfg.nps = { enabled: true, trigger: "mastery", threshold: 80 };
      cfg.welcome = {
        goals: { enabled: true },
        aboutYou: { enabled: true },
        knowledgeCheck: { enabled: false },
        aiIntroCall: { enabled: false },
      };
      return cfg;
    });

    expect(result.composeAffected).toBe(false);
    expect(result.changedKeys).toEqual([]);

    await flushDynamicImports();
    expect(mockAutoCompose).not.toHaveBeenCalled();
    expect(mockGetRoster).not.toHaveBeenCalled();
  });

  it("idempotent re-save (no real change) does NOT fan out", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { firstCallMode: "baseline_assessment" },
    });

    const result = await updatePlaybookConfig("pb1", (cfg) => {
      cfg.firstCallMode = "baseline_assessment"; // identical
      return cfg;
    });

    expect(result.composeAffected).toBe(false);
    expect(result.changedKeys).toEqual([]);

    await flushDynamicImports();
    expect(mockAutoCompose).not.toHaveBeenCalled();
  });

  it("clearing a compose-affecting key (delete) fans out", async () => {
    // Going back to default is a propagating change — the existing
    // ComposedPrompt still carries the override.
    mockPrisma.playbook.findUnique.mockResolvedValue({
      config: { firstCallMode: "teach_immediately" },
    });

    const result = await updatePlaybookConfig("pb1", (cfg) => {
      delete cfg.firstCallMode;
      return cfg;
    });

    expect(result.composeAffected).toBe(true);
    expect(result.changedKeys).toEqual(["firstCallMode"]);

    await flushDynamicImports();
    expect(mockAutoCompose).toHaveBeenCalledTimes(2);
  });

  it("multiple compose-affecting keys all reported in changedKeys", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });

    const result = await updatePlaybookConfig("pb1", (cfg) => {
      cfg.firstCallMode = "baseline_assessment";
      cfg.teachingMode = "practice";
      cfg.firstSessionTargets = { "BEH-WARMTH": { value: 0.85 } };
      return cfg;
    });

    expect(result.composeAffected).toBe(true);
    expect(result.changedKeys.sort()).toEqual(
      ["firstCallMode", "firstSessionTargets", "teachingMode"].sort(),
    );

    await flushDynamicImports();
    expect(mockAutoCompose).toHaveBeenCalledTimes(2);
  });

  it("skipFanOut: true honoured for seed/migration callsites", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });

    const result = await updatePlaybookConfig(
      "pb1",
      (cfg) => {
        cfg.firstCallMode = "baseline_assessment";
        return cfg;
      },
      { skipFanOut: true, reason: "seed-script" },
    );

    expect(result.composeAffected).toBe(true);
    expect(result.changedKeys).toEqual(["firstCallMode"]);

    await flushDynamicImports();
    expect(mockAutoCompose).not.toHaveBeenCalled();
    expect(mockGetRoster).not.toHaveBeenCalled();
  });

  it("empty roster: write succeeds, no autoCompose calls", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });
    mockGetRoster.mockResolvedValue([]);

    const result = await updatePlaybookConfig("pb1", (cfg) => {
      cfg.firstCallMode = "teach_immediately";
      return cfg;
    });

    expect(result.composeAffected).toBe(true);
    await flushDynamicImports();
    expect(mockGetRoster).toHaveBeenCalledWith("pb1", "ACTIVE");
    expect(mockAutoCompose).not.toHaveBeenCalled();
  });

  it("transformer mutates a clone — no DB-row aliasing", async () => {
    // The DB row's deserialised object must not be mutated, only the
    // returned config. This matters when callers rely on the returned
    // `result.config` being the post-transform shape.
    const dbRow = { config: { firstCallMode: "onboarding" } };
    mockPrisma.playbook.findUnique.mockResolvedValue(dbRow);

    await updatePlaybookConfig("pb1", (cfg) => {
      cfg.firstCallMode = "baseline_assessment";
      return cfg;
    });

    // dbRow.config.firstCallMode should remain unchanged in memory.
    expect(dbRow.config.firstCallMode).toBe("onboarding");

    await flushDynamicImports();
  });

  it("write happens BEFORE fan-out (DB consistency invariant)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({ config: {} });

    const callOrder: string[] = [];
    mockPrisma.playbook.update.mockImplementation(async () => {
      callOrder.push("update");
      return {};
    });
    mockAutoCompose.mockImplementation(async () => {
      callOrder.push("autoCompose");
    });

    await updatePlaybookConfig("pb1", (cfg) => {
      cfg.firstCallMode = "teach_immediately";
      return cfg;
    });
    await flushDynamicImports();

    // First "update" then autoCompose entries — invariant: writers
    // never see a stale DB during their own fan-out.
    expect(callOrder[0]).toBe("update");
    expect(callOrder.slice(1).every((c) => c === "autoCompose")).toBe(true);
  });
});

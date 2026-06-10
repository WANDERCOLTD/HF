/**
 * Tests for behavior-target resolver.
 * (Epic #1442 Layer 2 / story #1454.)
 *
 * Covers:
 *   - calls getEffectiveBehaviorTargetsForCaller (not mergeTargets)
 *   - returns LayerHit[] populated for SYSTEM / PLAYBOOK / CALLER when
 *     each has a value
 *   - setAt populated from BehaviorTarget.updatedAt; setBy null
 *   - all-default (no row) returns empty layers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const prismaMock = {
  behaviorTarget: { findFirst: vi.fn() },
  playbook: { findUnique: vi.fn() },
  caller: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const getEffectiveBehaviorTargetsForCaller = vi.fn();
vi.mock("@/lib/tolerance/getEffectiveBehaviorTargetsForCaller", () => ({
  getEffectiveBehaviorTargetsForCaller,
}));

const resolveCallerIdentityIds = vi.fn();
vi.mock("@/lib/agent-tuner/write-target", () => ({
  resolveCallerIdentityIds,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveBehaviorTarget — wraps the bulk cascade helper", () => {
  it("does NOT import mergeTargets (which is a COMPOSE-stage helper)", () => {
    const filePath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "lib",
      "cascade",
      "resolvers",
      "behavior-target.ts",
    );
    const src = readFileSync(filePath, "utf-8");
    // Strip line + block comments so the assertions only see code.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:\/])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bmergeTargets\b/);
    expect(code).not.toMatch(/transforms\/quickstart/);
  });

  it("returns three LayerHits when SYSTEM + PLAYBOOK + CALLER all have values", async () => {
    getEffectiveBehaviorTargetsForCaller.mockResolvedValueOnce([
      {
        parameterId: "BEH-WARMTH",
        effectiveValue: 0.8,
        sourceScope: "CALLER",
        systemValue: 0.5,
        playbookValue: 0.6,
        callerValue: 0.8,
      },
    ]);
    prismaMock.behaviorTarget.findFirst.mockResolvedValue({
      updatedAt: new Date("2026-05-01T00:00:00Z"),
    });
    prismaMock.playbook.findUnique.mockResolvedValueOnce({ name: "OCEAN" });
    prismaMock.caller.findUnique.mockResolvedValueOnce({ name: "Smoke Test" });
    resolveCallerIdentityIds.mockResolvedValueOnce({
      ok: true,
      identityIds: ["id1"],
    });

    const { resolveBehaviorTarget } = await import(
      "@/lib/cascade/resolvers/behavior-target"
    );
    const r = await resolveBehaviorTarget(
      { playbookId: "pb1", callerId: "c1" },
      "BEH-WARMTH",
    );

    expect(r.value).toBe(0.8);
    expect(r.source).toBe("CALLER");
    expect(r.layers.map((h) => h.layer)).toEqual([
      "SYSTEM",
      "PLAYBOOK",
      "CALLER",
    ]);
  });

  it("returns empty layers when bulk helper has no entry for this knob", async () => {
    getEffectiveBehaviorTargetsForCaller.mockResolvedValueOnce([]);

    const { resolveBehaviorTarget } = await import(
      "@/lib/cascade/resolvers/behavior-target"
    );
    const r = await resolveBehaviorTarget(
      { playbookId: "pb1" },
      "BEH-WARMTH",
    );

    expect(r.value).toBeNull();
    expect(r.layers).toEqual([]);
    expect(r.source).toBe("SYSTEM");
  });

  it("setAt populated from BehaviorTarget.updatedAt; setBy null", async () => {
    const setAt = new Date("2026-05-22T00:00:00Z");
    getEffectiveBehaviorTargetsForCaller.mockResolvedValueOnce([
      {
        parameterId: "BEH-WARMTH",
        effectiveValue: 0.6,
        sourceScope: "PLAYBOOK",
        systemValue: null,
        playbookValue: 0.6,
        callerValue: null,
      },
    ]);
    prismaMock.behaviorTarget.findFirst.mockResolvedValueOnce({
      updatedAt: setAt,
    });
    prismaMock.playbook.findUnique.mockResolvedValueOnce({ name: "OCEAN" });

    const { resolveBehaviorTarget } = await import(
      "@/lib/cascade/resolvers/behavior-target"
    );
    const r = await resolveBehaviorTarget({ playbookId: "pb1" }, "BEH-WARMTH");

    expect(r.layers[0].setAt).toEqual(setAt);
    expect(r.layers[0].setBy).toBeNull();
  });

  it("throws when playbookId missing", async () => {
    const { resolveBehaviorTarget } = await import(
      "@/lib/cascade/resolvers/behavior-target"
    );
    await expect(
      resolveBehaviorTarget({}, "BEH-WARMTH"),
    ).rejects.toThrow(/playbookId/);
  });
});

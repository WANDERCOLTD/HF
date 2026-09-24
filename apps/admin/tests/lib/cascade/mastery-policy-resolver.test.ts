/**
 * Tests for `lib/cascade/resolvers/mastery-policy.ts`.
 *
 * Mirrors `welcome-message.test.ts` shape and pins:
 *   1. PLAYBOOK wins over DOMAIN when both layers carry the knob
 *   2. DOMAIN-only resolution flags `isInherited: true`
 *   3. Empty resolution returns `source: "SYSTEM"` with empty layers
 *   4. Layers are emitted in SYSTEM → CALL order (Domain before Playbook)
 *   5. Throws on missing playbookId
 *   6. Throws on unsupported knobKey (defence-in-depth)
 *   7. Throws when the playbook row isn't found
 *   8. Covers both supported keys (`skillTierMapping`, `skillScoringEmaHalfLifeDays`)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn() },
    domain: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { resolveMasteryPolicyKnob } from "@/lib/cascade/resolvers/mastery-policy";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveMasteryPolicyKnob — basic gates", () => {
  it("throws on unsupported knob key", async () => {
    await expect(
      resolveMasteryPolicyKnob({ playbookId: "pb-1" }, "useFreshMastery"),
    ).rejects.toThrow(/unsupported knob "useFreshMastery"/i);
  });

  it("throws on missing playbookId", async () => {
    await expect(
      resolveMasteryPolicyKnob({ playbookId: "" }, "skillScoringEmaHalfLifeDays"),
    ).rejects.toThrow(/playbookId/i);
  });

  it("throws when playbook not found", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce(null);
    await expect(
      resolveMasteryPolicyKnob({ playbookId: "pb-missing" }, "skillTierMapping"),
    ).rejects.toThrow(/Playbook not found/);
  });
});

describe("resolveMasteryPolicyKnob — skillScoringEmaHalfLifeDays", () => {
  it("returns SYSTEM source when neither layer carries the knob", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "CTO Revision Aid",
      config: {},
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: {},
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "skillScoringEmaHalfLifeDays",
    );
    expect(result.value).toBeNull();
    expect(result.source).toBe("SYSTEM");
    expect(result.layers).toEqual([]);
    expect(result.isInherited).toBe(false);
    expect(result.recommendedLayerForEdit).toBe("PLAYBOOK");
  });

  it("PLAYBOOK wins over DOMAIN when both layers carry the knob", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "CTO Revision Aid",
      config: { skillScoringEmaHalfLifeDays: 7 },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: { skillScoringEmaHalfLifeDays: 30 },
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "skillScoringEmaHalfLifeDays",
    );
    expect(result.value).toBe(7); // PLAYBOOK overrides DOMAIN
    expect(result.source).toBe("PLAYBOOK");
    expect(result.layers).toHaveLength(2);
    // Order: SYSTEM → CALL means DOMAIN before PLAYBOOK
    expect(result.layers[0].layer).toBe("DOMAIN");
    expect(result.layers[1].layer).toBe("PLAYBOOK");
    expect(result.isInherited).toBe(false);
  });

  it("DOMAIN-only resolution flags isInherited: true", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "CTO Revision Aid",
      config: {}, // no playbook override
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: { skillScoringEmaHalfLifeDays: 4 }, // Domain default for short-demo institution
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "skillScoringEmaHalfLifeDays",
    );
    expect(result.value).toBe(4);
    expect(result.source).toBe("DOMAIN");
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].layer).toBe("DOMAIN");
    expect(result.isInherited).toBe(true);
  });
});

describe("resolveMasteryPolicyKnob — skillTierMapping", () => {
  it("supports complex object values (full tier-mapping override)", async () => {
    const cefrMapping = {
      thresholds: {
        approachingEmerging: 0.2,
        emerging: 0.4,
        developing: 0.6,
        secure: 1.0,
      },
      tierBands: {
        approachingEmerging: 1,
        emerging: 2,
        developing: 4,
        secure: 6,
      },
    };
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Speaking",
      config: {},
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "CEFR Language School",
      config: { skillTierMapping: cefrMapping },
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "skillTierMapping",
    );
    expect(result.value).toEqual(cefrMapping);
    expect(result.source).toBe("DOMAIN");
    expect(result.isInherited).toBe(true);
  });

  it("treats null value as 'no override' (not as an explicit null layer)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "CTO Revision Aid",
      config: { skillTierMapping: null },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme Institute",
      config: {},
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "skillTierMapping",
    );
    expect(result.source).toBe("SYSTEM");
    expect(result.layers).toEqual([]);
  });
});

describe("resolveMasteryPolicyKnob — #2174 S3 promoted scoring knobs", () => {
  // 4 new knobs added 2026-06-21 per Q2 + Q3 in docs/SCORING-EDITABILITY.md.
  // Same `Domain.config[knobKey]` → `Playbook.config[knobKey]` shape as
  // skillTierMapping + skillScoringEmaHalfLifeDays.

  it("tierPresetId — DOMAIN default for a CEFR-shaped Domain (Q2 fingerprint)", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "Spanish A2",
      config: {},
      domainId: "dom-cefr",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-cefr",
      name: "CEFR Language School",
      config: { tierPresetId: "cefr" },
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "tierPresetId",
    );
    expect(result.value).toBe("cefr");
    expect(result.source).toBe("DOMAIN");
    expect(result.isInherited).toBe(true);
  });

  it("loMasteryThreshold — PLAYBOOK overrides DOMAIN", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "IELTS Mock",
      config: { loMasteryThreshold: 0.75 },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Test Prep Co",
      config: { loMasteryThreshold: 0.6 },
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "loMasteryThreshold",
    );
    expect(result.value).toBe(0.75);
    expect(result.source).toBe("PLAYBOOK");
  });

  it("assessmentReadinessThreshold — DOMAIN-only inheritance flags isInherited:true", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "OCEAN",
      config: {},
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme",
      config: { assessmentReadinessThreshold: 0.8 },
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "assessmentReadinessThreshold",
    );
    expect(result.value).toBe(0.8);
    expect(result.source).toBe("DOMAIN");
    expect(result.isInherited).toBe(true);
  });

  it("progressSignals — object-valued knob returned untouched (no per-field merge)", async () => {
    const domainSignals = { lowWater: 0.3, highWater: 0.7 };
    const playbookSignals = { lowWater: 0.25, highWater: 0.85 };
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "Spot the Spin",
      config: { progressSignals: playbookSignals },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme",
      config: { progressSignals: domainSignals },
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "progressSignals",
    );
    // PLAYBOOK wins as a whole object — NOT a per-field merge across layers
    // (consistent with skillTierMapping object-knob semantics).
    expect(result.value).toEqual(playbookSignals);
    expect(result.source).toBe("PLAYBOOK");
  });
});

describe("resolveMasteryPolicyKnob — provenance TODO", () => {
  it("returns setAt: null + setBy: null until config authorship metadata lands", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValueOnce({
      id: "pb-1",
      name: "CTO Revision Aid",
      config: { skillScoringEmaHalfLifeDays: 14 },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValueOnce({
      id: "dom-1",
      name: "Acme",
      config: {},
    });
    const result = await resolveMasteryPolicyKnob(
      { playbookId: "pb-1" },
      "skillScoringEmaHalfLifeDays",
    );
    expect(result.layers[0].setAt).toBeNull();
    expect(result.layers[0].setBy).toBeNull();
  });
});

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

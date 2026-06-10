/**
 * Tests for session-flow resolver.
 * (Epic #1442 Layer 2 / story #1454.)
 *
 * Covers:
 *   - every distinct source string from resolveSessionFlow.source maps
 *     to the correct Layer via the explicit table (no fallthrough)
 *   - resolveSessionFlowKnob async path produces a valid Effective<T>
 *     envelope with a single LayerHit (winner)
 *   - throws on unknown knob key and on missing playbookId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  playbook: { findUnique: vi.fn() },
  domain: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mapSessionFlowSource", () => {
  it("maps 'domain' to DOMAIN", async () => {
    const { mapSessionFlowSource } = await import(
      "@/lib/cascade/resolvers/session-flow"
    );
    expect(mapSessionFlowSource("domain")).toBe("DOMAIN");
  });

  it("maps PLAYBOOK-tier source strings to PLAYBOOK", async () => {
    const { mapSessionFlowSource } = await import(
      "@/lib/cascade/resolvers/session-flow"
    );
    expect(mapSessionFlowSource("new-shape")).toBe("PLAYBOOK");
    expect(mapSessionFlowSource("playbook-legacy")).toBe("PLAYBOOK");
    expect(mapSessionFlowSource("legacy-welcome")).toBe("PLAYBOOK");
    expect(mapSessionFlowSource("synthesized-from-legacy")).toBe("PLAYBOOK");
  });

  it("maps SYSTEM-tier source strings to SYSTEM", async () => {
    const { mapSessionFlowSource } = await import(
      "@/lib/cascade/resolvers/session-flow"
    );
    expect(mapSessionFlowSource("init001")).toBe("SYSTEM");
    expect(mapSessionFlowSource("defaults")).toBe("SYSTEM");
  });
});

describe("resolveSessionFlowKnob — async integration", () => {
  it("returns a single-LayerHit envelope for the winning layer", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      // `sessionFlow.onboarding` present → resolveSessionFlow source = "new-shape" → PLAYBOOK.
      config: { sessionFlow: { onboarding: { phases: [] } } },
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      onboardingWelcome: null,
      onboardingFlowPhases: null,
    });

    const { resolveSessionFlowKnob } = await import(
      "@/lib/cascade/resolvers/session-flow"
    );
    const r = await resolveSessionFlowKnob({ playbookId: "pb1" }, "onboarding");

    expect(r.source).toBe("PLAYBOOK");
    expect(r.isInherited).toBe(false);
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].layer).toBe("PLAYBOOK");
    expect(r.layers[0].setAt).toBeNull();
    expect(r.layers[0].setBy).toBeNull();
  });

  it("falls through to DOMAIN-source when only Domain has an override", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      config: {},
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      onboardingWelcome: null,
      onboardingFlowPhases: { phases: [] },
    });

    const { resolveSessionFlowKnob } = await import(
      "@/lib/cascade/resolvers/session-flow"
    );
    const r = await resolveSessionFlowKnob({ playbookId: "pb1" }, "onboarding");

    expect(r.source).toBe("DOMAIN");
    expect(r.isInherited).toBe(true);
    expect(r.layers[0].layer).toBe("DOMAIN");
  });

  it("throws on unknown knob key", async () => {
    const { resolveSessionFlowKnob } = await import(
      "@/lib/cascade/resolvers/session-flow"
    );
    await expect(
      resolveSessionFlowKnob({ playbookId: "pb1" }, "voiceProvider"),
    ).rejects.toThrow(/does not handle/);
  });

  it("throws when playbookId missing", async () => {
    const { resolveSessionFlowKnob } = await import(
      "@/lib/cascade/resolvers/session-flow"
    );
    await expect(
      resolveSessionFlowKnob({}, "onboarding"),
    ).rejects.toThrow(/playbookId/);
  });
});

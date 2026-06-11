/**
 * Tests for the cascade primitive resolveEffective + cache helpers.
 * (Epic #1442 Layer 2 / story #1454.)
 *
 * Covers:
 *   - dispatch by knob key family (BEH-*, welcomeMessage, session-flow,
 *     voice-config, identity-spec)
 *   - unknown knob key throws with helpful message
 *   - cache hit within 30s (resolver fn called once)
 *   - invalidateKnob clears entries for that key
 *   - invalidateAll wipes everything
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveBehaviorTarget = vi.fn();
const resolveSessionFlowKnob = vi.fn();
const resolveWelcomeMessage = vi.fn();
const resolveVoiceConfigKnob = vi.fn();
const resolveIdentitySpec = vi.fn();

vi.mock("@/lib/cascade/resolvers/behavior-target", () => ({
  resolveBehaviorTarget,
}));
vi.mock("@/lib/cascade/resolvers/session-flow", () => ({
  resolveSessionFlowKnob,
}));
vi.mock("@/lib/cascade/resolvers/welcome-message", () => ({
  resolveWelcomeMessage,
}));
vi.mock("@/lib/cascade/resolvers/voice-config", () => ({
  resolveVoiceConfigKnob,
}));
vi.mock("@/lib/cascade/resolvers/identity-spec", () => ({
  resolveIdentitySpec,
}));

const FAKE_ENVELOPE = {
  value: 0.6,
  source: "DOMAIN" as const,
  layers: [],
  isInherited: true,
  recommendedLayerForEdit: "PLAYBOOK" as const,
};

beforeEach(async () => {
  vi.clearAllMocks();
  const { invalidateAll } = await import("@/lib/cascade/effective-value");
  invalidateAll();
  resolveBehaviorTarget.mockResolvedValue(FAKE_ENVELOPE);
  resolveSessionFlowKnob.mockResolvedValue(FAKE_ENVELOPE);
  resolveWelcomeMessage.mockResolvedValue(FAKE_ENVELOPE);
  resolveVoiceConfigKnob.mockResolvedValue(FAKE_ENVELOPE);
  resolveIdentitySpec.mockResolvedValue(FAKE_ENVELOPE);
});

describe("resolveEffective dispatch", () => {
  it("routes BEH-* to behavior-target resolver", async () => {
    const { resolveEffective } = await import("@/lib/cascade/effective-value");
    await resolveEffective({
      knobKey: "BEH-WARMTH",
      scopeChain: { playbookId: "pb1" },
    });
    expect(resolveBehaviorTarget).toHaveBeenCalledOnce();
    expect(resolveSessionFlowKnob).not.toHaveBeenCalled();
  });

  it("routes welcomeMessage to welcome-message resolver", async () => {
    const { resolveEffective } = await import("@/lib/cascade/effective-value");
    await resolveEffective({
      knobKey: "welcomeMessage",
      scopeChain: { playbookId: "pb1" },
    });
    expect(resolveWelcomeMessage).toHaveBeenCalledOnce();
  });

  it("routes session-flow sub-keys to session-flow resolver", async () => {
    const { resolveEffective } = await import("@/lib/cascade/effective-value");
    for (const k of ["onboarding", "intake", "stops", "offboarding"]) {
      await resolveEffective({
        knobKey: k,
        scopeChain: { playbookId: "pb1" },
      });
    }
    expect(resolveSessionFlowKnob).toHaveBeenCalledTimes(4);
  });

  it("routes voice keys to voice-config resolver", async () => {
    const { resolveEffective } = await import("@/lib/cascade/effective-value");
    for (const k of ["voiceProvider", "voiceId", "model", "modelTemp"]) {
      await resolveEffective({
        knobKey: k,
        scopeChain: { callerId: "c1" },
      });
    }
    expect(resolveVoiceConfigKnob).toHaveBeenCalledTimes(4);
  });

  it("routes identitySpecId to identity-spec resolver", async () => {
    const { resolveEffective } = await import("@/lib/cascade/effective-value");
    await resolveEffective({
      knobKey: "identitySpecId",
      scopeChain: { playbookId: "pb1" },
    });
    expect(resolveIdentitySpec).toHaveBeenCalledOnce();
  });

  it("throws on unknown knob key", async () => {
    const { resolveEffective } = await import("@/lib/cascade/effective-value");
    await expect(
      resolveEffective({
        knobKey: "totally-made-up",
        scopeChain: { playbookId: "pb1" },
      }),
    ).rejects.toThrow(/Unknown cascade knob key/);
  });
});

describe("resolveEffective cache", () => {
  it("returns cached value on second call within 30s (resolver fn called once)", async () => {
    const { resolveEffective } = await import("@/lib/cascade/effective-value");
    const args = {
      knobKey: "BEH-WARMTH",
      scopeChain: { playbookId: "pb1", callerId: "c1" },
    };
    await resolveEffective(args);
    await resolveEffective(args);
    expect(resolveBehaviorTarget).toHaveBeenCalledOnce();
  });

  it("treats different scopeChains as separate cache keys", async () => {
    const { resolveEffective } = await import("@/lib/cascade/effective-value");
    await resolveEffective({
      knobKey: "BEH-WARMTH",
      scopeChain: { playbookId: "pb1" },
    });
    await resolveEffective({
      knobKey: "BEH-WARMTH",
      scopeChain: { playbookId: "pb2" },
    });
    expect(resolveBehaviorTarget).toHaveBeenCalledTimes(2);
  });

  it("invalidateKnob clears entries for that knob only", async () => {
    const { resolveEffective, invalidateKnob } = await import(
      "@/lib/cascade/effective-value"
    );
    await resolveEffective({
      knobKey: "BEH-WARMTH",
      scopeChain: { playbookId: "pb1" },
    });
    await resolveEffective({
      knobKey: "BEH-CONCISION",
      scopeChain: { playbookId: "pb1" },
    });
    invalidateKnob("BEH-WARMTH");
    await resolveEffective({
      knobKey: "BEH-WARMTH",
      scopeChain: { playbookId: "pb1" },
    });
    // BEH-WARMTH: 2 calls (cached, invalidated, re-fetched).
    // BEH-CONCISION: 1 call (cached, still fresh).
    expect(resolveBehaviorTarget).toHaveBeenCalledTimes(3);
  });

  it("invalidateAll wipes every cache entry", async () => {
    const { resolveEffective, invalidateAll } = await import(
      "@/lib/cascade/effective-value"
    );
    await resolveEffective({
      knobKey: "BEH-WARMTH",
      scopeChain: { playbookId: "pb1" },
    });
    invalidateAll();
    await resolveEffective({
      knobKey: "BEH-WARMTH",
      scopeChain: { playbookId: "pb1" },
    });
    expect(resolveBehaviorTarget).toHaveBeenCalledTimes(2);
  });
});

describe("isLayerHit", () => {
  it("returns true when a layer appears in the envelope", async () => {
    const { isLayerHit } = await import("@/lib/cascade/effective-value");
    const envelope = {
      ...FAKE_ENVELOPE,
      layers: [
        {
          layer: "PLAYBOOK" as const,
          scopeId: "pb1",
          scopeLabel: "OCEAN",
          value: 0.6,
          setAt: null,
          setBy: null,
        },
      ],
    };
    expect(isLayerHit(envelope, "PLAYBOOK")).toBe(true);
    expect(isLayerHit(envelope, "DOMAIN")).toBe(false);
  });
});

describe("isResolvableKnob", () => {
  it("BEH-* keys are resolvable (behavior-target family)", async () => {
    const { isResolvableKnob } = await import("@/lib/cascade/effective-value");
    expect(isResolvableKnob("BEH-RESPONSE-LEN")).toBe(true);
    expect(isResolvableKnob("BEH-CONVERSATIONAL-TONE")).toBe(true);
    expect(isResolvableKnob("BEH-WARMTH")).toBe(true);
  });

  it("known single-key families resolve", async () => {
    const { isResolvableKnob } = await import("@/lib/cascade/effective-value");
    expect(isResolvableKnob("welcomeMessage")).toBe(true);
    expect(isResolvableKnob("identitySpecId")).toBe(true);
    expect(isResolvableKnob("voiceProvider")).toBe(true);
    expect(isResolvableKnob("voiceId")).toBe(true);
    expect(isResolvableKnob("model")).toBe(true);
    expect(isResolvableKnob("language")).toBe(true);
    expect(isResolvableKnob("onboarding")).toBe(true);
    expect(isResolvableKnob("intake")).toBe(true);
    expect(isResolvableKnob("stops")).toBe(true);
    expect(isResolvableKnob("offboarding")).toBe(true);
  });

  it("returns false for skill_* and other non-cascade parameter ids", async () => {
    const { isResolvableKnob } = await import("@/lib/cascade/effective-value");
    expect(isResolvableKnob("skill_self_locate")).toBe(false);
    expect(isResolvableKnob("skill_catch_the_misconception")).toBe(false);
    expect(isResolvableKnob("skill_name_the_trade")).toBe(false);
    expect(isResolvableKnob("")).toBe(false);
    expect(isResolvableKnob("random_unknown_key")).toBe(false);
  });
});

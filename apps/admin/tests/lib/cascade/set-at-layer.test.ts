/**
 * Tests for the cascade write router (Slice 2 of #1454 / Epic #1442).
 *
 * Covers:
 *   - No direct `prisma.*` import (source-import assertion)
 *   - PLAYBOOK BEH-* → writeBehaviorTarget
 *   - PLAYBOOK welcomeMessage → updatePlaybookConfig
 *   - PLAYBOOK voice key → updatePlaybookConfig (writes config.voice.<key>)
 *   - PLAYBOOK session-flow key → updatePlaybookConfig (writes config.sessionFlow.<key>)
 *   - DOMAIN welcomeMessage → updateDomainConfig (onboardingWelcome column)
 *   - DOMAIN identitySpecId → updateDomainConfig (onboardingIdentitySpecId column)
 *   - CALLER BEH-* → writeCallerBehaviorTarget
 *   - SEGMENT / CALL / SYSTEM throw with a descriptive Sprint-2 message
 *   - No auto-creation of intermediate scope rows (writes go to exactly the requested layer)
 *   - invalidateKnob called after successful write
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const updatePlaybookConfig = vi.fn();
const updateDomainConfig = vi.fn();
const writeBehaviorTarget = vi.fn();
const writeCallerBehaviorTarget = vi.fn();
const invalidateKnob = vi.fn();

vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig,
}));
vi.mock("@/lib/domain/update-domain-config", () => ({
  updateDomainConfig,
}));
vi.mock("@/lib/agent-tuner/write-target", () => ({
  writeBehaviorTarget,
  writeCallerBehaviorTarget,
}));
vi.mock("@/lib/cascade/effective-value", () => ({
  invalidateKnob,
  // Other exports the router doesn't touch but the module loader might.
  resolveEffective: vi.fn(),
  invalidateAll: vi.fn(),
  isLayerHit: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  writeBehaviorTarget.mockResolvedValue({ ok: true });
  writeCallerBehaviorTarget.mockResolvedValue({ ok: true });
  updatePlaybookConfig.mockResolvedValue({});
  updateDomainConfig.mockResolvedValue({});
});

describe("set-at-layer — no direct prisma access", () => {
  it("source file does NOT import @/lib/prisma", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "..", "lib", "cascade", "set-at-layer.ts"),
      "utf-8",
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:\/])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/from\s+["']@\/lib\/prisma["']/);
  });
});

describe("setKnobAtLayer — PLAYBOOK dispatch", () => {
  it("routes BEH-* to writeBehaviorTarget", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await setKnobAtLayer({
      knobKey: "BEH-WARMTH",
      layer: "PLAYBOOK",
      scopeIds: { playbookId: "pb1" },
      value: 0.6,
    });
    expect(writeBehaviorTarget).toHaveBeenCalledWith(
      "pb1",
      "BEH-WARMTH",
      0.6,
      expect.objectContaining({ source: "MANUAL" }),
    );
    expect(updatePlaybookConfig).not.toHaveBeenCalled();
  });

  it("routes welcomeMessage to updatePlaybookConfig", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await setKnobAtLayer({
      knobKey: "welcomeMessage",
      layer: "PLAYBOOK",
      scopeIds: { playbookId: "pb1" },
      value: "Hi from OCEAN",
    });
    expect(updatePlaybookConfig).toHaveBeenCalledOnce();
    const [pbId, transformer] = updatePlaybookConfig.mock.calls[0];
    expect(pbId).toBe("pb1");
    const result = transformer({});
    expect(result.welcomeMessage).toBe("Hi from OCEAN");
  });

  it("routes voice key to updatePlaybookConfig and writes under config.voice", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await setKnobAtLayer({
      knobKey: "voiceId",
      layer: "PLAYBOOK",
      scopeIds: { playbookId: "pb1" },
      value: "asteria",
    });
    expect(updatePlaybookConfig).toHaveBeenCalledOnce();
    const [, transformer] = updatePlaybookConfig.mock.calls[0];
    const result = transformer({});
    expect(result.voice).toEqual({ voiceId: "asteria" });
  });

  it("routes session-flow key under config.sessionFlow", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await setKnobAtLayer({
      knobKey: "onboarding",
      layer: "PLAYBOOK",
      scopeIds: { playbookId: "pb1" },
      value: { phases: [] },
    });
    expect(updatePlaybookConfig).toHaveBeenCalledOnce();
    const [, transformer] = updatePlaybookConfig.mock.calls[0];
    const result = transformer({});
    expect(result.sessionFlow).toEqual({ onboarding: { phases: [] } });
  });

  it("throws when playbookId missing", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await expect(
      setKnobAtLayer({
        knobKey: "BEH-WARMTH",
        layer: "PLAYBOOK",
        scopeIds: {},
        value: 0.6,
      }),
    ).rejects.toThrow(/playbookId/);
  });

  it("throws on unsupported PLAYBOOK knob", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await expect(
      setKnobAtLayer({
        knobKey: "identitySpecId",
        layer: "PLAYBOOK",
        scopeIds: { playbookId: "pb1" },
        value: "spec-x",
      }),
    ).rejects.toThrow(/not implemented/);
  });
});

describe("setKnobAtLayer — DOMAIN dispatch", () => {
  it("routes welcomeMessage to updateDomainConfig as onboardingWelcome", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await setKnobAtLayer({
      knobKey: "welcomeMessage",
      layer: "DOMAIN",
      scopeIds: { domainId: "dom1" },
      value: "Welcome from Education",
    });
    expect(updateDomainConfig).toHaveBeenCalledOnce();
    const [, transformer] = updateDomainConfig.mock.calls[0];
    const result = transformer({});
    expect(result.onboardingWelcome).toBe("Welcome from Education");
  });

  it("routes identitySpecId to updateDomainConfig as onboardingIdentitySpecId", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await setKnobAtLayer({
      knobKey: "identitySpecId",
      layer: "DOMAIN",
      scopeIds: { domainId: "dom1" },
      value: "spec-tut-001",
    });
    const [, transformer] = updateDomainConfig.mock.calls[0];
    const result = transformer({});
    expect(result.onboardingIdentitySpecId).toBe("spec-tut-001");
  });
});

describe("setKnobAtLayer — CALLER dispatch", () => {
  it("routes BEH-* to writeCallerBehaviorTarget", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await setKnobAtLayer({
      knobKey: "BEH-WARMTH",
      layer: "CALLER",
      scopeIds: { callerId: "c1" },
      value: 0.8,
    });
    expect(writeCallerBehaviorTarget).toHaveBeenCalledWith(
      "c1",
      "BEH-WARMTH",
      0.8,
      expect.objectContaining({ source: "MANUAL" }),
    );
  });

  it("refuses non-BEH knob at CALLER scope", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await expect(
      setKnobAtLayer({
        knobKey: "welcomeMessage",
        layer: "CALLER",
        scopeIds: { callerId: "c1" },
        value: "hi",
      }),
    ).rejects.toThrow(/BEH-\*/);
  });
});

describe("setKnobAtLayer — deferred / forbidden layers throw", () => {
  it("SEGMENT throws Sprint-2 message", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await expect(
      setKnobAtLayer({
        knobKey: "BEH-WARMTH",
        layer: "SEGMENT",
        scopeIds: {},
        value: 0.5,
      }),
    ).rejects.toThrow(/Sprint 2/);
  });

  it("CALL throws Sprint-2 message", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await expect(
      setKnobAtLayer({
        knobKey: "BEH-WARMTH",
        layer: "CALL",
        scopeIds: {},
        value: 0.5,
      }),
    ).rejects.toThrow(/Sprint 2/);
  });

  it("SYSTEM throws ADMIN-only message", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await expect(
      setKnobAtLayer({
        knobKey: "BEH-WARMTH",
        layer: "SYSTEM",
        scopeIds: {},
        value: 0.5,
      }),
    ).rejects.toThrow(/ADMIN-only/);
  });
});

describe("setKnobAtLayer — cache invalidation", () => {
  it("calls invalidateKnob with the same knobKey after a successful write", async () => {
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await setKnobAtLayer({
      knobKey: "BEH-WARMTH",
      layer: "PLAYBOOK",
      scopeIds: { playbookId: "pb1" },
      value: 0.6,
    });
    expect(invalidateKnob).toHaveBeenCalledWith("BEH-WARMTH");
  });

  it("does NOT invalidate when the underlying write throws", async () => {
    writeBehaviorTarget.mockResolvedValueOnce({
      ok: false,
      reason: "parameter_not_adjustable",
    });
    const { setKnobAtLayer } = await import("@/lib/cascade/set-at-layer");
    await expect(
      setKnobAtLayer({
        knobKey: "BEH-XYZ",
        layer: "PLAYBOOK",
        scopeIds: { playbookId: "pb1" },
        value: 0.6,
      }),
    ).rejects.toThrow();
    expect(invalidateKnob).not.toHaveBeenCalled();
  });
});

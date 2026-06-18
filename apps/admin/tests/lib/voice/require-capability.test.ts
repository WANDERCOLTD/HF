/**
 * Tests for the requireCapability / hasCapability helpers (#1908).
 *
 * Validates that the VP-neutral orchestrator branch point throws with a
 * clear error when the active provider lacks the named capability,
 * and that the non-throwing variant returns the right boolean.
 */

import { describe, it, expect } from "vitest";

import {
  requireCapability,
  hasCapability,
  capabilitiesAllow,
} from "@/lib/voice/require-capability";
import type { VoiceProvider, VoiceProviderCapabilities } from "@/lib/voice/types";

function makeProvider(
  slug: string,
  overrides: Partial<VoiceProviderCapabilities> = {},
): VoiceProvider {
  const caps: VoiceProviderCapabilities = {
    endOfCallEvents: "single",
    hasKnowledgeCallback: true,
    toolCallsOverWebSocket: false,
    supportsRequestEndCall: true,
    supportsProactiveSpeech: true,
    orchestrationMode: "vendor-cloud",
    supportsCustomLLMProxy: true,
    supportsInBandSystemMessage: true,
    supportsHandoff: true,
    ...overrides,
  };
  // Type cast — we only need `slug` + `getCapabilities()` for these tests.
  return {
    slug,
    getCapabilities: () => caps,
  } as unknown as VoiceProvider;
}

describe("requireCapability (#1908)", () => {
  it("returns silently when the capability is supported", () => {
    const provider = makeProvider("vapi");
    expect(() =>
      requireCapability(provider, "supportsCustomLLMProxy", "test"),
    ).not.toThrow();
  });

  it("throws with provider slug + capability name + reason when not supported", () => {
    const provider = makeProvider("retell", {
      supportsCustomLLMProxy: false,
    });
    expect(() =>
      requireCapability(
        provider,
        "supportsCustomLLMProxy",
        "mid-call directive injection",
      ),
    ).toThrowError(/retell.*supportsCustomLLMProxy.*mid-call directive injection/);
  });

  it("throws on each of the new #1908 capability bits independently", () => {
    const noCaps = makeProvider("future-vp", {
      supportsCustomLLMProxy: false,
      supportsInBandSystemMessage: false,
      supportsHandoff: false,
    });
    expect(() =>
      requireCapability(noCaps, "supportsCustomLLMProxy", "x"),
    ).toThrow();
    expect(() =>
      requireCapability(noCaps, "supportsInBandSystemMessage", "x"),
    ).toThrow();
    expect(() => requireCapability(noCaps, "supportsHandoff", "x")).toThrow();
  });
});

describe("hasCapability (#1908)", () => {
  it("returns true when the capability is supported", () => {
    const provider = makeProvider("vapi");
    expect(hasCapability(provider, "supportsCustomLLMProxy")).toBe(true);
  });

  it("returns false when the capability is not supported", () => {
    const provider = makeProvider("retell", {
      supportsCustomLLMProxy: false,
    });
    expect(hasCapability(provider, "supportsCustomLLMProxy")).toBe(false);
  });

  it("does not throw on either branch", () => {
    const provider = makeProvider("test", { supportsHandoff: false });
    expect(() => hasCapability(provider, "supportsHandoff")).not.toThrow();
  });
});

describe("capabilitiesAllow (#1908)", () => {
  it("operates on an already-resolved capabilities bundle (no provider needed)", () => {
    const caps: VoiceProviderCapabilities = {
      endOfCallEvents: "single",
      hasKnowledgeCallback: true,
      toolCallsOverWebSocket: false,
      supportsRequestEndCall: true,
      supportsProactiveSpeech: true,
      orchestrationMode: "vendor-cloud",
      supportsCustomLLMProxy: true,
      supportsInBandSystemMessage: false,
      supportsHandoff: false,
    };
    expect(capabilitiesAllow(caps, "supportsCustomLLMProxy")).toBe(true);
    expect(capabilitiesAllow(caps, "supportsInBandSystemMessage")).toBe(false);
    expect(capabilitiesAllow(caps, "supportsHandoff")).toBe(false);
  });
});

/**
 * Tests for the interruptSensitivity → VAPI barge-in mapper
 * (#2053 / sub-epic D of #2049).
 *
 * Pins:
 *  1. Tier string mapping (low/medium/high) → numWords
 *  2. Numeric slider [0..1] interpolation → numWords
 *  3. Clamping for out-of-range numeric values
 *  4. Null / undefined / unrecognised → null (caller omits the knob)
 *  5. End-to-end via `VapiProvider.buildAssistantConfig`: the resolved
 *     `voiceConfig.interruptSensitivity` produces the expected
 *     `assistant.stopSpeakingPlan` block.
 */

import { describe, it, expect } from "vitest";

import { mapInterruptSensitivityToVapi } from "@/lib/voice/interrupt-sensitivity";
import { VapiProvider } from "@/lib/voice/providers/vapi";
import type { AssistantRequestContext } from "@/lib/voice/types";

describe("mapInterruptSensitivityToVapi — tier strings", () => {
  it("low → 3 words (least sensitive)", () => {
    expect(mapInterruptSensitivityToVapi("low")).toEqual({
      stopSpeakingPlan: { numWords: 3 },
    });
  });

  it("medium → 1 word (mid)", () => {
    expect(mapInterruptSensitivityToVapi("medium")).toEqual({
      stopSpeakingPlan: { numWords: 1 },
    });
  });

  it("high → 0 words (most sensitive — yields on any speech)", () => {
    expect(mapInterruptSensitivityToVapi("high")).toEqual({
      stopSpeakingPlan: { numWords: 0 },
    });
  });

  it("accepts case-insensitive tier strings", () => {
    expect(mapInterruptSensitivityToVapi("HIGH")).toEqual({
      stopSpeakingPlan: { numWords: 0 },
    });
    expect(mapInterruptSensitivityToVapi("Medium")).toEqual({
      stopSpeakingPlan: { numWords: 1 },
    });
  });
});

describe("mapInterruptSensitivityToVapi — numeric slider", () => {
  it("0.0 → 3 words (slider floor)", () => {
    expect(mapInterruptSensitivityToVapi(0)).toEqual({
      stopSpeakingPlan: { numWords: 3 },
    });
  });

  it("0.5 → 2 words (mid-band — rounded)", () => {
    // Linear: 3 - 3*0.5 = 1.5 → Math.round → 2
    expect(mapInterruptSensitivityToVapi(0.5)).toEqual({
      stopSpeakingPlan: { numWords: 2 },
    });
  });

  it("1.0 → 0 words (slider ceiling, most sensitive)", () => {
    expect(mapInterruptSensitivityToVapi(1)).toEqual({
      stopSpeakingPlan: { numWords: 0 },
    });
  });

  it("0.7 → 1 word (between medium and high)", () => {
    // Linear: 3 - 3*0.7 = 0.9 → Math.round → 1
    expect(mapInterruptSensitivityToVapi(0.7)).toEqual({
      stopSpeakingPlan: { numWords: 1 },
    });
  });

  it("clamps negative values to 0 → 3 words", () => {
    expect(mapInterruptSensitivityToVapi(-0.5)).toEqual({
      stopSpeakingPlan: { numWords: 3 },
    });
  });

  it("clamps >1 values to 1 → 0 words", () => {
    expect(mapInterruptSensitivityToVapi(2.5)).toEqual({
      stopSpeakingPlan: { numWords: 0 },
    });
  });
});

describe("mapInterruptSensitivityToVapi — null / unrecognised", () => {
  it("null → null (omit the knob, keep VAPI default)", () => {
    expect(mapInterruptSensitivityToVapi(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(mapInterruptSensitivityToVapi(undefined)).toBeNull();
  });

  it("unknown tier string → null", () => {
    expect(mapInterruptSensitivityToVapi("aggressive")).toBeNull();
  });

  it("non-finite number → null", () => {
    expect(mapInterruptSensitivityToVapi(Number.NaN)).toBeNull();
    expect(mapInterruptSensitivityToVapi(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("object / array → null", () => {
    expect(mapInterruptSensitivityToVapi({ tier: "high" })).toBeNull();
    expect(mapInterruptSensitivityToVapi([1])).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// Integration through VapiProvider.buildAssistantConfig
// ────────────────────────────────────────────────────────────

function baseCtx(
  overrides: Partial<AssistantRequestContext> = {},
): AssistantRequestContext {
  return {
    callerId: "caller-1",
    callerName: "Alice",
    customerPhone: "+441234567890",
    voicePrompt: "You are a friendly tutor.",
    firstLine: "Hi Alice!",
    toolDefinitions: [],
    knowledgePlanEnabled: false,
    serverUrlBase: "https://hf.example.com/api/voice/vapi",
    modelConfig: { provider: "openai", model: "gpt-4o" },
    unknownCallerPrompt: "Hello caller!",
    noActivePromptFallback: "No prompt fallback.",
    ...overrides,
  };
}

describe("VapiProvider.buildAssistantConfig — interruptSensitivity wiring", () => {
  it("omits stopSpeakingPlan when voiceConfig.interruptSensitivity is undefined", () => {
    const p = new VapiProvider({}, {});
    const out = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { voiceId: "asteria" } }),
    ) as { assistant: Record<string, unknown> };
    expect(out.assistant.stopSpeakingPlan).toBeUndefined();
  });

  it("low tier sets stopSpeakingPlan.numWords = 3", () => {
    const p = new VapiProvider({}, {});
    const out = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { interruptSensitivity: "low" } }),
    ) as { assistant: Record<string, unknown> };
    expect(out.assistant.stopSpeakingPlan).toEqual({ numWords: 3 });
  });

  it("high tier sets stopSpeakingPlan.numWords = 0", () => {
    const p = new VapiProvider({}, {});
    const out = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { interruptSensitivity: "high" } }),
    ) as { assistant: Record<string, unknown> };
    expect(out.assistant.stopSpeakingPlan).toEqual({ numWords: 0 });
  });

  it("numeric slider 0.5 sets stopSpeakingPlan.numWords = 2", () => {
    const p = new VapiProvider({}, {});
    const out = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { interruptSensitivity: 0.5 } }),
    ) as { assistant: Record<string, unknown> };
    expect(out.assistant.stopSpeakingPlan).toEqual({ numWords: 2 });
  });

  it("unrecognised value leaves stopSpeakingPlan unset", () => {
    const p = new VapiProvider({}, {});
    const out = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { interruptSensitivity: "aggressive" } }),
    ) as { assistant: Record<string, unknown> };
    expect(out.assistant.stopSpeakingPlan).toBeUndefined();
  });
});

/**
 * Tests for cost-safety knob injection in the VAPI assistant config
 * (PR voice-cost-knobs).
 *
 * Validates that VapiProvider.buildAssistantConfig wires the system-
 * settings knobs (silenceTimeoutSeconds, maxDurationSeconds,
 * voicemailDetectionEnabled, endCallPhrases) into the assistant payload
 * sent to VAPI — and that callers without a knobs bundle (back-compat)
 * get an assistant with VAPI's own defaults.
 */

import { describe, it, expect } from "vitest";

import { VapiProvider } from "@/lib/voice/providers/vapi";
import type { AssistantRequestContext } from "@/lib/voice/types";

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

describe("VapiProvider.buildAssistantConfig — cost safety knobs", () => {
  it("omits the knobs from the payload when none are supplied (back-compat)", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(baseCtx()) as {
      assistant: Record<string, unknown>;
    };
    expect(config.assistant.silenceTimeoutSeconds).toBeUndefined();
    expect(config.assistant.maxDurationSeconds).toBeUndefined();
    expect(config.assistant.voicemailDetectionEnabled).toBeUndefined();
    expect(config.assistant.endCallPhrases).toBeUndefined();
  });

  it("wires every knob into the assistant payload when supplied", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({
        costSafetyKnobs: {
          silenceTimeoutSeconds: 25,
          maxDurationSeconds: 480,
          voicemailDetectionEnabled: true,
          endCallPhrases: ["goodbye", "bye", "have a good one"],
        },
      }),
    ) as { assistant: Record<string, unknown> };

    expect(config.assistant.silenceTimeoutSeconds).toBe(25);
    expect(config.assistant.maxDurationSeconds).toBe(480);
    expect(config.assistant.voicemailDetectionEnabled).toBe(true);
    expect(config.assistant.endCallPhrases).toEqual([
      "goodbye",
      "bye",
      "have a good one",
    ]);
  });

  it("does not emit voicemailDetectionEnabled when explicitly false (keeps VAPI default)", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({
        costSafetyKnobs: {
          silenceTimeoutSeconds: 30,
          maxDurationSeconds: 600,
          voicemailDetectionEnabled: false,
          endCallPhrases: [],
        },
      }),
    ) as { assistant: Record<string, unknown> };
    // We only set the flag when true so VAPI's default (off) stays in
    // place — avoids accidentally enabling detection by serialising
    // false explicitly.
    expect(config.assistant.voicemailDetectionEnabled).toBeUndefined();
  });

  it("does not emit endCallPhrases when the list is empty", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({
        costSafetyKnobs: {
          silenceTimeoutSeconds: 30,
          maxDurationSeconds: 600,
          voicemailDetectionEnabled: true,
          endCallPhrases: [],
        },
      }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.endCallPhrases).toBeUndefined();
  });

  it("knobs do not overwrite the model / serverUrl / firstMessage fields", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({
        costSafetyKnobs: {
          silenceTimeoutSeconds: 30,
          maxDurationSeconds: 600,
          voicemailDetectionEnabled: true,
          endCallPhrases: ["goodbye"],
        },
      }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.model).toBeDefined();
    expect(config.assistant.serverUrl).toBe("https://hf.example.com/api/voice/vapi/webhook");
    expect(config.assistant.firstMessage).toBe("Hi Alice!");
  });
});

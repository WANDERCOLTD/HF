/**
 * Tests for VAPI adapter's customLlmProxyUrl construction (#TBD-pathseg).
 *
 * Pins the URL shape we send to VAPI in the assistant config:
 *   - empty/non-hex secret → bare ".../llm-proxy" (pass-through surface)
 *   - hex secret in [8..256] → ".../llm-proxy/auth/<HEX>" (path-segment)
 *
 * VAPI's custom-LLM client appends "/chat/completions" to whatever URL
 * we hand it. The route layer handles the resulting paths.
 */

import { describe, expect, it } from "vitest";
import { VapiProvider } from "@/lib/voice/providers/vapi";
import type { AssistantRequestContext } from "@/lib/voice/types";

const adapter = new VapiProvider({}, {});

function buildCtx(
  customLlmSecret: string | undefined,
): AssistantRequestContext {
  return {
    callerId: "caller-abc",
    callerName: "Test Caller",
    customerPhone: null,
    voicePrompt: "You are a tutor.",
    firstLine: "Hi.",
    toolDefinitions: [],
    knowledgePlanEnabled: false,
    serverUrlBase: "https://hf.example.com/api/voice/vapi",
    modelConfig: { provider: "custom-llm", model: "claude-haiku-4-5" },
    unknownCallerPrompt: "Hello.",
    noActivePromptFallback: "Hi.",
    costSafetyKnobs: {
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 600,
      voicemailDetectionEnabled: true,
      endCallPhrases: ["goodbye"],
    },
    customLlmSecret,
    voiceConfig: undefined,
  } as AssistantRequestContext;
}

function extractModelUrl(assistantConfig: Record<string, unknown>): string {
  const inner = (assistantConfig.assistant ?? assistantConfig) as Record<string, unknown>;
  const model = inner.model as Record<string, unknown>;
  return String(model.url ?? "");
}

describe("VapiProvider.buildAssistantConfig — customLlmProxyUrl shape", () => {
  it("empty secret → bare ./llm-proxy (header-auth pass-through surface)", () => {
    const cfg = adapter.buildAssistantConfig(buildCtx(undefined));
    expect(extractModelUrl(cfg)).toBe(
      "https://hf.example.com/api/voice/llm-proxy",
    );
  });

  it("hex secret (64 chars) → /llm-proxy/auth/<HEX>", () => {
    const hex64 = "f7143c63081d22eb14bde7e6ad4de5408fb8885714fd38ad88fa8d83782082ac";
    const cfg = adapter.buildAssistantConfig(buildCtx(hex64));
    expect(extractModelUrl(cfg)).toBe(
      `https://hf.example.com/api/voice/llm-proxy/auth/${hex64}`,
    );
  });

  it("hex secret (16 chars) → still path-segment", () => {
    const hex16 = "deadbeefcafebabe";
    const cfg = adapter.buildAssistantConfig(buildCtx(hex16));
    expect(extractModelUrl(cfg)).toBe(
      `https://hf.example.com/api/voice/llm-proxy/auth/${hex16}`,
    );
  });

  it("hex secret (7 chars) → too short, falls back to bare", () => {
    const tooShort = "abc1234";
    const cfg = adapter.buildAssistantConfig(buildCtx(tooShort));
    expect(extractModelUrl(cfg)).toBe(
      "https://hf.example.com/api/voice/llm-proxy",
    );
  });

  it("non-hex secret → falls back to bare (no risk of mangled URL)", () => {
    const nonHex = "this-is-not-hex!";
    const cfg = adapter.buildAssistantConfig(buildCtx(nonHex));
    expect(extractModelUrl(cfg)).toBe(
      "https://hf.example.com/api/voice/llm-proxy",
    );
  });

  it("secret with whitespace → falls back to bare", () => {
    const withSpace = "abc def 123 4567";
    const cfg = adapter.buildAssistantConfig(buildCtx(withSpace));
    expect(extractModelUrl(cfg)).toBe(
      "https://hf.example.com/api/voice/llm-proxy",
    );
  });
});

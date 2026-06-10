/**
 * Tests for `assistant.serverUrlSecret` in the VAPI adapter's
 * `buildAssistantConfig` output (#TBD-webhook-secret).
 *
 * Pre-fix HF shipped the assistant config without `serverUrlSecret`,
 * so VAPI sent webhooks WITHOUT any auth header. Operator's dashboard
 * Server URL Secret only applies to assistants created via the VAPI UI,
 * not to dynamic inline assistants like HF's per-call payload.
 *
 * Post-fix: HF sets `assistant.serverUrlSecret = ctx.customLlmSecret`
 * when the secret is set. VAPI then adds `x-vapi-secret: <value>` to
 * every webhook for the call. The verifier accepts that header (see
 * tests/lib/vapi-auth.test.ts).
 */

import { describe, expect, it } from "vitest";
import { VapiProvider } from "@/lib/voice/providers/vapi";
import type { AssistantRequestContext } from "@/lib/voice/types";

const adapter = new VapiProvider({}, {});

function buildCtx(secret: string | undefined): AssistantRequestContext {
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
    customLlmSecret: secret,
    voiceConfig: undefined,
  } as AssistantRequestContext;
}

function extractAssistant(
  cfg: Record<string, unknown>,
): Record<string, unknown> {
  return (cfg.assistant ?? cfg) as Record<string, unknown>;
}

describe("VapiProvider.buildAssistantConfig — serverUrlSecret (#TBD-webhook-secret)", () => {
  it("omits serverUrlSecret when no secret configured (pass-through dev)", () => {
    const cfg = adapter.buildAssistantConfig(buildCtx(undefined));
    const assistant = extractAssistant(cfg);
    expect(assistant.serverUrlSecret).toBeUndefined();
    expect(assistant.serverUrl).toMatch(/\/api\/voice\/vapi\/webhook$/);
  });

  it("omits serverUrlSecret when secret is empty string", () => {
    const cfg = adapter.buildAssistantConfig(buildCtx(""));
    const assistant = extractAssistant(cfg);
    expect(assistant.serverUrlSecret).toBeUndefined();
  });

  it("includes serverUrlSecret when secret is a non-empty string", () => {
    const hex = "f7143c63081d22eb14bde7e6ad4de5408fb8885714fd38ad88fa8d83782082ac";
    const cfg = adapter.buildAssistantConfig(buildCtx(hex));
    const assistant = extractAssistant(cfg);
    expect(assistant.serverUrlSecret).toBe(hex);
  });

  it("serverUrlSecret value matches customLlmSecret (single source of truth)", () => {
    const cfg = adapter.buildAssistantConfig(buildCtx("anyValue123"));
    const assistant = extractAssistant(cfg);
    expect(assistant.serverUrlSecret).toBe("anyValue123");
  });

  it("non-hex secret still set — operator may have chosen a non-hex shared secret", () => {
    // Distinct from the LLM proxy URL where hex-only is enforced — the
    // webhook serverUrlSecret is a plain shared secret of any format.
    const cfg = adapter.buildAssistantConfig(buildCtx("plain-text-secret"));
    const assistant = extractAssistant(cfg);
    expect(assistant.serverUrlSecret).toBe("plain-text-secret");
  });
});

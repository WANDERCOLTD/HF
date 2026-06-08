/**
 * Tests for the per-VP voice knobs + cascade wiring on the VAPI adapter
 * (#1269 / #1271 Slice B).
 *
 * Validates:
 *   1. `getConfigSchema()` declares the new non-sensitive per-VP fields
 *      (voiceId, voiceProvider, transcriber, backgroundSound,
 *      recordingEnabled) so the admin form on /x/settings/voice-providers
 *      picks them up automatically.
 *   2. `buildAssistantConfig` reads `ctx.voiceConfig` and weaves each
 *      field into the inline assistant payload VAPI receives.
 *   3. Missing fields don't crash — adapter degrades gracefully.
 *   4. recordingEnabled=true is the silent default; only `false` writes
 *      a key (VAPI's own default is `true`).
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

describe("VapiProvider.getConfigSchema — per-VP knobs (#1271 Slice B)", () => {
  const p = new VapiProvider({}, {});
  const schema = p.getConfigSchema();
  const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]));

  it("declares voiceId as non-sensitive (lands in VoiceProvider.config)", () => {
    expect(byKey.voiceId).toBeDefined();
    expect(byKey.voiceId.sensitive).not.toBe(true);
    expect(byKey.voiceId.type).toBe("string");
  });

  it("declares voiceProvider (TTS engine) as enum with deepgram default (#1334)", () => {
    expect(byKey.voiceProvider).toBeDefined();
    expect(byKey.voiceProvider.type).toBe("enum");
    expect(byKey.voiceProvider.default).toBe("deepgram");
    // ElevenLabs stays in the enum — it's still a valid premium choice,
    // just no longer the default per #1334 cost decision.
    expect(byKey.voiceProvider.enumValues).toContain("11labs");
    expect(byKey.voiceProvider.enumValues).toContain("deepgram");
  });

  it("declares transcriber (STT engine) as enum with deepgram default", () => {
    expect(byKey.transcriber).toBeDefined();
    expect(byKey.transcriber.type).toBe("enum");
    expect(byKey.transcriber.default).toBe("deepgram");
  });

  it("declares backgroundSound as enum with 'off' default", () => {
    expect(byKey.backgroundSound).toBeDefined();
    expect(byKey.backgroundSound.type).toBe("enum");
    expect(byKey.backgroundSound.default).toBe("off");
    expect(byKey.backgroundSound.enumValues).toContain("off");
  });

  it("declares recordingEnabled as boolean with true default", () => {
    expect(byKey.recordingEnabled).toBeDefined();
    expect(byKey.recordingEnabled.type).toBe("boolean");
    expect(byKey.recordingEnabled.default).toBe(true);
  });

  it("does NOT add `provider` or `model` to the schema (system-locked)", () => {
    expect(byKey.provider).toBeUndefined();
    expect(byKey.model).toBeUndefined();
  });
});

describe("VapiProvider.buildAssistantConfig — voiceConfig wire-up (#1271 Slice B)", () => {
  it("omits voice/transcriber/backgroundSound when no voiceConfig supplied", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(baseCtx()) as {
      assistant: Record<string, unknown>;
    };
    expect(config.assistant.voice).toBeUndefined();
    expect(config.assistant.transcriber).toBeUndefined();
    expect(config.assistant.backgroundSound).toBeUndefined();
  });

  it("writes `voice: { provider, voiceId }` when both fields cascade through", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({
        voiceConfig: { voiceId: "21m00Tcm4TlvDq8ikWAM", voiceProvider: "11labs" },
      }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.voice).toEqual({
      provider: "11labs",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
    });
  });

  it("defaults voiceProvider to '11labs' when only voiceId supplied", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { voiceId: "rachel" } }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.voice).toEqual({ provider: "11labs", voiceId: "rachel" });
  });

  it("omits voice block when voiceId is empty string (clears override semantics)", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { voiceId: "" } }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.voice).toBeUndefined();
  });

  it("writes `transcriber: { provider }` when transcriber cascades through", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { transcriber: "deepgram" } }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.transcriber).toEqual({ provider: "deepgram" });
  });

  it("writes backgroundSound when non-'off' value cascades through", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { backgroundSound: "office" } }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.backgroundSound).toBe("office");
  });

  it("omits backgroundSound key when value is 'off' (VAPI's silent default)", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { backgroundSound: "off" } }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.backgroundSound).toBeUndefined();
  });

  it("writes recordingEnabled: false explicitly when override set", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { recordingEnabled: false } }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.recordingEnabled).toBe(false);
  });

  it("omits recordingEnabled key when value is true (VAPI's default)", () => {
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({ voiceConfig: { recordingEnabled: true } }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.recordingEnabled).toBeUndefined();
  });

  it("ignores keys it doesn't recognise (forward-compat with future fields)", () => {
    const p = new VapiProvider({}, {});
    expect(() =>
      p.buildAssistantConfig(
        baseCtx({ voiceConfig: { someFutureKey: 123 } as Record<string, unknown> }),
      ),
    ).not.toThrow();
  });
});

describe("VapiProvider — Deepgram Aura Asteria default (#1334)", () => {
  it("seeded default config produces the Deepgram voice block", () => {
    // Locks the contract between `prisma/seed-voice-providers.ts` and the
    // adapter wire-up: the seed bootstraps a row with
    // `config: { voiceProvider: "deepgram", voiceId: "asteria" }`.
    // When that config flows through the cascade and arrives as
    // `ctx.voiceConfig`, the adapter must produce the matching voice block.
    // If either side drifts (seed change without test, schema change without
    // seed) this test catches it before deploy.
    const p = new VapiProvider({}, {});
    const config = p.buildAssistantConfig(
      baseCtx({
        voiceConfig: { voiceProvider: "deepgram", voiceId: "asteria" },
      }),
    ) as { assistant: Record<string, unknown> };
    expect(config.assistant.voice).toEqual({
      provider: "deepgram",
      voiceId: "asteria",
    });
  });

  it("schema default is `deepgram` so an empty config blob still picks Deepgram via cascade fallback", () => {
    // `resolveVoiceConfig` uses `schemaField.default` as the last-resort
    // fallback for cascadeable fields. Asserting the schema default here
    // means: an environment whose VoiceProvider row pre-dates the seed
    // update + migration script (config blob empty) still ends up on
    // Deepgram at runtime, without operator action. Defence-in-depth on
    // top of the seed + migrate script.
    const p = new VapiProvider({}, {});
    const voiceProviderField = p
      .getConfigSchema()
      .fields.find((f) => f.key === "voiceProvider");
    expect(voiceProviderField?.default).toBe("deepgram");
  });
});

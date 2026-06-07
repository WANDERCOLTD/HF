/**
 * Voice config cascade resolver tests — #1269 / #1270 Slice A.
 *
 * Locks in the precedence contract (course > domain > provider > system),
 * the locked-keys invariant (provider/model not overrideable), the
 * secret-field exclusion, and the per-VP schema-driven cascadeable set.
 */

import { describe, it, expect } from "vitest";
import {
  resolveVoiceConfig,
  cascadeableKeys,
  flatten,
  LOCKED_KEYS,
  SECRET_KEYS,
} from "@/lib/voice/config";
import type { ProviderConfigSchema } from "@/lib/voice/types";

const systemSettings = {
  defaultProviderSlug: "vapi",
  autoPipeline: true,
  silenceTimeoutSeconds: 30,
  maxDurationSeconds: 600,
  voicemailDetectionEnabled: true,
  endCallPhrases: ["goodbye", "bye"],
  maxCostPerCallUsd: null as number | null,
} as const;

const vapiSchemaWithVoiceId: ProviderConfigSchema = {
  fields: [
    { key: "apiKey", label: "API Key", type: "string", sensitive: true },
    { key: "voiceId", label: "Voice ID", type: "string", sensitive: false, default: "default-voice" },
    { key: "transcriber", label: "Transcriber", type: "enum", enumValues: ["deepgram", "whisper"], sensitive: false },
  ],
};

const enabledProvider = (overrides: Partial<{ config: Record<string, unknown>; model: string | null; schema: ProviderConfigSchema }> = {}) => ({
  slug: "vapi",
  config: overrides.config ?? {},
  schema: overrides.schema ?? vapiSchemaWithVoiceId,
  model: overrides.model,
});

describe("resolveVoiceConfig — basic cascade precedence", () => {
  it("falls through to system default when no layer overrides", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider(),
    });
    expect(r.fields.autoPipeline.value).toBe(true);
    expect(r.fields.autoPipeline.source).toBe("system");
    expect(r.fields.silenceTimeoutSeconds.value).toBe(30);
    expect(r.fields.silenceTimeoutSeconds.source).toBe("system");
  });

  it("provider config wins over system for cross-cutting fields", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider({ config: { silenceTimeoutSeconds: 45 } }),
    });
    expect(r.fields.silenceTimeoutSeconds.value).toBe(45);
    expect(r.fields.silenceTimeoutSeconds.source).toBe("provider");
  });

  it("domain wins over provider", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider({ config: { silenceTimeoutSeconds: 45 } }),
      domainConfig: { silenceTimeoutSeconds: 60 },
    });
    expect(r.fields.silenceTimeoutSeconds.value).toBe(60);
    expect(r.fields.silenceTimeoutSeconds.source).toBe("domain");
  });

  it("course wins over everything", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider({ config: { silenceTimeoutSeconds: 45 } }),
      domainConfig: { silenceTimeoutSeconds: 60 },
      courseConfig: { silenceTimeoutSeconds: 90 },
    });
    expect(r.fields.silenceTimeoutSeconds.value).toBe(90);
    expect(r.fields.silenceTimeoutSeconds.source).toBe("course");
  });
});

describe("resolveVoiceConfig — null clears the override and falls through", () => {
  it("course key set to null falls back to domain", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider(),
      domainConfig: { autoPipeline: false },
      courseConfig: { autoPipeline: null },
    });
    expect(r.fields.autoPipeline.value).toBe(false);
    expect(r.fields.autoPipeline.source).toBe("domain");
  });

  it("domain key set to null falls back to provider", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider({ config: { autoPipeline: false } }),
      domainConfig: { autoPipeline: null },
    });
    expect(r.fields.autoPipeline.value).toBe(false);
    expect(r.fields.autoPipeline.source).toBe("provider");
  });
});

describe("resolveVoiceConfig — per-VP schema fields", () => {
  it("non-sensitive schema field cascades from course", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider(),
      courseConfig: { voiceId: "custom-voice-1" },
    });
    expect(r.fields.voiceId.value).toBe("custom-voice-1");
    expect(r.fields.voiceId.source).toBe("course");
  });

  it("schema field falls back to schema default when no layer provides", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider(),
    });
    expect(r.fields.voiceId.value).toBe("default-voice");
    expect(r.fields.voiceId.source).toBe("provider");
  });

  it("sensitive schema fields are NOT cascadeable", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider({ config: { apiKey: "leaked-key" } }),
      courseConfig: { apiKey: "another-leak" },
    });
    expect(r.fields.apiKey).toBeUndefined();
  });
});

describe("resolveVoiceConfig — locked keys at system level", () => {
  it("provider always equals enabled VP slug — domain/course can't override", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider(),
      domainConfig: { provider: "retell" },
      courseConfig: { provider: "openai-realtime" },
    });
    expect(r.provider.value).toBe("vapi");
    expect(r.provider.source).toBe("system");
    expect(r.fields.provider).toBeUndefined();
  });

  it("model is sourced from VP.config.model, never from course/domain", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider({ model: "claude-opus-4-7" }),
      domainConfig: { model: "gpt-4o" },
      courseConfig: { model: "claude-haiku-4-5" },
    });
    expect(r.model.value).toBe("claude-opus-4-7");
    expect(r.model.source).toBe("provider");
    expect(r.fields.model).toBeUndefined();
  });

  it("model is null when VP doesn't pin one — adapter falls back to its own default", () => {
    const r = resolveVoiceConfig({ systemSettings, enabledProvider: enabledProvider() });
    expect(r.model.value).toBeNull();
    expect(r.model.source).toBe("system");
  });

  it("LOCKED_KEYS contract", () => {
    expect(LOCKED_KEYS).toEqual(["provider", "model"]);
  });
});

describe("cascadeableKeys", () => {
  it("includes per-VP non-sensitive + cross-cutting; excludes sensitive + locked + secret", () => {
    const keys = cascadeableKeys(vapiSchemaWithVoiceId);
    expect(keys).toContain("voiceId");
    expect(keys).toContain("transcriber");
    expect(keys).toContain("autoPipeline");
    expect(keys).toContain("silenceTimeoutSeconds");
    expect(keys).not.toContain("apiKey"); // sensitive
    expect(keys).not.toContain("provider"); // locked
    expect(keys).not.toContain("model"); // locked
  });

  it("SECRET_KEYS contract enforced", () => {
    const malicious: ProviderConfigSchema = {
      fields: [
        { key: "modelSecret", label: "x", type: "string" },
        { key: "secret", label: "x", type: "string" },
        { key: "apiKey", label: "x", type: "string" },
        { key: "webhookSecret", label: "x", type: "string" },
      ],
    };
    const keys = cascadeableKeys(malicious);
    for (const k of SECRET_KEYS) {
      expect(keys).not.toContain(k);
    }
  });
});

describe("flatten", () => {
  it("returns plain object with provider/model/fields merged", () => {
    const r = resolveVoiceConfig({
      systemSettings,
      enabledProvider: enabledProvider({ model: "claude-opus-4-7", config: { voiceId: "v1" } }),
      courseConfig: { autoPipeline: false },
    });
    const flat = flatten(r);
    expect(flat.provider).toBe("vapi");
    expect(flat.model).toBe("claude-opus-4-7");
    expect(flat.voiceId).toBe("v1");
    expect(flat.autoPipeline).toBe(false);
  });
});

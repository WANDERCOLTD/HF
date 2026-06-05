/**
 * Tests for VoiceProvider capability + config schema declarations
 * (AnyVoice #1044).
 *
 * Validates that every registered adapter declares a non-empty config
 * schema and a complete capabilities block, and that VapiProvider's
 * declared values match the wire-format implementation today.
 */

import { describe, it, expect } from "vitest";

import { VOICE_ADAPTERS } from "@/lib/voice/adapter-registry";

describe("VoiceProvider — config schema + capabilities (#1044)", () => {
  it("every registered adapter implements getConfigSchema()", () => {
    for (const [key, Ctor] of Object.entries(VOICE_ADAPTERS)) {
      const probe = new Ctor({}, {});
      const schema = probe.getConfigSchema();
      expect(schema, `adapter ${key} returned no schema`).toBeDefined();
      expect(Array.isArray(schema.fields)).toBe(true);
      for (const f of schema.fields) {
        expect(typeof f.key).toBe("string");
        expect(f.key.length).toBeGreaterThan(0);
        expect(["string", "number", "boolean", "enum"]).toContain(f.type);
        if (f.type === "enum") {
          expect(Array.isArray(f.enumValues)).toBe(true);
          expect((f.enumValues as string[]).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every registered adapter implements getCapabilities()", () => {
    for (const [key, Ctor] of Object.entries(VOICE_ADAPTERS)) {
      const probe = new Ctor({}, {});
      const caps = probe.getCapabilities();
      expect(caps, `adapter ${key} returned no capabilities`).toBeDefined();
      expect(["single", "split"]).toContain(caps.endOfCallEvents);
      expect(typeof caps.hasKnowledgeCallback).toBe("boolean");
      expect(typeof caps.toolCallsOverWebSocket).toBe("boolean");
      expect(typeof caps.supportsRequestEndCall).toBe("boolean");
    }
  });

  it("VapiProvider declares single-event end-of-call + HTTP transports", () => {
    const Ctor = VOICE_ADAPTERS.vapi;
    expect(Ctor).toBeDefined();
    const probe = new Ctor({}, {});
    const caps = probe.getCapabilities();
    expect(caps.endOfCallEvents).toBe("single");
    expect(caps.toolCallsOverWebSocket).toBe(false);
    expect(caps.hasKnowledgeCallback).toBe(true);
    expect(caps.supportsRequestEndCall).toBe(true);
  });

  it("VapiProvider config schema declares apiKey + webhookSecret as sensitive", () => {
    const Ctor = VOICE_ADAPTERS.vapi;
    const probe = new Ctor({}, {});
    const schema = probe.getConfigSchema();
    const apiKey = schema.fields.find((f) => f.key === "apiKey");
    const secret = schema.fields.find((f) => f.key === "webhookSecret");
    expect(apiKey?.sensitive).toBe(true);
    expect(secret?.sensitive).toBe(true);
  });
});

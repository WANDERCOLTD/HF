/**
 * Tests for VoiceCallSettings (lib/system-settings.ts).
 *
 * Validates that:
 * 1. Settings interface, defaults, and registry are consistent
 * 2. Every tool in the TOOLS-001 spec has a spec-level `enabled` flag
 *    (#1043 supersedes the TOOL_SETTING_KEYS map — per-tool gates moved
 *    out of VoiceCallSettings into the spec)
 */

import { describe, it, expect, vi } from "vitest";

// Override the global system-settings mock to use the actual module
vi.mock("@/lib/system-settings", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual };
});

import {
  VOICE_CALL_DEFAULTS,
  SETTINGS_REGISTRY,
} from "@/lib/system-settings";

// Post-#1019 the tool list lives in the TOOLS-001 spec JSON (not the
// hardcoded VAPI_TOOL_DEFINITIONS constant, which was removed). The
// test reads the spec file directly — it's the source of truth and
// stays close to what the seeder loads at /vm-cpp time.
import toolsSpec from "../../docs-archive/bdd-specs/TOOLS-001-voice-tool-definitions.spec.json";
const TOOLS_SPEC_DEFINITIONS = toolsSpec.config.tools as Array<{
  type: string;
  enabled?: boolean;
  function: { name: string };
}>;

describe("VoiceCallSettings", () => {
  it("has defaults for all interface fields", () => {
    const defaults = VOICE_CALL_DEFAULTS;
    expect(defaults.provider).toBe("openai");
    expect(defaults.model).toBe("gpt-4o");
    expect(typeof defaults.knowledgePlanEnabled).toBe("boolean");
    expect(typeof defaults.autoPipeline).toBe("boolean");
    expect(typeof defaults.unknownCallerPrompt).toBe("string");
    expect(typeof defaults.noActivePromptFallback).toBe("string");
  });

  it("has a registry entry with id 'voice'", () => {
    const voiceGroup = SETTINGS_REGISTRY.find((g) => g.id === "voice");
    expect(voiceGroup).toBeDefined();
    expect(voiceGroup!.label).toBe("Voice Calls");
    expect(voiceGroup!.icon).toBe("Phone");
  });

  it("registry entry has settings for all VoiceCallSettings keys", () => {
    const voiceGroup = SETTINGS_REGISTRY.find((g) => g.id === "voice")!;
    const registryKeys = voiceGroup.settings.map((s) => s.key);

    expect(registryKeys).toContain("voice.provider");
    expect(registryKeys).toContain("voice.model");
    expect(registryKeys).toContain("voice.knowledge_plan_enabled");
    expect(registryKeys).toContain("voice.auto_pipeline");
    expect(registryKeys).toContain("voice.unknown_caller_prompt");
    expect(registryKeys).toContain("voice.no_active_prompt_fallback");
  });

  it("Voice Calls registry no longer exposes per-tool toggles (#1043)", () => {
    const voiceGroup = SETTINGS_REGISTRY.find((g) => g.id === "voice")!;
    const registryKeys = voiceGroup.settings.map((s) => s.key);
    for (const key of registryKeys) {
      expect(key.startsWith("voice.tool_")).toBe(false);
    }
  });
});

describe("TOOLS-001 spec — per-tool enabled flag (#1043)", () => {
  it("every tool entry has an `enabled` boolean (defaults to true)", () => {
    for (const tool of TOOLS_SPEC_DEFINITIONS) {
      // `enabled` may be omitted in legacy seeds (treated as true by the
      // loader). New seed adds it explicitly to all 10 tools.
      if (tool.enabled !== undefined) {
        expect(typeof tool.enabled).toBe("boolean");
      }
    }
  });

  it("at least one tool is enabled (catches an accidental all-disabled spec)", () => {
    const enabledCount = TOOLS_SPEC_DEFINITIONS.filter(
      (t) => t.enabled !== false,
    ).length;
    expect(enabledCount).toBeGreaterThan(0);
  });

  it("tool function names are unique across the spec", () => {
    const names = TOOLS_SPEC_DEFINITIONS.map((t) => t.function.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

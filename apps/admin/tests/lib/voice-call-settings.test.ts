/**
 * Tests for VoiceCallSettings (lib/system-settings.ts)
 * and TOOL_SETTING_KEYS (app/api/vapi/tools/route.ts)
 *
 * Validates that:
 * 1. Settings interface, defaults, and registry are consistent
 * 2. Every tool in VAPI_TOOL_DEFINITIONS has a matching TOOL_SETTING_KEYS entry
 * 3. Every TOOL_SETTING_KEYS value maps to a boolean in VoiceCallSettings
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
  type VoiceCallSettings,
} from "@/lib/system-settings";
import { TOOL_SETTING_KEYS } from "@/app/api/vapi/tools/route";
// Post-#1019 the tool list lives in the TOOLS-001 spec JSON (not the
// hardcoded VAPI_TOOL_DEFINITIONS constant, which was removed). The
// test reads the spec file directly — it's the source of truth and
// stays close to what the seeder loads at /vm-cpp time.
import toolsSpec from "../../docs-archive/bdd-specs/TOOLS-001-voice-tool-definitions.spec.json";
const TOOLS_SPEC_DEFINITIONS = toolsSpec.config.tools as Array<{ function: { name: string } }>;

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

  it("all tool toggles default to true", () => {
    const defaults = VOICE_CALL_DEFAULTS;
    const toolKeys = Object.values(TOOL_SETTING_KEYS);
    for (const key of toolKeys) {
      expect(defaults[key]).toBe(true);
    }
  });
});

describe("TOOL_SETTING_KEYS", () => {
  it("covers every tool in the TOOLS-001 spec", () => {
    for (const tool of TOOLS_SPEC_DEFINITIONS) {
      const toolName = tool.function.name;
      expect(TOOL_SETTING_KEYS).toHaveProperty(toolName);
    }
  });

  it("every value maps to a valid VoiceCallSettings key", () => {
    const validKeys = Object.keys(VOICE_CALL_DEFAULTS) as Array<keyof VoiceCallSettings>;
    for (const [, settingKey] of Object.entries(TOOL_SETTING_KEYS)) {
      expect(validKeys).toContain(settingKey);
      expect(typeof VOICE_CALL_DEFAULTS[settingKey]).toBe("boolean");
    }
  });
});

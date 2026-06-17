/**
 * JourneySettingContract — voice.prosodyMode (#1871).
 *
 * Pins the new Track-B Inspector chip contract:
 *   - id = "voiceProsodyMode" registered in JOURNEY_SETTINGS
 *   - bucket I_scoring + group G4 (matches sibling G4_TIER_PRESET_ID)
 *   - storagePath = "config.voice.prosodyMode" (single string form)
 *   - control = "select"
 *   - options derived from PROSODY_MODE_VALUES + PROSODY_MODE_LABELS
 *     (single source of truth — no hand-typed enum array)
 *   - composeImpact sections = moduleMastery + loMastery (mirrors
 *     tierPresetId — both knobs change AGGREGATE's mastery writes)
 *   - cascadeSources = [] (course-only override; Domain-level prosody
 *     swap is intentionally not surfaced)
 *   - previewLocators cite the course-header ProsodyModePill
 */

import { describe, expect, it } from "vitest";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import {
  PROSODY_MODE_VALUES,
  PROSODY_MODE_LABELS,
} from "@/lib/pipeline/prosody-types";

describe("voice.prosodyMode JourneySettingContract — #1871", () => {
  const contract = JOURNEY_SETTINGS.find((c) => c.id === "voiceProsodyMode");

  it("is registered in JOURNEY_SETTINGS", () => {
    expect(contract).toBeDefined();
  });

  it("bucketed under I_scoring + group G4 (matches sibling tierPresetId)", () => {
    expect(contract!.menuGroupKey).toBe("I_scoring");
    expect(contract!.group).toBe("G4");
  });

  it("storagePath is config.voice.prosodyMode (string form, no array hop)", () => {
    expect(contract!.storagePath).toBe("config.voice.prosodyMode");
  });

  it("uses select control", () => {
    expect(contract!.control).toBe("select");
  });

  it("options derived from PROSODY_MODE_VALUES (single source of truth)", () => {
    const optionValues = contract!.options!.map((o) => o.value);
    expect(optionValues).toEqual([...PROSODY_MODE_VALUES]);
  });

  it("option labels derived from PROSODY_MODE_LABELS (no drift)", () => {
    for (const opt of contract!.options!) {
      expect(opt.label).toBe(
        PROSODY_MODE_LABELS[opt.value as keyof typeof PROSODY_MODE_LABELS],
      );
    }
  });

  it("composeImpact sections match tierPresetId precedent (moduleMastery + loMastery)", () => {
    expect(contract!.composeImpact.sections).toEqual(["moduleMastery", "loMastery"]);
    expect(contract!.composeImpact.kinds).toEqual(["scoring-weight"]);
    expect(contract!.composeImpact.requiresReprompt).toBe(false);
  });

  it("cascadeSources empty (course-only override; Domain-level swap is intentionally hidden)", () => {
    expect(contract!.cascadeSources).toEqual([]);
  });

  it("previewLocators reference the course-header ProsodyModePill section", () => {
    expect(contract!.previewLocators.length).toBeGreaterThan(0);
    expect(contract!.previewLocators[0].section).toBe("moduleMastery");
  });

  it("uses the same value set as the admin-tool prosodyMode enum", async () => {
    const adminTools = await import("@/lib/chat/admin-tools");
    const tool = adminTools.ADMIN_TOOLS.find((t) => t.name === "update_voice_config");
    expect(tool).toBeDefined();
    const props = (tool!.input_schema as unknown as {
      properties: {
        settings: {
          properties: { prosodyMode: { enum: readonly string[] } };
        };
      };
    }).properties.settings.properties.prosodyMode;
    expect(props.enum).toEqual([...PROSODY_MODE_VALUES]);
  });
});

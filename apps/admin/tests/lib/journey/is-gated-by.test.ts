/**
 * isGatedBy — Phase 0 of the Journey-Design tab refactor.
 *
 * Pins the gating-resolution discipline with fixtures for each case
 * the helper must handle:
 *
 *   - Explicit `gatedBy` declared, parent value is in inactiveValues → gated
 *   - Explicit `gatedBy` declared, parent value NOT in inactiveValues → not gated
 *   - Derived from autoEnableLinks (peer enforces noop on this setting)
 *   - Setting with no gatedBy + no peer autoEnableLinks → null
 *   - Setting with gatedBy pointing at a non-existent parent id → null
 */

import { describe, it, expect } from "vitest";

import type {
  JourneySettingContract,
  StoragePath,
} from "@/lib/journey/setting-contracts";
import type { PlaybookConfig } from "@/lib/types/json-fields";
import { isGatedBy } from "@/lib/journey/is-gated-by";

/** Minimal test-contract factory. Most JourneySettingContract fields
 *  are irrelevant to this helper; we fill in just enough to satisfy
 *  the type. */
function makeContract(overrides: {
  id: string;
  educatorLabel: string;
  storagePath: StoragePath;
  autoEnableLinks?: JourneySettingContract["autoEnableLinks"];
  gatedBy?: JourneySettingContract["gatedBy"];
}): JourneySettingContract {
  return {
    id: overrides.id,
    group: "G4",
    educatorLabel: overrides.educatorLabel,
    storagePath: overrides.storagePath,
    control: "toggle",
    cascadeSources: [],
    composeImpact: { sections: [], kinds: [], requiresReprompt: false },
    previewLocators: [],
    autoEnableLinks: overrides.autoEnableLinks,
    gatedBy: overrides.gatedBy,
  };
}

describe("isGatedBy", () => {
  it("progressNarrativeCadence is gated when progressNarrativeEnabled = false", () => {
    const enabled = makeContract({
      id: "progressNarrativeEnabled",
      educatorLabel: "Mid-call mastery acknowledgement",
      storagePath: "config.progressNarrative.enabled",
    });
    const cadence = makeContract({
      id: "progressNarrativeCadence",
      educatorLabel: "Mid-call cadence",
      storagePath: "config.progressNarrative.cadence",
      gatedBy: { parentId: "progressNarrativeEnabled", inactiveValues: [false] },
    });
    const config: PlaybookConfig = {
      progressNarrative: { enabled: false, cadence: "every_call" },
    } as unknown as PlaybookConfig;

    const result = isGatedBy(cadence, config, [enabled, cadence]);
    expect(result).toEqual({
      parentId: "progressNarrativeEnabled",
      parentLabel: "Mid-call mastery acknowledgement",
    });
  });

  it("progressNarrativeCadence is NOT gated when progressNarrativeEnabled = true", () => {
    const enabled = makeContract({
      id: "progressNarrativeEnabled",
      educatorLabel: "Mid-call mastery acknowledgement",
      storagePath: "config.progressNarrative.enabled",
    });
    const cadence = makeContract({
      id: "progressNarrativeCadence",
      educatorLabel: "Mid-call cadence",
      storagePath: "config.progressNarrative.cadence",
      gatedBy: { parentId: "progressNarrativeEnabled", inactiveValues: [false] },
    });
    const config: PlaybookConfig = {
      progressNarrative: { enabled: true, cadence: "every_call" },
    } as unknown as PlaybookConfig;

    expect(isGatedBy(cadence, config, [enabled, cadence])).toBeNull();
  });

  it("npsThreshold is NOT gated when npsTrigger = 'score_drop'", () => {
    const trigger = makeContract({
      id: "npsTrigger",
      educatorLabel: "NPS trigger",
      storagePath: "config.nps.trigger",
    });
    const threshold = makeContract({
      id: "npsThreshold",
      educatorLabel: "NPS threshold",
      storagePath: "config.nps.threshold",
      gatedBy: { parentId: "npsTrigger", inactiveValues: ["always"] },
    });
    const config: PlaybookConfig = {
      nps: { trigger: "score_drop", threshold: 4 },
    } as unknown as PlaybookConfig;

    expect(isGatedBy(threshold, config, [trigger, threshold])).toBeNull();
  });

  it("npsThreshold IS gated when npsTrigger = 'always' (threshold has no meaning)", () => {
    const trigger = makeContract({
      id: "npsTrigger",
      educatorLabel: "NPS trigger",
      storagePath: "config.nps.trigger",
    });
    const threshold = makeContract({
      id: "npsThreshold",
      educatorLabel: "NPS threshold",
      storagePath: "config.nps.threshold",
      gatedBy: { parentId: "npsTrigger", inactiveValues: ["always"] },
    });
    const config: PlaybookConfig = {
      nps: { trigger: "always", threshold: 4 },
    } as unknown as PlaybookConfig;

    expect(isGatedBy(threshold, config, [trigger, threshold])).toEqual({
      parentId: "npsTrigger",
      parentLabel: "NPS trigger",
    });
  });

  it("a setting with no gatedBy AND no peer autoEnableLinks returns null", () => {
    const standalone = makeContract({
      id: "standaloneToggle",
      educatorLabel: "Standalone toggle",
      storagePath: "config.standaloneToggle",
    });
    const config: PlaybookConfig = {} as PlaybookConfig;

    expect(isGatedBy(standalone, config, [standalone])).toBeNull();
  });

  it("gatedBy pointing at a non-existent parent id returns null", () => {
    const orphan = makeContract({
      id: "orphan",
      educatorLabel: "Orphan",
      storagePath: "config.orphan",
      gatedBy: { parentId: "nonExistentParent", inactiveValues: [false] },
    });
    const config: PlaybookConfig = {} as PlaybookConfig;

    expect(isGatedBy(orphan, config, [orphan])).toBeNull();
  });

  it("derives gating from a peer's autoEnableLinks when enforce is a noop value (false)", () => {
    // Parent has an autoEnableLink that forces target to `false` (the
    // toggle's off state) when parent value === "off-equivalent".
    const parent = makeContract({
      id: "parent",
      educatorLabel: "Parent toggle",
      storagePath: "config.parent",
      autoEnableLinks: [
        {
          targetId: "child",
          whenValue: false,
          enforce: false,
          decoupleAllowed: false,
          reason: "When parent is off, child has no meaning.",
        },
      ],
    });
    const child = makeContract({
      id: "child",
      educatorLabel: "Child toggle",
      storagePath: "config.child",
    });
    const config: PlaybookConfig = {
      parent: false,
      child: true,
    } as unknown as PlaybookConfig;

    expect(isGatedBy(child, config, [parent, child])).toEqual({
      parentId: "parent",
      parentLabel: "Parent toggle",
    });
  });

  it("does NOT derive gating from autoEnableLinks when enforce is a non-noop value (true)", () => {
    // Parent forces child to TRUE — that's auto-enable, not gating.
    const parent = makeContract({
      id: "parent",
      educatorLabel: "Parent",
      storagePath: "config.parent",
      autoEnableLinks: [
        {
          targetId: "child",
          whenValue: "enabling",
          enforce: true,
          decoupleAllowed: true,
          reason: "Parent enables child when in 'enabling' mode.",
        },
      ],
    });
    const child = makeContract({
      id: "child",
      educatorLabel: "Child",
      storagePath: "config.child",
    });
    const config: PlaybookConfig = {
      parent: "enabling",
      child: true,
    } as unknown as PlaybookConfig;

    expect(isGatedBy(child, config, [parent, child])).toBeNull();
  });
});

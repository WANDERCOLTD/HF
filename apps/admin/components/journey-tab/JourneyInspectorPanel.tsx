"use client";

/**
 * JourneyInspectorPanel — Phase 4 of epic #1675.
 *
 * Right-hand pane of the Journey tri-pane. When a setting is selected
 * in the LH menu, this panel mounts the contract's `<JourneyField>`
 * primitive. Live value comes from the `playbookConfig` carried on the
 * `JourneySettingMutatorProvider` context (Phase 3 plumbing).
 *
 * Save is owned by the JourneyField primitive — it calls
 * `ctx.saveSetting(settingId, value)` which fires the journey-setting
 * PATCH route.
 */

import { JourneyField } from "@/components/journey-controls";
import { useJourneySetting } from "@/components/shared/preview-renderers/_journey-setting-context";
import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS_BY_ID } from "@/lib/settings/voice-setting-contracts";

import { resolveValueAtPath } from "./resolve-value-at-path";

interface JourneyInspectorPanelProps {
  selectedSettingId: string | null;
}

export function JourneyInspectorPanel({
  selectedSettingId,
}: JourneyInspectorPanelProps) {
  const ctx = useJourneySetting();

  if (!selectedSettingId) {
    return (
      <div
        className="hf-journey-inspector-empty"
        data-testid="hf-journey-inspector-empty"
      >
        Select a setting from the left menu to edit.
      </div>
    );
  }

  const contract =
    JOURNEY_SETTINGS_BY_ID[selectedSettingId] ??
    VOICE_SETTINGS_BY_ID[selectedSettingId];
  if (!contract) {
    return (
      <div className="hf-journey-inspector-empty">
        Unknown setting: <code>{selectedSettingId}</code>
      </div>
    );
  }

  const value = resolveValueAtPath(
    ctx.playbookConfig ?? null,
    contract.storagePath,
  );

  return (
    <div data-testid={`hf-journey-inspector-${selectedSettingId}`}>
      <JourneyField
        contract={contract}
        value={value}
        onSave={(next) => ctx.saveSetting(selectedSettingId, next)}
      />
    </div>
  );
}

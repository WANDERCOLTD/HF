/**
 * Voice-config cascade resolver (Epic #1442 Layer 2).
 *
 * Thin adapter over the existing `explainVoiceCascade` in
 * `lib/cascade/voice-explain.ts` (shipped with #1348). We do NOT
 * re-implement the layer reads — two read paths reconstructing the same
 * chain would drift on the next voice schema change. This file maps the
 * voice-cascade's 4-tier chain (`system | provider | domain | course`)
 * into the 6-layer `LayerHit<T>` shape used by `<LayerBadge>` and
 * `<CascadeInspectorTray>`.
 *
 * Mapping:
 *   - `system`   → `Layer.SYSTEM`   (scopeLabel: "System default")
 *   - `provider` → `Layer.SYSTEM`   (scopeLabel: "Voice provider config")
 *   - `domain`   → `Layer.DOMAIN`
 *   - `course`   → `Layer.PLAYBOOK`
 *
 * Two `SYSTEM` rows is intentional — the provider config is a global
 * singleton (VoiceProvider row) and the cascade-honesty taxonomy doesn't
 * have a "PROVIDER" tier. The `scopeLabel` carries the distinction for
 * the UI. (If a future epic needs to split these, we add `PROVIDER` to
 * the `Layer` union and adjust here — but Sprint 1 does not.)
 *
 * `setAt` / `setBy`: returned `null`. `VoiceProvider.config`,
 * `Playbook.config.voice`, and `Domain.config.voice` are all JSON blobs
 * with no per-key authorship metadata. See TODO(cascade-provenance) in
 * `welcome-message.ts` for the schema gap.
 */

// TODO(cascade-provenance): see welcome-message.ts — same blob authorship gap.

import { explainVoiceCascade } from "../voice-explain";
import type { Effective, Layer, LayerHit } from "../layer-types";
import type { ScopeChain } from "../effective-value";

/**
 * Map the voice-cascade's 4-tier source label onto the 6-layer cascade
 * vocabulary. Exported for tests.
 */
export function mapVoiceLayer(
  voiceLayer: "system" | "provider" | "domain" | "course",
): Layer {
  switch (voiceLayer) {
    case "system":
    case "provider":
      return "SYSTEM";
    case "domain":
      return "DOMAIN";
    case "course":
      return "PLAYBOOK";
  }
}

function voiceLayerLabel(
  voiceLayer: "system" | "provider" | "domain" | "course",
): string {
  switch (voiceLayer) {
    case "system":
      return "System default";
    case "provider":
      return "Voice provider config";
    case "domain":
      return "Domain";
    case "course":
      return "Playbook";
  }
}

export async function resolveVoiceConfigKnob(
  scope: ScopeChain,
  knobKey: string,
): Promise<Effective<unknown>> {
  if (!scope.callerId) {
    throw new Error(
      `resolveVoiceConfigKnob requires \`callerId\` in scopeChain — the voice cascade is caller-rooted (resolves the active CallerPlaybook's voice config). Got: ${JSON.stringify(
        scope,
      )}`,
    );
  }

  const explanation = await explainVoiceCascade(scope.callerId);
  const field = explanation.fields.find((f) => f.key === knobKey);

  if (!field) {
    throw new Error(
      `Unknown voice-config knob key: "${knobKey}". Known keys: ${explanation.fields
        .map((f) => f.key)
        .join(", ")}`,
    );
  }

  const layers: LayerHit<unknown>[] = [];
  for (const entry of field.chain) {
    if (!entry.present) continue;
    layers.push({
      layer: mapVoiceLayer(entry.layer),
      scopeId: null, // voice-explain does not expose per-layer ids
      scopeLabel: voiceLayerLabel(entry.layer),
      value: entry.value,
      setAt: null, // TODO(cascade-provenance)
      setBy: null,
    });
  }

  const sourceLayer = mapVoiceLayer(field.winningSource);

  return {
    value: field.resolvedValue,
    source: sourceLayer,
    layers,
    isInherited: sourceLayer !== "PLAYBOOK",
    recommendedLayerForEdit: "PLAYBOOK",
  };
}

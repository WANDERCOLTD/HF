/**
 * AI-measurement cascade resolver — story #2206 S2 / epic #2185.
 *
 * Resolves the per-course IELTS LLM-judged scoring kill-switch:
 *
 *   `Playbook.config.aiMeasurement.disableLlmIeltsScoring`
 *     ← `Domain.config.aiMeasurement.disableLlmIeltsScoring`
 *
 * Born of the 2026-06-21 "ALL settings → UI" framing (handoff
 * `handoff_lattice_all_settings_to_ui_2026_06_21.md` row S2): the toggle
 * shipped in PR #2158 against `Playbook.config` only, with the
 * `JourneySettingContract.cascadeSources = []` row commenting that
 * Domain-level override would silently flip scoring for every course.
 * The operator's S2 framing reverses that — every cascadable knob renders
 * via `<CascadeValue>` + `<LayerBadge>` per `.claude/rules/cascade-reuse.md`,
 * and the cascade chip itself surfaces the provenance so silent fan-out
 * is impossible. The Domain layer now LIGHTS UP only when an institution
 * operator deliberately writes the override at that scope.
 *
 * Storage shape — NESTED under `aiMeasurement.<knob>` rather than the
 * flat `config.<knob>` shape the mastery-policy resolver uses. The
 * sibling `welcome-message.ts` and `voice-config.ts` resolvers also
 * walk specific-named paths; this resolver follows the same pattern.
 *
 * `setAt` / `setBy` — null for both layers (see TODO comment in
 * `mastery-policy.ts`).
 */

import { prisma } from "@/lib/prisma";

import type { Effective, LayerHit } from "../layer-types";
import type { ScopeChain } from "../effective-value";

const SUPPORTED_KEYS = ["aiMeasurement.disableLlmIeltsScoring"] as const;
type AiMeasurementKey = (typeof SUPPORTED_KEYS)[number];

function isAiMeasurementKey(k: string): k is AiMeasurementKey {
  return (SUPPORTED_KEYS as readonly string[]).includes(k);
}

interface AiMeasurementShape {
  disableLlmIeltsScoring?: boolean | null;
}

function readNested(
  cfg: Record<string, unknown>,
  knobKey: AiMeasurementKey,
): unknown {
  const ai = cfg.aiMeasurement;
  if (!ai || typeof ai !== "object") return undefined;
  const aiShape = ai as AiMeasurementShape;
  // Today only one supported knob; extend the switch when siblings arrive.
  if (knobKey === "aiMeasurement.disableLlmIeltsScoring") {
    return aiShape.disableLlmIeltsScoring;
  }
  return undefined;
}

/**
 * Resolver entry called from `FAMILIES` in `effective-value.ts`. Reads
 * Playbook.config + Domain.config and returns the cascade envelope in
 * SYSTEM→CALL order (Domain before Playbook).
 *
 * Throws when:
 *   - `scope.playbookId` missing
 *   - the playbook row isn't found
 *   - the knob key isn't a supported aiMeasurement.* key (defence-in-depth)
 */
export async function resolveAiMeasurementKnob(
  scope: ScopeChain,
  knobKey: string,
): Promise<Effective<unknown>> {
  if (!isAiMeasurementKey(knobKey)) {
    throw new Error(
      `resolveAiMeasurementKnob: unsupported knob "${knobKey}". ` +
        `Supported: ${SUPPORTED_KEYS.join(", ")}.`,
    );
  }
  if (!scope.playbookId) {
    throw new Error(
      `resolveAiMeasurementKnob requires \`playbookId\` in scopeChain (got: ${JSON.stringify(
        scope,
      )})`,
    );
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: scope.playbookId },
    select: {
      id: true,
      name: true,
      config: true,
      domainId: true,
    },
  });
  if (!playbook) {
    throw new Error(`Playbook not found: ${scope.playbookId}`);
  }

  const domain = await prisma.domain.findUnique({
    where: { id: playbook.domainId },
    select: { id: true, name: true, config: true },
  });

  const pbConfig = (playbook.config ?? {}) as Record<string, unknown>;
  const domainConfig = (domain?.config ?? {}) as Record<string, unknown>;

  // SYSTEM→CALL order: DOMAIN before PLAYBOOK.
  const layers: LayerHit<unknown>[] = [];

  const domainValue = readNested(domainConfig, knobKey);
  if (domainValue !== undefined && domainValue !== null) {
    layers.push({
      layer: "DOMAIN",
      scopeId: domain!.id,
      scopeLabel: domain!.name,
      value: domainValue,
      setAt: null,
      setBy: null,
    });
  }

  const playbookValue = readNested(pbConfig, knobKey);
  if (playbookValue !== undefined && playbookValue !== null) {
    layers.push({
      layer: "PLAYBOOK",
      scopeId: playbook.id,
      scopeLabel: playbook.name,
      value: playbookValue,
      setAt: null,
      setBy: null,
    });
  }

  // Deepest (innermost) layer wins.
  const winner = layers.length > 0 ? layers[layers.length - 1] : null;

  if (!winner) {
    return {
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    };
  }

  return {
    value: winner.value,
    source: winner.layer,
    layers,
    isInherited: winner.layer !== "PLAYBOOK",
    recommendedLayerForEdit: "PLAYBOOK",
  };
}

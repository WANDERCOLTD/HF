/**
 * Teaching-style cascade resolver (#2228 A1b / epic #2225).
 *
 * `teachingStyle` is a CASCADE-Domain+Course knob but the two layers use
 * ASYMMETRIC blob keys:
 *
 *   - Domain side: `Domain.config.teachingStyleDefault`
 *   - Playbook side: `Playbook.config.teachingStyle`
 *
 * The mastery-policy resolver (`mastery-policy.ts`) requires symmetric
 * keys (`Domain.config[knobKey]` === `Playbook.config[knobKey]`), so we
 * land a slim sibling resolver here rather than bend SUPPORTED_KEYS to
 * accept an asymmetric case. Pattern mirrors `welcome-message.ts` —
 * same Domain-blob-vs-Playbook-blob asymmetric shape.
 *
 * `setAt` / `setBy`: returned `null` for both layers — `Playbook.config`
 * and `Domain.config` are JSON blobs with no per-key authorship
 * metadata. See `welcome-message.ts` TODO(cascade-provenance) for the
 * follow-on story that would add `configUpdatedBy` / `configUpdatedAt`.
 */

// TODO(cascade-provenance): There is no per-key authorship metadata for
// `Playbook.config.teachingStyle` or `Domain.config.teachingStyleDefault`.
// Adding `configUpdatedBy` / `configUpdatedAt` columns to Playbook + Domain
// would let us surface real "Set by Paul on 2026-05-22" provenance. Same
// follow-on as `welcome-message.ts`.

import { prisma } from "@/lib/prisma";

import type { Effective, LayerHit } from "../layer-types";
import type { ScopeChain } from "../effective-value";

export async function resolveTeachingStyle(
  scope: ScopeChain,
): Promise<Effective<unknown>> {
  if (!scope.playbookId) {
    throw new Error(
      `resolveTeachingStyle requires \`playbookId\` in scopeChain (got: ${JSON.stringify(
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

  // Build `layers` in SYSTEM→CALL order — DOMAIN before PLAYBOOK — so
  // the inspector tray can iterate top-to-bottom without re-sorting.
  const layers: LayerHit<unknown>[] = [];

  const domainValue = domainConfig["teachingStyleDefault"];
  if (domainValue !== undefined && domainValue !== null) {
    layers.push({
      layer: "DOMAIN",
      scopeId: domain!.id,
      scopeLabel: domain!.name,
      value: domainValue,
      setAt: null, // TODO(cascade-provenance)
      setBy: null,
    });
  }

  const playbookValue = pbConfig["teachingStyle"];
  if (playbookValue !== undefined && playbookValue !== null) {
    layers.push({
      layer: "PLAYBOOK",
      scopeId: playbook.id,
      scopeLabel: playbook.name,
      value: playbookValue,
      setAt: null, // TODO(cascade-provenance)
      setBy: null,
    });
  }

  // Deepest (innermost) layer wins — the last entry in SYSTEM→CALL order.
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

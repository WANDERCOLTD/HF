/**
 * Welcome-message cascade resolver (Epic #1442 Layer 2).
 *
 * Reads the same two layers `resolveWelcomeMessage` in
 * `lib/session-flow/resolver.ts` reads (Playbook config.welcomeMessage,
 * then Domain.onboardingWelcome) but returns BOTH layer hits when present
 * — not just the winner — so the inspector can render the full chain.
 *
 * `resolveWelcomeMessage` in resolver.ts is module-private (not exported),
 * so this file walks the two underlying rows directly. Behaviour matches
 * the resolver exactly: pb wins over domain, generic null when neither.
 *
 * `setAt` / `setBy`: returned `null` for both layers.
 *   - `Playbook.config` is a JSON blob with no per-key authorship metadata.
 *   - `Domain.onboardingWelcome` is a column but the surrounding Domain
 *     row's `updatedAt` is too coarse — it advances on any Domain edit.
 *   See TODO(cascade-provenance) below.
 */

// TODO(cascade-provenance): There is no per-key authorship metadata for
// `Playbook.config.welcomeMessage` or `Domain.onboardingWelcome`. Adding
// `configUpdatedBy` / `configUpdatedAt` columns to Playbook + Domain
// would let us surface real "Set by Paul on 2026-05-22" provenance. Track
// as a separate story before the inspector tray ships; until then the
// tray renders "Set by (unknown)" for these knobs.

import { prisma } from "@/lib/prisma";

import type { Effective, LayerHit } from "../layer-types";
import type { ScopeChain } from "../effective-value";

export async function resolveWelcomeMessage(
  scope: ScopeChain,
): Promise<Effective<string | null>> {
  if (!scope.playbookId) {
    throw new Error(
      `resolveWelcomeMessage requires \`playbookId\` in scopeChain (got: ${JSON.stringify(
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
    select: { id: true, name: true, onboardingWelcome: true },
  });

  const layers: LayerHit<string | null>[] = [];

  const pbConfig = (playbook.config ?? {}) as { welcomeMessage?: string | null };
  const pbMsg = pbConfig.welcomeMessage ?? null;
  if (pbMsg) {
    layers.push({
      layer: "PLAYBOOK",
      scopeId: playbook.id,
      scopeLabel: playbook.name,
      value: pbMsg,
      setAt: null, // TODO(cascade-provenance)
      setBy: null,
    });
  }

  if (domain?.onboardingWelcome) {
    layers.push({
      layer: "DOMAIN",
      scopeId: domain.id,
      scopeLabel: domain.name,
      value: domain.onboardingWelcome,
      setAt: null, // TODO(cascade-provenance)
      setBy: null,
    });
  }

  const winner = layers[0] ?? null;

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

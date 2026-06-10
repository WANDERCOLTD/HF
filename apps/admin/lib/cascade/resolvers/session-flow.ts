/**
 * Session-flow cascade resolver (Epic #1442 Layer 2).
 *
 * Wraps `resolveSessionFlow` (`lib/session-flow/resolver.ts`) and maps
 * its per-section `source` string onto the 6-layer `Layer` taxonomy.
 *
 * Handles four knob keys: `onboarding | intake | stops | offboarding`.
 * `welcomeMessage` has its own resolver (sibling file) because its
 * source-string vocabulary is independent (`playbook | domain | generic`)
 * and the inspector tray wants the welcome-message-specific multi-layer
 * chain that this resolver doesn't compute.
 *
 * Sprint 1 returns a single `LayerHit` for the winning layer only —
 * the underlying `resolveSessionFlow` does not expose the per-section
 * values from non-winning layers. Sprint 2 would expand this to walk
 * each raw layer independently for the full chain if needed; for now
 * the badge + winner-layer hit are sufficient for the #1418 fix and
 * the inspector tray gracefully degrades on the missing layers.
 *
 * `setAt` / `setBy`: `null` for every layer. `resolveSessionFlow` does
 * not return timestamps and `Playbook.updatedAt` is too coarse — it
 * advances on every Playbook edit. See TODO(cascade-provenance).
 */

// TODO(cascade-provenance): see welcome-message.ts — no per-key authorship
// for session-flow knobs. Multi-layer chain expansion deferred to Sprint 2.

import { prisma } from "@/lib/prisma";
import {
  resolveSessionFlow,
  type ResolveSessionFlowInput,
} from "@/lib/session-flow/resolver";
import type { PlaybookConfig, SessionFlowResolved } from "@/lib/types/json-fields";

import type { Effective, Layer, LayerHit } from "../layer-types";
import type { ScopeChain } from "../effective-value";

type SessionFlowKnob = "onboarding" | "intake" | "stops" | "offboarding";

type AnySource =
  | SessionFlowResolved["source"]["intake"]
  | SessionFlowResolved["source"]["onboarding"]
  | SessionFlowResolved["source"]["stops"]
  | SessionFlowResolved["source"]["offboarding"];

/**
 * Source-string → `Layer` table. Explicit; no fallthrough. Exported for
 * test coverage of every distinct source string `resolveSessionFlow` can
 * emit (7 strings as of 2026-06-10).
 */
export function mapSessionFlowSource(source: AnySource): Layer {
  switch (source) {
    case "domain":
      return "DOMAIN";
    case "new-shape":
    case "playbook-legacy":
    case "legacy-welcome":
    case "synthesized-from-legacy":
      return "PLAYBOOK";
    case "init001":
    case "defaults":
      return "SYSTEM";
  }
}

function isKnown(knobKey: string): knobKey is SessionFlowKnob {
  return (
    knobKey === "onboarding" ||
    knobKey === "intake" ||
    knobKey === "stops" ||
    knobKey === "offboarding"
  );
}

export async function resolveSessionFlowKnob(
  scope: ScopeChain,
  knobKey: string,
): Promise<Effective<unknown>> {
  if (!isKnown(knobKey)) {
    throw new Error(
      `resolveSessionFlowKnob does not handle "${knobKey}". Use a different family resolver.`,
    );
  }
  if (!scope.playbookId) {
    throw new Error(
      `resolveSessionFlowKnob requires \`playbookId\` in scopeChain (got: ${JSON.stringify(
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
    select: {
      id: true,
      name: true,
      onboardingWelcome: true,
      onboardingFlowPhases: true,
    },
  });

  const input: ResolveSessionFlowInput = {
    playbook: {
      name: playbook.name,
      config: (playbook.config ?? {}) as PlaybookConfig,
    },
    domain: domain
      ? ({
          name: domain.name,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onboardingFlowPhases: domain.onboardingFlowPhases as any,
          onboardingWelcome: domain.onboardingWelcome,
        } as ResolveSessionFlowInput["domain"])
      : null,
    onboardingSpec: null,
  };

  const flow = resolveSessionFlow(input);

  const value = flow[knobKey];
  const sourceStr = flow.source[knobKey];
  const winnerLayer = mapSessionFlowSource(sourceStr);

  const winnerLabel =
    winnerLayer === "DOMAIN"
      ? (domain?.name ?? "Domain")
      : winnerLayer === "PLAYBOOK"
        ? playbook.name
        : "System default";

  const winnerScopeId =
    winnerLayer === "DOMAIN"
      ? (domain?.id ?? null)
      : winnerLayer === "PLAYBOOK"
        ? playbook.id
        : null;

  const layers: LayerHit<unknown>[] = [
    {
      layer: winnerLayer,
      scopeId: winnerScopeId,
      scopeLabel: winnerLabel,
      value,
      setAt: null, // TODO(cascade-provenance)
      setBy: null,
    },
  ];

  return {
    value,
    source: winnerLayer,
    layers,
    isInherited: winnerLayer !== "PLAYBOOK",
    recommendedLayerForEdit: "PLAYBOOK",
  };
}

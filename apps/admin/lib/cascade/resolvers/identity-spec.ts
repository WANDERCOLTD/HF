/**
 * Identity-spec cascade resolver (Epic #1442 Layer 2).
 *
 * Does NOT call `transforms/identity.ts::resolveSpecs` — that function
 * walks `PlaybookItem` rows + system specs and returns WINNER ONLY; it
 * has no concept of `LayerHit[]`. This resolver reconstructs the chain
 * from raw DB rows so the inspector tray can render every applicable
 * layer (Playbook / Domain / System default) with its own value.
 *
 * Sprint 1 scope: returns `LayerHit` entries for **PLAYBOOK / DOMAIN /
 * SYSTEM**. The PLAYBOOK hit's value is currently `null` (no
 * Playbook-level identity-spec column today — overrides live in
 * `PlaybookItem` rows with `IDENTITY` SpecRole, and walking those is
 * deferred until the first UI consumer needs it). The hit is still
 * returned so the inspector tray can render "PLAYBOOK — not set" rather
 * than implying the cascade doesn't reach Playbook at all.
 *
 * `setAt`: returned from `AnalysisSpec.updatedAt` when the resolved spec
 * id maps to a real row. `null` for the PLAYBOOK hit (no row to read)
 * and for the SYSTEM hit when the default archetype slug doesn't resolve
 * to a row.
 *
 * `setBy`: `null` everywhere — no spec-ownership audit column exists.
 */

// TODO(cascade-provenance): no per-spec authorship metadata. The
// `AnalysisSpec` table has a generic `updatedAt`; surfacing `setBy`
// would require a new column. Tracked as a follow-up.
//
// TODO(playbook-identity-cascade): the PLAYBOOK layer should walk
// `PlaybookItem` rows for an `IDENTITY` SpecRole row before returning
// `null`. Deferred to follow-up; current behaviour matches the story
// AC ("Playbook with no identity override has PLAYBOOK hit with
// value: null"). Tracked under Epic #1442 Sprint 2 candidates.

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

import type { Effective, LayerHit } from "../layer-types";
import type { ScopeChain } from "../effective-value";

export async function resolveIdentitySpec(
  scope: ScopeChain,
): Promise<Effective<string | null>> {
  if (!scope.playbookId) {
    throw new Error(
      `resolveIdentitySpec requires \`playbookId\` in scopeChain (got: ${JSON.stringify(
        scope,
      )})`,
    );
  }

  const playbook = await prisma.playbook.findUnique({
    where: { id: scope.playbookId },
    select: { id: true, name: true, domainId: true },
  });
  if (!playbook) {
    throw new Error(`Playbook not found: ${scope.playbookId}`);
  }

  const domain = await prisma.domain.findUnique({
    where: { id: playbook.domainId },
    select: {
      id: true,
      name: true,
      onboardingIdentitySpecId: true,
    },
  });

  // SYSTEM default — config-driven (env-overridable). Resolve the slug
  // to an actual spec id when one exists; otherwise the SYSTEM hit
  // carries the slug as its value (better than null — the tray can
  // show what the slug WOULD have resolved to).
  const defaultSlug = config.specs.defaultArchetype;
  const defaultSpec = defaultSlug
    ? await prisma.analysisSpec.findFirst({
        where: { slug: defaultSlug },
        select: { id: true, updatedAt: true },
      })
    : null;

  const domainSpec =
    domain?.onboardingIdentitySpecId
      ? await prisma.analysisSpec.findUnique({
          where: { id: domain.onboardingIdentitySpecId },
          select: { id: true, updatedAt: true },
        })
      : null;

  const layers: LayerHit<string | null>[] = [
    {
      layer: "PLAYBOOK",
      scopeId: playbook.id,
      scopeLabel: playbook.name,
      value: null, // TODO(playbook-identity-cascade): walk PlaybookItem IDENTITY rows
      setAt: null,
      setBy: null, // TODO(cascade-provenance)
    },
    {
      layer: "DOMAIN",
      scopeId: domain?.id ?? null,
      scopeLabel: domain?.name ?? "Domain",
      value: domain?.onboardingIdentitySpecId ?? null,
      setAt: domainSpec?.updatedAt ?? null,
      setBy: null, // TODO(cascade-provenance)
    },
    {
      layer: "SYSTEM",
      scopeId: null,
      scopeLabel: "System default",
      value: defaultSpec?.id ?? defaultSlug ?? null,
      setAt: defaultSpec?.updatedAt ?? null,
      setBy: null, // TODO(cascade-provenance)
    },
  ];

  // Cascade pick — deepest non-null wins.
  const winner =
    layers.find((h) => h.layer === "PLAYBOOK" && h.value !== null) ??
    layers.find((h) => h.layer === "DOMAIN" && h.value !== null) ??
    layers.find((h) => h.layer === "SYSTEM" && h.value !== null);

  if (!winner) {
    return {
      value: null,
      source: "SYSTEM",
      layers,
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

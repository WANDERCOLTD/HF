/**
 * Behavior-target cascade resolver (Epic #1442 Layer 2).
 *
 * Wraps `getEffectiveBehaviorTargetsForCaller` (the canonical cascade
 * authority for `BEH-*` parameters — see `lib/tolerance/…`) to get the
 * winner + per-layer values, then does targeted `updatedAt` reads for the
 * layers that contributed a value so the inspector tray can render real
 * `setAt` timestamps.
 *
 * Does NOT import `mergeTargets` from `lib/prompt/composition/transforms/
 * quickstart.ts` — `mergeTargets` runs at COMPOSE stage and combines
 * pre-resolved targets for the LLM context. It is NOT a cascade resolver,
 * it is a composition step. Cascade resolution happens upstream at
 * `getEffectiveBehaviorTargetsForCaller`.
 *
 * `setBy`: `BehaviorTarget` has no `setBy` userId column today — resolver
 * returns `null` for every layer. Tray renders "Set by (unknown)".
 * See TODO(cascade-provenance) below.
 *
 * SEGMENT layer: returns no hit in Sprint 1 (Sprint 2 wires it).
 */

// TODO(cascade-provenance): add `setBy String?` userId column to
// `BehaviorTarget` to surface real authorship in the tray. Tracked as a
// follow-up under Epic #1442. Migration plus tray copy update would land
// in the same story.

import { prisma } from "@/lib/prisma";
import { getEffectiveBehaviorTargetsForCaller } from "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller";
import { resolveCallerIdentityIds } from "@/lib/agent-tuner/write-target";

import type { Effective, LayerHit } from "../layer-types";
import type { ScopeChain } from "../effective-value";

export async function resolveBehaviorTarget(
  scope: ScopeChain,
  knobKey: string,
): Promise<Effective<number | null>> {
  if (!scope.playbookId) {
    throw new Error(
      `resolveBehaviorTarget requires \`playbookId\` in scopeChain (got: ${JSON.stringify(
        scope,
      )})`,
    );
  }

  // 1. Run the canonical cascade for the (playbook, caller) pair. This
  //    returns one entry per parameter — find the one matching knobKey.
  const all = await getEffectiveBehaviorTargetsForCaller(
    scope.playbookId,
    scope.callerId ?? "",
  );
  const row = all.find((e) => e.parameterId === knobKey);

  // 2. If the cascade has no entry for this parameter at all, return an
  //    "all-default" envelope. The compose path also defaults to 0.5; we
  //    surface that explicitly so the badge renders `[—]` with the right
  //    fallback value visible.
  if (!row) {
    return {
      value: null,
      source: "SYSTEM",
      layers: [],
      isInherited: false,
      recommendedLayerForEdit: "PLAYBOOK",
    };
  }

  // 3. Get the row-level `updatedAt` for each layer that has a value, so
  //    the inspector can show "Set on 2026-05-22". Three small queries —
  //    cached for 30s by `resolveEffective`.
  const layers: LayerHit<number | null>[] = [];

  if (row.systemValue !== null) {
    const sys = await prisma.behaviorTarget.findFirst({
      where: { scope: "SYSTEM", parameterId: knobKey, effectiveUntil: null },
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    layers.push({
      layer: "SYSTEM",
      scopeId: null,
      scopeLabel: "System default",
      value: row.systemValue,
      setAt: sys?.updatedAt ?? null,
      setBy: null, // TODO(cascade-provenance)
    });
  }

  if (row.playbookValue !== null) {
    const [pb, pbRow] = await Promise.all([
      prisma.playbook.findUnique({
        where: { id: scope.playbookId },
        select: { name: true },
      }),
      prisma.behaviorTarget.findFirst({
        where: {
          scope: "PLAYBOOK",
          playbookId: scope.playbookId,
          parameterId: knobKey,
          effectiveUntil: null,
        },
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    layers.push({
      layer: "PLAYBOOK",
      scopeId: scope.playbookId,
      scopeLabel: pb?.name ?? "this Playbook",
      value: row.playbookValue,
      setAt: pbRow?.updatedAt ?? null,
      setBy: null, // TODO(cascade-provenance)
    });
  }

  if (row.callerValue !== null && scope.callerId) {
    // Fan out to the caller's identity rows so we pick the same
    // `updatedAt` as the row that contributed `callerValue` (the cascade
    // takes MAX across identities — same tie-break).
    const ids = await resolveCallerIdentityIds(scope.callerId);
    const identityIds = ids.ok ? ids.identityIds : [];
    const callerRow = identityIds.length
      ? await prisma.behaviorTarget.findFirst({
          where: {
            scope: "CALLER",
            callerIdentityId: { in: identityIds },
            parameterId: knobKey,
            effectiveUntil: null,
            targetValue: row.callerValue,
          },
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
        })
      : null;

    const callerLabel = await prisma.caller.findUnique({
      where: { id: scope.callerId },
      select: { name: true },
    });

    layers.push({
      layer: "CALLER",
      scopeId: scope.callerId,
      scopeLabel: callerLabel?.name ?? "this caller",
      value: row.callerValue,
      setAt: callerRow?.updatedAt ?? null,
      setBy: null, // TODO(cascade-provenance)
    });
  }

  const sourceLayer =
    row.sourceScope === "CALLER"
      ? "CALLER"
      : row.sourceScope === "PLAYBOOK"
        ? "PLAYBOOK"
        : "SYSTEM";

  return {
    value: row.effectiveValue,
    source: sourceLayer,
    layers,
    isInherited: sourceLayer !== "PLAYBOOK",
    recommendedLayerForEdit: "PLAYBOOK",
  };
}

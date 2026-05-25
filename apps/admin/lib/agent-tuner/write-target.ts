/**
 * Behavior Target Writer
 *
 * Shared write path for BehaviorTarget updates at PLAYBOOK or CALLER scope.
 * Used by:
 * - PATCH /api/playbooks/:playbookId/targets (panel, PLAYBOOK scope)
 * - PATCH /api/callers/:callerId/behavior-targets (sidebar, CALLER scope)
 * - update_behavior_target chat tool (Cmd+K AI assistant — either scope)
 *
 * Centralises the AI-to-DB guard (parameterId whitelist + numeric clamp)
 * so both call sites cannot drift. See .claude/rules/ai-to-db-guard.md.
 */

import { prisma } from "@/lib/prisma";
import type { BehaviorTargetSource } from "@prisma/client";
import {
  bumpCallerComposeTimestamp,
  bumpPlaybookComposeTimestamp,
} from "@/lib/compose/bump-timestamp";

export type WriteTargetResult =
  | { ok: true; action: "created" | "updated" | "removed" | "noop"; parameterId: string; value: number | null }
  | { ok: false; parameterId: string; reason: "playbook_not_found" | "caller_not_found" | "no_identity" | "parameter_not_adjustable" };

/**
 * Cache the whitelist within a single batch — callers that update multiple
 * targets in one request avoid N round-trips.
 */
async function loadAdjustableSet(): Promise<Set<string>> {
  const rows = await prisma.parameter.findMany({
    where: { parameterType: "BEHAVIOR", isAdjustable: true },
    select: { parameterId: true },
  });
  return new Set(rows.map((r) => r.parameterId));
}

/**
 * Apply a single PLAYBOOK-scope BehaviorTarget write.
 *
 * - `targetValue: null` removes the override (delete row), returning "removed" / "noop".
 * - Otherwise clamps the value into [0, 1] and creates or updates the row.
 * - Validates `parameterId` against the live adjustable BEHAVIOR catalogue.
 *
 * Does NOT itself check the playbook's published status — that policy was
 * lifted by #602 (PLAYBOOK-scope targets are an operational overlay).
 */
export async function writeBehaviorTarget(
  playbookId: string,
  parameterId: string,
  targetValue: number | null,
  options?: { validParamIds?: Set<string>; source?: BehaviorTargetSource },
): Promise<WriteTargetResult> {
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true },
  });
  if (!playbook) {
    return { ok: false, parameterId, reason: "playbook_not_found" };
  }

  const valid = options?.validParamIds ?? (await loadAdjustableSet());
  if (!valid.has(parameterId)) {
    return { ok: false, parameterId, reason: "parameter_not_adjustable" };
  }

  const source: BehaviorTargetSource = options?.source ?? "MANUAL";

  const existing = await prisma.behaviorTarget.findFirst({
    where: {
      parameterId,
      playbookId,
      scope: "PLAYBOOK",
      effectiveUntil: null,
    },
    select: { id: true },
  });

  if (targetValue === null) {
    if (!existing) {
      return { ok: true, action: "noop", parameterId, value: null };
    }
    await prisma.behaviorTarget.delete({ where: { id: existing.id } });
    // #830 — out-of-band PLAYBOOK-scope target removal: mark every
    // caller in this playbook stale on next call.
    await bumpPlaybookComposeTimestamp(playbookId);
    return { ok: true, action: "removed", parameterId, value: null };
  }

  const clamped = Math.max(0, Math.min(1, targetValue));

  if (existing) {
    await prisma.behaviorTarget.update({
      where: { id: existing.id },
      data: {
        targetValue: clamped,
        source,
        updatedAt: new Date(),
      },
    });
    await bumpPlaybookComposeTimestamp(playbookId);
    return { ok: true, action: "updated", parameterId, value: clamped };
  }

  await prisma.behaviorTarget.create({
    data: {
      parameterId,
      playbookId,
      scope: "PLAYBOOK",
      targetValue: clamped,
      confidence: 1.0,
      source,
    },
  });
  await bumpPlaybookComposeTimestamp(playbookId);
  return { ok: true, action: "created", parameterId, value: clamped };
}

/** Batch helper — loads the whitelist once and writes each target. */
export async function writeBehaviorTargets(
  playbookId: string,
  targets: Array<{ parameterId: string; targetValue: number | null }>,
  options?: { source?: BehaviorTargetSource },
): Promise<WriteTargetResult[]> {
  const validParamIds = await loadAdjustableSet();
  const results: WriteTargetResult[] = [];
  for (const t of targets) {
    if (!t.parameterId) continue;
    results.push(
      await writeBehaviorTarget(playbookId, t.parameterId, t.targetValue, {
        validParamIds,
        source: options?.source,
      }),
    );
  }
  return results;
}

/**
 * Resolve every CallerIdentity attached to a caller. Returns the identity IDs
 * the CALLER-scoped BehaviorTarget rows attach to.
 *
 * Shared between `writeCallerBehaviorTarget` and the HTTP route at
 * `/api/callers/[callerId]/behavior-targets` so they cannot drift.
 */
export async function resolveCallerIdentityIds(callerId: string): Promise<
  { ok: true; identityIds: string[] } | { ok: false; reason: "caller_not_found" | "no_identity" }
> {
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { callerIdentities: { select: { id: true } } },
  });
  if (!caller) return { ok: false, reason: "caller_not_found" };
  const identityIds = caller.callerIdentities.map((i) => i.id);
  if (identityIds.length === 0) return { ok: false, reason: "no_identity" };
  return { ok: true, identityIds };
}

/**
 * Apply a single CALLER-scope BehaviorTarget write for every identity
 * attached to a caller. Mirrors `writeBehaviorTarget` but targets the
 * per-learner override layer (resolution chain: CallerTarget > CALLER >
 * PLAYBOOK > DOMAIN > SYSTEM).
 *
 * - `targetValue: null` removes the override across all identities.
 * - Otherwise clamps to [0, 1] and upserts a row per identity.
 * - Validates parameterId against the live adjustable BEHAVIOR catalogue.
 */
export async function writeCallerBehaviorTarget(
  callerId: string,
  parameterId: string,
  targetValue: number | null,
  options?: { validParamIds?: Set<string>; source?: BehaviorTargetSource },
): Promise<WriteTargetResult> {
  const valid = options?.validParamIds ?? (await loadAdjustableSet());
  if (!valid.has(parameterId)) {
    return { ok: false, parameterId, reason: "parameter_not_adjustable" };
  }

  const ids = await resolveCallerIdentityIds(callerId);
  if (!ids.ok) {
    return { ok: false, parameterId, reason: ids.reason };
  }

  const source: BehaviorTargetSource = options?.source ?? "MANUAL";

  if (targetValue === null) {
    const del = await prisma.behaviorTarget.deleteMany({
      where: {
        parameterId,
        scope: "CALLER",
        callerIdentityId: { in: ids.identityIds },
        effectiveUntil: null,
      },
    });
    if (del.count > 0) {
      // #830 — out-of-band per-caller target removal: stamp this caller
      // so the staleness check picks it up on next call. Noop deletions
      // don't change anything and don't need a bump.
      await bumpCallerComposeTimestamp(callerId);
    }
    return {
      ok: true,
      action: del.count > 0 ? "removed" : "noop",
      parameterId,
      value: null,
    };
  }

  const clamped = Math.max(0, Math.min(1, targetValue));
  let anyCreated = false;

  await prisma.$transaction(async (tx) => {
    for (const identityId of ids.identityIds) {
      const existing = await tx.behaviorTarget.findFirst({
        where: {
          parameterId,
          scope: "CALLER",
          callerIdentityId: identityId,
          effectiveUntil: null,
        },
        select: { id: true },
      });
      if (existing) {
        await tx.behaviorTarget.update({
          where: { id: existing.id },
          data: { targetValue: clamped, source, updatedAt: new Date() },
        });
      } else {
        await tx.behaviorTarget.create({
          data: {
            parameterId,
            callerIdentityId: identityId,
            scope: "CALLER",
            targetValue: clamped,
            confidence: 1.0,
            source,
          },
        });
        anyCreated = true;
      }
    }
  });

  // #830 — successful upsert across the caller's identities: stamp the
  // caller so the staleness check picks this up on next call.
  await bumpCallerComposeTimestamp(callerId);

  return {
    ok: true,
    action: anyCreated ? "created" : "updated",
    parameterId,
    value: clamped,
  };
}

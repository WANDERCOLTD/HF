/**
 * Behavior Target Writer
 *
 * Shared write path for BehaviorTarget updates. Used by:
 * - PATCH /api/playbooks/:playbookId/targets (sidebar panel, PLAYBOOK scope)
 * - PATCH /api/callers/:callerId/behavior-targets (sidebar panel, CALLER scope)
 * - update_behavior_target chat tool (Cmd+K Tuning tab — both scopes, #661)
 *
 * Centralises the AI-to-DB guard (parameterId whitelist + numeric clamp +
 * isAdjustable check) so all three call sites cannot drift. See
 * .claude/rules/ai-to-db-guard.md.
 */

import { prisma } from "@/lib/prisma";
import type { BehaviorTargetSource } from "@prisma/client";

export type WriteTargetResult =
  | { ok: true; action: "created" | "updated" | "removed" | "noop"; parameterId: string; value: number | null }
  | { ok: false; parameterId: string; reason: "playbook_not_found" | "parameter_not_adjustable" };

export type WriteCallerTargetResult =
  | { ok: true; action: "created" | "updated" | "removed" | "noop"; parameterId: string; value: number | null; identitiesAffected: number }
  | { ok: false; parameterId: string; reason: "caller_not_found" | "caller_has_no_identity" | "parameter_not_adjustable" };

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
    return { ok: true, action: "removed", parameterId, value: null };
  }

  const clamped = Math.max(0, Math.min(1, targetValue));
  const source = options?.source ?? "MANUAL";

  if (existing) {
    await prisma.behaviorTarget.update({
      where: { id: existing.id },
      data: {
        targetValue: clamped,
        source,
        updatedAt: new Date(),
      },
    });
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
  return { ok: true, action: "created", parameterId, value: clamped };
}

/**
 * #661 — Apply a single CALLER-scope BehaviorTarget write driven by a `callerId`.
 *
 * Resolves the caller's CallerIdentity rows (a caller can have multiple
 * identities — phone, email, etc.) and writes the override to each. Mirrors
 * the multi-identity write loop in `app/api/callers/[callerId]/behavior-targets/route.ts`
 * so the chat tool path matches the sidebar's PATCH endpoint exactly.
 *
 * - `targetValue: null` removes the override (delete all matching CALLER rows).
 * - Otherwise clamps the value into [0, 1] and upserts one row per identity.
 * - Validates `parameterId` against the live adjustable BEHAVIOR catalogue.
 * - Refuses when the caller has zero `CallerIdentity` rows (no target to
 *   attach to — operator must give the caller an identity first).
 */
export async function writeCallerBehaviorTarget(
  callerId: string,
  parameterId: string,
  targetValue: number | null,
  options?: { validParamIds?: Set<string>; source?: BehaviorTargetSource },
): Promise<WriteCallerTargetResult> {
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: {
      id: true,
      callerIdentities: { select: { id: true } },
    },
  });
  if (!caller) {
    return { ok: false, parameterId, reason: "caller_not_found" };
  }

  const identityIds = caller.callerIdentities.map((i) => i.id);
  if (identityIds.length === 0) {
    return { ok: false, parameterId, reason: "caller_has_no_identity" };
  }

  const valid = options?.validParamIds ?? (await loadAdjustableSet());
  if (!valid.has(parameterId)) {
    return { ok: false, parameterId, reason: "parameter_not_adjustable" };
  }

  const source = options?.source ?? "MANUAL";

  if (targetValue === null) {
    const del = await prisma.behaviorTarget.deleteMany({
      where: {
        parameterId,
        scope: "CALLER",
        callerIdentityId: { in: identityIds },
        effectiveUntil: null,
      },
    });
    return {
      ok: true,
      action: del.count === 0 ? "noop" : "removed",
      parameterId,
      value: null,
      identitiesAffected: del.count,
    };
  }

  const clamped = Math.max(0, Math.min(1, targetValue));
  let affected = 0;
  let anyExisting = false;

  await prisma.$transaction(async (tx) => {
    for (const identityId of identityIds) {
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
        anyExisting = true;
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
      }
      affected += 1;
    }
  });

  return {
    ok: true,
    action: anyExisting ? "updated" : "created",
    parameterId,
    value: clamped,
    identitiesAffected: affected,
  };
}

/** Batch helper — loads the whitelist once and writes each target. */
export async function writeBehaviorTargets(
  playbookId: string,
  targets: Array<{ parameterId: string; targetValue: number | null }>,
): Promise<WriteTargetResult[]> {
  const validParamIds = await loadAdjustableSet();
  const results: WriteTargetResult[] = [];
  for (const t of targets) {
    if (!t.parameterId) continue;
    results.push(await writeBehaviorTarget(playbookId, t.parameterId, t.targetValue, { validParamIds }));
  }
  return results;
}

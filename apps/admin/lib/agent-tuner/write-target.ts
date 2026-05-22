/**
 * Behavior Target Writer
 *
 * Shared write path for PLAYBOOK-scope BehaviorTarget updates. Used by:
 * - PATCH /api/playbooks/:playbookId/targets (panel)
 * - update_behavior_target chat tool (Cmd+K AI assistant)
 *
 * Centralises the AI-to-DB guard (parameterId whitelist + numeric clamp)
 * so both call sites cannot drift. See .claude/rules/ai-to-db-guard.md.
 */

import { prisma } from "@/lib/prisma";

export type WriteTargetResult =
  | { ok: true; action: "created" | "updated" | "removed" | "noop"; parameterId: string; value: number | null }
  | { ok: false; parameterId: string; reason: "playbook_not_found" | "parameter_not_adjustable" };

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
  options?: { validParamIds?: Set<string> },
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

  if (existing) {
    await prisma.behaviorTarget.update({
      where: { id: existing.id },
      data: {
        targetValue: clamped,
        source: "MANUAL",
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
      source: "MANUAL",
    },
  });
  return { ok: true, action: "created", parameterId, value: clamped };
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

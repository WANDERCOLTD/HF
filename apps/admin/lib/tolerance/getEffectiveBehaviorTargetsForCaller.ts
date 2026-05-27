/**
 * Bulk SYSTEM → PLAYBOOK → CALLER cascade reader for the Tune sidebar's BEH
 * sliders (#911, epic #909). Returns the merged `effectiveValue` for every
 * adjustable BEHAVIOR parameter at the given (playbookId, callerId) pair.
 *
 * Why a bulk helper:
 *   - `resolve-tolerance.ts::readCallerBehaviorTargetValue` is hardcoded to
 *     the mastery-threshold parameter and is one DB round-trip per parameter.
 *     The sidebar shows ~25 sliders at once — composing the single-param
 *     resolver would be N round-trips per render.
 *   - This helper does ONE `findMany` per layer (SYSTEM / PLAYBOOK / CALLER)
 *     and groups in memory, so it scales with parameter count not query count.
 *
 * Chain-contract Link 3 (FK semantics) — `BehaviorTarget.callerIdentityId`
 * points at `CallerIdentity.id`, NOT `Caller.id`. The CALLER layer therefore
 * fans out via `resolveCallerIdentityIds` (canonical primitive in
 * `lib/agent-tuner/write-target.ts`) and takes the MAX `targetValue` across
 * identity rows — same tie-break as `resolve-tolerance.ts`. The most-
 * favourable override wins so a stale lower value on one identity can't
 * silently undercut a legitimately higher one on another.
 *
 * Read-only: this helper makes ZERO writes (no calls to
 * `bumpCallerComposeTimestamp` / `bumpPlaybookComposeTimestamp` / any other
 * writer). The compose stamps are written from the WRITE paths (sidebar PATCH
 * / chat-tool / etc.); a read for display must not touch them.
 *
 * @see docs/CHAIN-CONTRACTS.md Link 3a (authoring-side cascade read parity)
 * @see apps/admin/scripts/audit-epic-100.ts (counter authoringBehTargetBypassCount)
 */

import { prisma } from "@/lib/prisma";
import { resolveCallerIdentityIds } from "@/lib/agent-tuner/write-target";

export type EffectiveBehaviorTargetSourceScope = "SYSTEM" | "PLAYBOOK" | "CALLER";

export interface EffectiveBehaviorTarget {
  parameterId: string;
  effectiveValue: number;
  sourceScope: EffectiveBehaviorTargetSourceScope;
  systemValue: number | null;
  playbookValue: number | null;
  callerValue: number | null;
}

/**
 * Bulk-read the cascade-merged BEHAVIOR target values for one caller in the
 * context of one playbook. Order of precedence: CALLER > PLAYBOOK > SYSTEM.
 *
 * Returns one entry per adjustable BEHAVIOR parameter that has at least one
 * layer populated. Parameters with no layer at all are omitted (the playbook
 * targets endpoint defaults those to 0.5 — callers can do the same with the
 * returned list as the source of truth).
 *
 * @param playbookId - Playbook UUID to scope SYSTEM + PLAYBOOK reads against.
 * @param callerId   - Caller UUID to fan out to CallerIdentity rows for the
 *                     CALLER-scope layer. Pass an empty string / unknown id to
 *                     receive SYSTEM+PLAYBOOK only (no throw — the helper is
 *                     intentionally tolerant so the API endpoint can decide
 *                     whether to 400 on missing inputs).
 */
export async function getEffectiveBehaviorTargetsForCaller(
  playbookId: string,
  callerId: string,
): Promise<EffectiveBehaviorTarget[]> {
  // ── 1. SYSTEM layer ────────────────────────────────────────────────────
  // Same shape as the SYSTEM read in
  // app/api/playbooks/[playbookId]/targets/route.ts so the cascade can't
  // drift between this helper and that endpoint.
  const systemRows = await prisma.behaviorTarget.findMany({
    where: { scope: "SYSTEM", effectiveUntil: null },
    select: { parameterId: true, targetValue: true },
  });
  const systemByParam = new Map<string, number>();
  for (const r of systemRows) systemByParam.set(r.parameterId, r.targetValue);

  // ── 2. PLAYBOOK layer ──────────────────────────────────────────────────
  const playbookRows = await prisma.behaviorTarget.findMany({
    where: { scope: "PLAYBOOK", playbookId, effectiveUntil: null },
    select: { parameterId: true, targetValue: true },
  });
  const playbookByParam = new Map<string, number>();
  for (const r of playbookRows) playbookByParam.set(r.parameterId, r.targetValue);

  // ── 3. CALLER layer (multi-identity MAX, per chain-contract Link 3) ────
  const callerByParam = new Map<string, number>();
  if (callerId) {
    const ids = await resolveCallerIdentityIds(callerId);
    if (ids.ok && ids.identityIds.length > 0) {
      const callerRows = await prisma.behaviorTarget.findMany({
        where: {
          scope: "CALLER",
          callerIdentityId: { in: ids.identityIds },
          effectiveUntil: null,
        },
        select: { parameterId: true, targetValue: true },
      });
      for (const r of callerRows) {
        const existing = callerByParam.get(r.parameterId);
        if (existing === undefined || r.targetValue > existing) {
          callerByParam.set(r.parameterId, r.targetValue);
        }
      }
    }
  }

  // ── Merge ──────────────────────────────────────────────────────────────
  // Union of parameterIds touched by any layer.
  const parameterIds = new Set<string>([
    ...systemByParam.keys(),
    ...playbookByParam.keys(),
    ...callerByParam.keys(),
  ]);

  const out: EffectiveBehaviorTarget[] = [];
  for (const parameterId of parameterIds) {
    const systemValue = systemByParam.get(parameterId) ?? null;
    const playbookValue = playbookByParam.get(parameterId) ?? null;
    const callerValue = callerByParam.get(parameterId) ?? null;

    let effectiveValue: number;
    let sourceScope: EffectiveBehaviorTargetSourceScope;
    if (callerValue !== null) {
      effectiveValue = callerValue;
      sourceScope = "CALLER";
    } else if (playbookValue !== null) {
      effectiveValue = playbookValue;
      sourceScope = "PLAYBOOK";
    } else {
      // SYSTEM is guaranteed non-null by the union check above when we land
      // here, but TypeScript doesn't know that — coerce defensively.
      effectiveValue = systemValue ?? 0.5;
      sourceScope = "SYSTEM";
    }

    out.push({
      parameterId,
      effectiveValue,
      sourceScope,
      systemValue,
      playbookValue,
      callerValue,
    });
  }

  // Sort for stable ordering across reads.
  out.sort((a, b) => a.parameterId.localeCompare(b.parameterId));
  return out;
}

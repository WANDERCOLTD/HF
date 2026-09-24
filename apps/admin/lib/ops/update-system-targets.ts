/**
 * Update System-Scope Behavior Targets — ADAPT-stage canonical writer
 *
 * Chokepoint for the ADAPT op at `/api/calls/[callId]/ops/[opId]` (opId=adapt).
 * The ADAPT op reads a per-call REWARD-stage `parameterDiffs[]` payload and
 * adjusts SYSTEM-scope `BehaviorTarget` rows in the direction the reward
 * signal suggests. Pre-#2031 the route hand-rolled the write with no:
 *
 *   - parameterId whitelist (any AI-returned string would update the row)
 *   - numeric clamp ([0, 1] invariant the rest of the cascade assumes)
 *   - cascade-cache invalidation (#1454 Slice 2 — `invalidateKnob` on every
 *     BEH-* write so downstream effective-value reads see the new target)
 *   - explicit `source` stamp (so forensics can distinguish ADAPT-learned
 *     writes from MANUAL admin edits — see `BehaviorTargetSource.LEARNED`)
 *
 * This helper enforces all four. Mirrors `lib/agent-tuner/write-target.ts`
 * but at the SYSTEM tier rather than PLAYBOOK / CALLER, and consumed by
 * the ADAPT op rather than the admin UI / chat tools.
 *
 * Pairs with the chokepoint ESLint rule `hf-registry/no-bare-behavior-target-write`
 * (#2031 S2): bare `prisma.behaviorTarget.{create,update,upsert,delete*,*Many}`
 * outside the allow-list fails CI. ADAPT-stage writes route through here;
 * customer-driven tuning routes through `lib/agent-tuner/write-target.ts`.
 *
 * See:
 *   - `.claude/rules/ai-to-db-guard.md` — validate-then-write discipline
 *   - `.claude/rules/lattice-survey.md` — sibling-writer survey
 *   - `lib/agent-tuner/write-target.ts` — PLAYBOOK / CALLER scope sibling
 */

import { prisma } from "@/lib/prisma";
import type { BehaviorTargetSource } from "@prisma/client";
import { invalidateKnob } from "@/lib/cascade/effective-value";

export type AdaptTargetUpdate = {
  parameterId: string;
  previousValue: number;
  nextValue: number;
};

export type UpdateSystemTargetResult =
  | {
      ok: true;
      action: "updated" | "noop";
      parameterId: string;
      previousValue: number;
      nextValue: number;
    }
  | {
      ok: false;
      parameterId: string;
      reason: "parameter_not_adjustable" | "no_target_row";
    };

/**
 * Cache the whitelist within a single ADAPT batch — every diff loop
 * looks up the same adjustable set, so resolve it once.
 */
async function loadAdjustableSet(): Promise<Set<string>> {
  const rows = await prisma.parameter.findMany({
    where: { parameterType: "BEHAVIOR", isAdjustable: true },
    select: { parameterId: true },
  });
  return new Set(rows.map((r) => r.parameterId));
}

/**
 * Apply a single SYSTEM-scope BehaviorTarget adjustment driven by the
 * REWARD-stage diff. Validates the parameterId against the live
 * adjustable BEHAVIOR catalogue, clamps the next value into [0, 1],
 * stamps `source = LEARNED` (the BehaviorTargetSource member for
 * reward-loop adaptations), and drops the cascade cache for the knob.
 *
 * Returns `{ ok: false, reason: "no_target_row" }` when no SYSTEM-scope
 * row exists — the caller decides whether to log + skip or seed a row.
 * The ADAPT op chooses skip; the SYSTEM seed routes do the creation.
 */
export async function updateSystemBehaviorTargetForAdapt(
  parameterId: string,
  nextValue: number,
  options?: { validParamIds?: Set<string>; source?: BehaviorTargetSource },
): Promise<UpdateSystemTargetResult> {
  const valid = options?.validParamIds ?? (await loadAdjustableSet());
  if (!valid.has(parameterId)) {
    return { ok: false, parameterId, reason: "parameter_not_adjustable" };
  }

  const source: BehaviorTargetSource = options?.source ?? "LEARNED";
  const clamped = Math.max(0, Math.min(1, nextValue));

  const result = await prisma.behaviorTarget.updateMany({
    where: {
      parameterId,
      scope: "SYSTEM",
    },
    data: {
      targetValue: clamped,
      source,
      updatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return { ok: false, parameterId, reason: "no_target_row" };
  }

  // #1454 Slice 2 — drop cascade-cache for this BEH-* knob so the next
  // composed prompt reads the post-ADAPT value.
  invalidateKnob(parameterId);

  // previousValue is informational only — the canonical writer doesn't
  // need to round-trip it, but ADAPT op consumers carry it for log lines.
  return {
    ok: true,
    action: "updated",
    parameterId,
    previousValue: clamped, // unknown without an extra read; pre-state is the caller's concern
    nextValue: clamped,
  };
}

/**
 * Batch helper for ADAPT op — loads the whitelist once and applies each
 * diff-driven adjustment. Returns the per-target results so the caller
 * can compose its `updatesApplied[]` log lines.
 */
export async function updateSystemBehaviorTargetsForAdapt(
  updates: AdaptTargetUpdate[],
  options?: { source?: BehaviorTargetSource },
): Promise<UpdateSystemTargetResult[]> {
  const validParamIds = await loadAdjustableSet();
  const results: UpdateSystemTargetResult[] = [];
  for (const u of updates) {
    if (!u.parameterId) continue;
    const r = await updateSystemBehaviorTargetForAdapt(
      u.parameterId,
      u.nextValue,
      { validParamIds, source: options?.source },
    );
    // Patch in the caller-supplied previousValue (helper can't read it
    // race-free without an extra round-trip).
    if (r.ok) {
      r.previousValue = u.previousValue;
    }
    results.push(r);
  }
  return results;
}

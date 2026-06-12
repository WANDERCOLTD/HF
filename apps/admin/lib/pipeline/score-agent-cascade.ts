/**
 * SCORE_AGENT BehaviorTarget cascade — Slice 3 of epic #1510 (#1513).
 *
 * Loads BehaviorTarget rows for a given playbook with a structural cascade
 * fallback: `(playbookId, scope=PLAYBOOK)` → `(scope=SYSTEM, playbookId=null)`.
 *
 * The cascade is OBSERVATIONAL — it does NOT throw, does NOT block the
 * pipeline, and does NOT alter the existing scoring math at
 * `route.ts::runBatchedAgentAnalysis` (which derives parameters from MEASURE
 * specs, not BehaviorTargets). What it does:
 *
 *   1. Provides the structural fallback the chain contract specifies for
 *      `(playbookId, scope=PLAYBOOK)` BehaviorTarget reads — fixes the
 *      data-gap class (#1513 root cause: CIO/CTO playbooks have zero
 *      BEH-* rows so the cascade reads nothing).
 *   2. Surfaces the gap to operators via I-AL5 in the standard observability
 *      shape (`/x/help/pipeline-health` dashboard from Slice 1 / #1511).
 *
 * Severity ladder (per `docs/CHAIN-CONTRACTS.md` §6):
 *   - PLAYBOOK empty, SYSTEM populated → WARN (`systemDefaultsEmpty: false`)
 *   - PLAYBOOK empty, SYSTEM empty     → ERROR (`systemDefaultsEmpty: true`)
 *   - PLAYBOOK populated                → no emit (cascade root found)
 *
 * NON-BLOCKING contract: the function returns the resolved targets array
 * (possibly empty) and emits I-AL5 fire-and-forget. SCORE_AGENT may
 * proceed even when both cascade levels are empty — the existing MEASURE
 * spec runner already handles the no-target case (`runBatchedAgentAnalysis`
 * keys off `agentParams`, not BehaviorTargets).
 *
 * @see lib/pipeline/adaptive-loop-invariants.ts::recordIAL5ZeroTargets
 * @see app/api/calls/[callId]/pipeline/route.ts::stageExecutors.SCORE_AGENT
 * @see docs/CHAIN-CONTRACTS.md §6 — I-AL5 row
 */

import { prisma } from "@/lib/prisma";
import { recordIAL5ZeroTargets } from "./adaptive-loop-invariants";

export type CascadeScope = "PLAYBOOK" | "SYSTEM" | "NONE";

export interface BehaviorTargetCascadeRow {
  parameterId: string;
  targetValue: number;
  scope: "PLAYBOOK" | "SYSTEM";
}

export interface BehaviorTargetCascadeResult {
  /** Rows resolved by the cascade. Empty array when both scopes are empty. */
  targets: BehaviorTargetCascadeRow[];
  /** Which scope the cascade resolved at. `NONE` when no rows exist anywhere. */
  resolvedScope: CascadeScope;
  /** True iff an I-AL5 violation was emitted for this call. */
  emitted: boolean;
}

/**
 * Load BehaviorTargets for SCORE_AGENT with the PLAYBOOK → SYSTEM cascade.
 *
 * - `playbookId === null` short-circuits straight to the SYSTEM scope (no
 *   playbook context = no playbook query). When SYSTEM is also empty we
 *   STILL emit I-AL5 with `systemDefaultsEmpty: true` so the dashboard
 *   sees the gap.
 * - The function never throws. DB errors fall through to an empty result
 *   with no emit — the observability writer in Slice 1 already pins the
 *   "swallow everything" contract for the I-AL5 path.
 */
export async function loadBehaviorTargetsWithCascade(args: {
  playbookId: string | null;
  callerId?: string;
  callId?: string;
}): Promise<BehaviorTargetCascadeResult> {
  const { playbookId, callerId, callId } = args;

  // Step 1: PLAYBOOK scope (skip when there is no playbook to scope by).
  let playbookRows: Array<{ parameterId: string; targetValue: number }> = [];
  if (playbookId) {
    try {
      playbookRows = await prisma.behaviorTarget.findMany({
        where: { playbookId, scope: "PLAYBOOK" },
        select: { parameterId: true, targetValue: true },
      });
    } catch {
      // Defensive — treat DB error as zero rows so the cascade can still
      // fall through to SYSTEM. The invariant emit downstream is the
      // observability signal; we don't double-log here.
      playbookRows = [];
    }
  }

  if (playbookRows.length > 0) {
    return {
      targets: playbookRows.map((r) => ({
        parameterId: r.parameterId,
        targetValue: r.targetValue,
        scope: "PLAYBOOK" as const,
      })),
      resolvedScope: "PLAYBOOK",
      emitted: false,
    };
  }

  // Step 2: SYSTEM defaults (always queried — they are the cascade root).
  let systemRows: Array<{ parameterId: string; targetValue: number }> = [];
  try {
    systemRows = await prisma.behaviorTarget.findMany({
      where: { scope: "SYSTEM", playbookId: null },
      select: { parameterId: true, targetValue: true },
    });
  } catch {
    systemRows = [];
  }

  const systemEmpty = systemRows.length === 0;

  // I-AL5 emit. Two cases produce a violation row:
  //   (1) PLAYBOOK empty + SYSTEM populated → WARN. The cascade
  //       worked (SYSTEM root caught it) but the playbook is unconfigured;
  //       operators should set per-playbook targets via Course Design.
  //   (2) PLAYBOOK empty + SYSTEM empty     → ERROR. Cascade root is
  //       gone — every code path that reads BehaviorTarget for this
  //       playbook will silently see zero rows. The seed script
  //       (`scripts/seed-system-behavior-defaults.ts`) is the operator
  //       remediation.
  //
  // We suppress the emit only when there is no playbookId AND SYSTEM is
  // populated — that's the harness / brand-new-caller path where the
  // cascade fall-through is by-design, not a gap.
  const shouldEmit = (playbookId !== null) || systemEmpty;
  if (shouldEmit) {
    await recordIAL5ZeroTargets({
      playbookId: playbookId ?? "",
      callerId,
      callId,
      systemDefaultsEmpty: systemEmpty,
    });
  }

  return {
    targets: systemRows.map((r) => ({
      parameterId: r.parameterId,
      targetValue: r.targetValue,
      scope: "SYSTEM" as const,
    })),
    resolvedScope: systemEmpty ? "NONE" : "SYSTEM",
    emitted: shouldEmit,
  };
}

import { prisma } from "@/lib/prisma";

/**
 * Slice 1 — Micro-MVP of the Phase 1 Scheduler (#154).
 *
 * The full scheduler (selectNextExchange, policy weights, preset bundles) lands
 * in Slices 2 and 3. This module only handles persistence of the previous-call
 * decision so EXTRACT can event-gate scoring on the next call.
 *
 * Why a CallerAttribute (not a dedicated column)?
 *   COMPOSE runs in the same pipeline as EXTRACT, but EXTRACT on call N reads
 *   the decision written at COMPOSE on call N-1. CallerAttribute with scope
 *   CURRICULUM is the same pattern already used for carry_forward_tps and
 *   lo_mastery (see modules.ts:492). No schema change needed.
 */

export const SCHEDULER_DECISION_KEY = "scheduler:last_decision";

export type SchedulerMode = "teach" | "review" | "assess" | "practice";

export interface SchedulerDecision {
  mode: SchedulerMode;
  outcomeId: string | null;
  contentSourceId: string | null;
  workingSetAssertionIds: string[];
  reason: string;
  writtenAt: string;
  /**
   * Calls-since-last-assess counter at the time of this decision.
   * Added by Slice 2 (#155). Incremented monotonically on teach/review
   * decisions; reset to 0 on assess. The next COMPOSE reads this and
   * increments to decide whether to fire `mode: assess`. Optional so Slice 1
   * persisted decisions still deserialise.
   */
  callsSinceAssess?: number;
}

export async function persistSchedulerDecision(
  callerId: string,
  decision: Omit<SchedulerDecision, "writtenAt">,
): Promise<void> {
  const payload: SchedulerDecision = {
    ...decision,
    writtenAt: new Date().toISOString(),
  };

  await prisma.callerAttribute.upsert({
    where: {
      callerId_key_scope: {
        callerId,
        key: SCHEDULER_DECISION_KEY,
        scope: "CURRICULUM",
      },
    },
    create: {
      callerId,
      key: SCHEDULER_DECISION_KEY,
      scope: "CURRICULUM",
      valueType: "JSON",
      jsonValue: payload as unknown as object,
      confidence: 1.0,
    },
    update: {
      valueType: "JSON",
      jsonValue: payload as unknown as object,
      confidence: 1.0,
    },
  });
}

export async function readSchedulerDecision(
  callerId: string,
): Promise<SchedulerDecision | null> {
  const attr = await prisma.callerAttribute.findUnique({
    where: {
      callerId_key_scope: {
        callerId,
        key: SCHEDULER_DECISION_KEY,
        scope: "CURRICULUM",
      },
    },
    select: { jsonValue: true },
  });
  if (!attr?.jsonValue) return null;
  return attr.jsonValue as unknown as SchedulerDecision;
}

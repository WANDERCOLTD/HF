/**
 * Voice cost aggregator (AnyVoice #1028).
 *
 * Reads denormalised per-call cost snapshots from `Call.voiceCostUsd`
 * (populated by the webhook normaliser in #1021) and rolls them up by
 * caller / cohort / playbook / provider for the educator and admin UIs.
 *
 * Why denorm snapshot, not metering ledger:
 *   - VAPI reports final cost at end-of-call; that's a single row write.
 *   - Per-minute metering (UsageLog category VOICE, added in this PR's
 *     cost-config.ts) is the path for FUTURE adapters that want to log
 *     incremental minutes. For VAPI today, the end-of-call snapshot is
 *     authoritative — no point double-bookkeeping.
 *   - The Call row is already the join target for caller / cohort /
 *     playbook scopes, so the rollup query is a simple groupBy.
 *
 * Null handling: `voiceCostUsd` is nullable (calls that failed before
 * billing, SIM calls, pre-#1020 historical rows). Aggregations treat
 * null as 0 — the SQL `SUM(... )` already does this; the aggregator
 * also filters with `voiceCostUsd: { not: null }` so a row with zero
 * recorded cost doesn't inflate the call-count denominator on
 * "avg cost per call" calculations.
 *
 * Currency: VAPI reports USD. UI labels as USD; no implicit conversion.
 */

import { prisma } from "@/lib/prisma";

export interface VoiceCostByProvider {
  /** VoiceProvider.slug — same value stored on Call.voiceProvider */
  provider: string;
  /** Sum of voiceCostUsd across matching calls. */
  totalUsd: number;
  /** Count of calls that contributed (non-null cost rows only). */
  callCount: number;
}

export interface VoiceCostSummary {
  /** Combined total across all providers in scope. */
  totalUsd: number;
  /** Per-provider breakdown. */
  byProvider: VoiceCostByProvider[];
  /** Number of calls with a recorded cost. Excludes SIM / null-cost rows. */
  callCount: number;
  /** ISO timestamp of the earliest call in the window (for "since X" labels). */
  since: string | null;
}

/** Default lookback window for educator UI panels. 30 days. */
export const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function windowStart(since?: Date): Date {
  return since ?? new Date(Date.now() - DEFAULT_WINDOW_MS);
}

async function summarise(
  where: Record<string, unknown>,
  since: Date,
): Promise<VoiceCostSummary> {
  const grouped = await prisma.call.groupBy({
    by: ["voiceProvider"],
    where: {
      ...where,
      voiceCostUsd: { not: null },
      createdAt: { gte: since },
    },
    _sum: { voiceCostUsd: true },
    _count: { _all: true },
  });

  const byProvider: VoiceCostByProvider[] = grouped.map((g) => ({
    provider: g.voiceProvider,
    totalUsd: g._sum.voiceCostUsd ?? 0,
    callCount: g._count._all,
  }));

  const totalUsd = byProvider.reduce((acc, r) => acc + r.totalUsd, 0);
  const callCount = byProvider.reduce((acc, r) => acc + r.callCount, 0);

  return {
    totalUsd,
    byProvider,
    callCount,
    since: since.toISOString(),
  };
}

/** Voice cost for a single learner across the window. */
export async function getVoiceCostForCaller(
  callerId: string,
  since?: Date,
): Promise<VoiceCostSummary> {
  return summarise({ callerId }, windowStart(since));
}

/** Voice cost for every learner in a cohort. Uses the multi-cohort
 *  membership join table (CallerCohortMembership) — falls back to the
 *  legacy Caller.cohortGroupId direct relation when membership rows
 *  don't cover all members (transition period from single → multi). */
export async function getVoiceCostForCohort(
  cohortId: string,
  since?: Date,
): Promise<VoiceCostSummary> {
  const memberRows = await prisma.caller.findMany({
    where: {
      OR: [
        { cohortGroupId: cohortId },
        { cohortMemberships: { some: { cohortGroupId: cohortId } } },
      ],
    },
    select: { id: true },
  });
  const callerIds = memberRows.map((c) => c.id);
  if (callerIds.length === 0) {
    return { totalUsd: 0, byProvider: [], callCount: 0, since: windowStart(since).toISOString() };
  }
  return summarise({ callerId: { in: callerIds } }, windowStart(since));
}

/** Voice cost for every call on a playbook (course). */
export async function getVoiceCostForPlaybook(
  playbookId: string,
  since?: Date,
): Promise<VoiceCostSummary> {
  return summarise({ playbookId }, windowStart(since));
}

/** System-wide voice cost grouped by provider. ADMIN-only. */
export async function getVoiceCostByProviderSystemWide(
  since?: Date,
): Promise<VoiceCostSummary> {
  return summarise({}, windowStart(since));
}

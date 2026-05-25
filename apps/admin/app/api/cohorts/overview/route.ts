import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEntityAccess, isEntityAuthError } from "@/lib/access-control";

export const runtime = "nodejs";

/**
 * @api GET /api/cohorts/overview
 * @visibility internal
 * @scope cohorts:read
 * @auth session
 * @tags cohorts, monitoring
 * @description Multi-cohort operator overview — per-cohort engagement + mastery
 *   distribution + lapsed count, plus a roll-up across all cohorts. Companion to
 *   `/x/monitor` (live activity) — this is the per-cohort breakdown. Closes #760
 *   Phase 1A.
 * @response 200 { ok: true, cohorts: Array<CohortOverviewRow>, rollup: Rollup }
 */
export async function GET() {
  const auth = await requireEntityAccess("cohorts", "R");
  if (isEntityAuthError(auth)) return auth.error;

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

  // All active cohorts visible to caller (entity-scoped filter applied below)
  const cohorts = await prisma.cohortGroup.findMany({
    where: { isActive: true },
    include: {
      domain: { select: { id: true, name: true, slug: true } },
      _count: { select: { members: true } },
    },
    orderBy: { name: "asc" },
  });

  // Pull membership → caller IDs per cohort (one query batched)
  const cohortIds = cohorts.map((c) => c.id);
  const memberships = await prisma.callerCohortMembership.findMany({
    where: { cohortGroupId: { in: cohortIds } },
    select: { cohortGroupId: true, callerId: true },
  });

  const callerIdsByCohort = new Map<string, string[]>();
  const allCallerIds = new Set<string>();
  for (const m of memberships) {
    if (!callerIdsByCohort.has(m.cohortGroupId)) callerIdsByCohort.set(m.cohortGroupId, []);
    callerIdsByCohort.get(m.cohortGroupId)!.push(m.callerId);
    allCallerIds.add(m.callerId);
  }

  const allCallerIdsArr = Array.from(allCallerIds);

  // Batched activity + mastery queries
  const [callsLast7d, callsPrior7d, masteryRows] = await Promise.all([
    allCallerIdsArr.length
      ? prisma.call.findMany({
          where: { callerId: { in: allCallerIdsArr }, createdAt: { gte: sevenDaysAgo } },
          select: { callerId: true },
          distinct: ["callerId"],
        })
      : Promise.resolve([]),
    allCallerIdsArr.length
      ? prisma.call.findMany({
          where: {
            callerId: { in: allCallerIdsArr },
            createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
          },
          select: { callerId: true },
          distinct: ["callerId"],
        })
      : Promise.resolve([]),
    allCallerIdsArr.length
      ? prisma.callerModuleProgress.findMany({
          where: { callerId: { in: allCallerIdsArr } },
          select: { callerId: true, mastery: true },
        })
      : Promise.resolve([]),
  ]);

  const calledThisWeek = new Set(callsLast7d.map((c) => c.callerId));
  const calledPriorWeek = new Set(callsPrior7d.map((c) => c.callerId));

  // Average mastery per caller, then bucket per cohort
  const masteryByCaller = new Map<string, { sum: number; count: number }>();
  for (const r of masteryRows) {
    const e = masteryByCaller.get(r.callerId) ?? { sum: 0, count: 0 };
    e.sum += r.mastery;
    e.count += 1;
    masteryByCaller.set(r.callerId, e);
  }

  // Build per-cohort rows
  const rows = cohorts.map((c) => {
    const callerIds = callerIdsByCohort.get(c.id) ?? [];
    let thisWeek = 0;
    let priorWeek = 0;
    const masteryDist = { hi: 0, mid: 0, low: 0, noData: 0 };
    for (const cid of callerIds) {
      if (calledThisWeek.has(cid)) thisWeek += 1;
      if (calledPriorWeek.has(cid)) priorWeek += 1;
      const m = masteryByCaller.get(cid);
      if (!m || m.count === 0) {
        masteryDist.noData += 1;
        continue;
      }
      const avg = m.sum / m.count;
      if (avg >= 0.7) masteryDist.hi += 1;
      else if (avg >= 0.5) masteryDist.mid += 1;
      else masteryDist.low += 1;
    }
    const lapsed = callerIds.length - thisWeek;
    const trend = thisWeek - priorWeek; // positive = improving engagement, negative = falling off
    return {
      cohortId: c.id,
      name: c.name,
      domain: c.domain ? { id: c.domain.id, name: c.domain.name, slug: c.domain.slug } : null,
      memberCount: c._count.members,
      callerCount: callerIds.length,
      calledThisWeek: thisWeek,
      calledPriorWeek: priorWeek,
      lapsedCount: lapsed,
      engagementPct: callerIds.length > 0 ? Math.round((thisWeek / callerIds.length) * 100) : 0,
      trend, // signed delta vs prior 7d
      masteryDist,
      redFlag: callerIds.length > 0 && (
        lapsed / callerIds.length > 0.5 || // >50% lapsed
        masteryDist.low / Math.max(1, callerIds.length - masteryDist.noData) > 0.5 // >50% of measured at low mastery
      ),
    };
  });

  // Roll-up across all cohorts
  const totalLearners = allCallerIds.size;
  const activeThisWeek = calledThisWeek.size;
  const masteryAvgRows = Array.from(masteryByCaller.values()).map((m) => m.sum / m.count);
  const avgMastery = masteryAvgRows.length > 0
    ? masteryAvgRows.reduce((a, b) => a + b, 0) / masteryAvgRows.length
    : 0;
  const redFlagCohorts = rows.filter((r) => r.redFlag).length;

  return NextResponse.json({
    ok: true,
    cohorts: rows,
    rollup: {
      totalCohorts: cohorts.length,
      totalLearners,
      activeThisWeek,
      activeThisWeekPct: totalLearners > 0 ? Math.round((activeThisWeek / totalLearners) * 100) : 0,
      avgMastery,
      redFlagCohorts,
    },
    timestamp: new Date().toISOString(),
  });
}

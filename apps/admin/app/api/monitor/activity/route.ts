import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getFailureStats } from "@/lib/ai/knowledge-accumulation";

export const runtime = "nodejs";

/**
 * @api GET /api/monitor/activity
 * @visibility internal
 * @auth OPERATOR
 * @tags monitoring
 * @description Aggregated live + recent activity signals for the operator
 *   `/x/monitor` board. Single Promise.all over existing models. No new schema.
 *   Closes #761 Phase 1A. Phase 1B adds spend + pipeline-error counts after
 *   UsageEvent / ComposedPrompt status semantics are confirmed.
 * @response 200 { ok: true, liveCalls, recentCallsHour, callsToday, callersTotal, callersActive24h, callersNotCalledToday, openTickets, aiErrorsHour }
 * @response 401 { ok: false, error: "unauthorized" }
 */
export async function GET() {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const now = Date.now();
  const fiveMinAgo = new Date(now - 5 * 60 * 1000);
  const sixtyMinAgo = new Date(now - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    const [
      liveCalls,
      recentCallsHour,
      callsToday,
      callersTotal,
      activeCallerIds24h,
      activeCallerIdsToday,
      openTickets,
      aiStats,
    ] = await Promise.all([
      // Live = endedAt null + started recently (proxy; no real VAPI session feed)
      prisma.call.count({
        where: { endedAt: null, createdAt: { gte: fiveMinAgo } },
      }),
      // Recent feed — last 60 min, latest 20
      prisma.call.findMany({
        where: { createdAt: { gte: sixtyMinAgo } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          endedAt: true,
          callerId: true,
          playbookId: true,
        },
      }),
      prisma.call.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.caller.count(),
      // Distinct callerIds active in last 24h
      prisma.call.findMany({
        where: { createdAt: { gte: twentyFourHoursAgo } },
        select: { callerId: true },
        distinct: ["callerId"],
      }),
      // Distinct callerIds called today
      prisma.call.findMany({
        where: { createdAt: { gte: todayStart } },
        select: { callerId: true },
        distinct: ["callerId"],
      }),
      prisma.ticket.count({
        where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } },
      }),
      // AI errors in last hour — reuses the same helper /x/ai-errors uses
      getFailureStats(1).catch(() => null),
    ]);

    // Enrich recent feed with caller + course names (parallel batch — cheap)
    const callerIds = Array.from(new Set(recentCallsHour.map((c) => c.callerId).filter(Boolean))) as string[];
    const playbookIds = Array.from(new Set(recentCallsHour.map((c) => c.playbookId).filter(Boolean))) as string[];
    const [callerRows, playbookRows] = await Promise.all([
      callerIds.length
        ? prisma.caller.findMany({ where: { id: { in: callerIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      playbookIds.length
        ? prisma.playbook.findMany({ where: { id: { in: playbookIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const callerName = new Map(callerRows.map((c) => [c.id, c.name]));
    const playbookName = new Map(playbookRows.map((p) => [p.id, p.name]));

    return NextResponse.json({
      ok: true,
      liveCalls,
      recentCallsHour: recentCallsHour.map((c) => ({
        id: c.id,
        callerId: c.callerId,
        callerName: c.callerId ? callerName.get(c.callerId) ?? null : null,
        playbookId: c.playbookId,
        courseName: c.playbookId ? playbookName.get(c.playbookId) ?? null : null,
        createdAt: c.createdAt,
        endedAt: c.endedAt,
      })),
      callsToday,
      callersTotal,
      callersActive24h: activeCallerIds24h.length,
      callersCalledToday: activeCallerIdsToday.length,
      callersNotCalledToday: Math.max(0, callersTotal - activeCallerIdsToday.length),
      openTickets,
      aiErrorsHour: aiStats
        ? {
            count: aiStats.totalFailures ?? 0,
            rate: aiStats.failureRate ?? 0,
            alertThresholdExceeded: aiStats.alertThresholdExceeded ?? false,
          }
        : { count: 0, rate: 0, alertThresholdExceeded: false },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[Monitor Activity Error]:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load monitor activity" },
      { status: 500 },
    );
  }
}

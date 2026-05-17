import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { UsageCategory } from "@prisma/client";

export const runtime = "nodejs";

/**
 * @api GET /api/metering/summary
 * @visibility internal
 * @scope metering:read
 * @auth session
 * @tags metering
 * @description Returns aggregated usage summary for the metering dashboard including category totals,
 *   top operations, daily trends, AI breakdown by call point/engine, and today/month-to-date totals
 * @query days number - Number of days to aggregate (default: 30)
 * @response 200 { ok: true, period, totals, today, monthToDate, byCategory, topOperations, dailyTrend, aiByCallPoint, uncategorizedAI }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);

    // Parse date range
    const daysParam = searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date();

    // Get totals by category
    const categoryTotals = await prisma.usageEvent.groupBy({
      by: ["category"],
      where: {
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      _count: { id: true },
      _sum: { quantity: true, costCents: true },
    });

    // Get totals by operation (top 10 most expensive)
    const operationTotals = await prisma.usageEvent.groupBy({
      by: ["category", "operation"],
      where: {
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      _count: { id: true },
      _sum: { quantity: true, costCents: true },
      orderBy: {
        _sum: { costCents: "desc" },
      },
      take: 10,
    });

    // Get AI usage by call point (sourceOp) - for AI Config integration
    const aiByCallPoint = await prisma.usageEvent.groupBy({
      by: ["sourceOp", "model"],
      where: {
        category: "AI",
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
        sourceOp: { not: null },
      },
      _count: { id: true },
      _sum: { quantity: true, costCents: true },
      orderBy: {
        _sum: { costCents: "desc" },
      },
    });

    // Get uncategorized AI usage (AI events without sourceOp)
    const uncategorizedAI = await prisma.usageEvent.aggregate({
      where: {
        category: "AI",
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
        OR: [{ sourceOp: null }, { sourceOp: "" }],
      },
      _count: { id: true },
      _sum: { quantity: true, costCents: true },
    });

    // Get AI usage by engine (mock vs real providers)
    const aiByEngine = await prisma.usageEvent.groupBy({
      by: ["engine"],
      where: {
        category: "AI",
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      _count: { id: true },
      _sum: { quantity: true, costCents: true },
    });

    // Separate mock from real AI calls for clear visibility
    const mockCalls = aiByEngine.find((e) => e.engine === "mock") || { _count: { id: 0 }, _sum: { quantity: 0, costCents: 0 } };
    const realCalls = aiByEngine.filter((e) => e.engine !== "mock" && e.engine !== null);
    const totalRealCalls = realCalls.reduce(
      (acc, e) => ({
        eventCount: acc.eventCount + e._count.id,
        totalQty: acc.totalQty + (e._sum.quantity || 0),
        costCents: acc.costCents + (e._sum.costCents || 0),
      }),
      { eventCount: 0, totalQty: 0, costCents: 0 }
    );

    // Get daily totals for chart
    const dailyTotals = await prisma.$queryRaw<
      Array<{
        date: Date;
        category: UsageCategory;
        event_count: bigint;
        total_qty: number;
        total_cost: number;
      }>
    >`
      SELECT
        DATE_TRUNC('day', "createdAt") as date,
        category,
        COUNT(*) as event_count,
        SUM(quantity) as total_qty,
        SUM("costCents") as total_cost
      FROM "UsageEvent"
      WHERE "createdAt" >= ${startDate}
        AND "createdAt" < ${endDate}
      GROUP BY DATE_TRUNC('day', "createdAt"), category
      ORDER BY date ASC
    `;

    // Get today's totals
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTotals = await prisma.usageEvent.aggregate({
      where: {
        createdAt: { gte: todayStart },
      },
      _count: { id: true },
      _sum: { costCents: true },
    });

    // Get month-to-date totals
    const mtdStart = new Date();
    mtdStart.setDate(1);
    mtdStart.setHours(0, 0, 0, 0);

    const mtdTotals = await prisma.usageEvent.aggregate({
      where: {
        createdAt: { gte: mtdStart },
      },
      _count: { id: true },
      _sum: { costCents: true },
    });

    // Calculate grand totals
    const grandTotal = categoryTotals.reduce(
      (acc, cat) => ({
        eventCount: acc.eventCount + cat._count.id,
        totalQty: acc.totalQty + (cat._sum.quantity || 0),
        totalCost: acc.totalCost + (cat._sum.costCents || 0),
      }),
      { eventCount: 0, totalQty: 0, totalCost: 0 }
    );

    // Format response
    return NextResponse.json({
      ok: true,
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      totals: {
        eventCount: grandTotal.eventCount,
        totalCostCents: grandTotal.totalCost,
        totalCostDollars: (grandTotal.totalCost / 100).toFixed(2),
      },
      today: {
        eventCount: todayTotals._count.id,
        costCents: todayTotals._sum.costCents || 0,
        costDollars: ((todayTotals._sum.costCents || 0) / 100).toFixed(2),
      },
      monthToDate: {
        eventCount: mtdTotals._count.id,
        costCents: mtdTotals._sum.costCents || 0,
        costDollars: ((mtdTotals._sum.costCents || 0) / 100).toFixed(2),
      },
      byCategory: categoryTotals.map((cat) => ({
        category: cat.category,
        eventCount: cat._count.id,
        totalQty: cat._sum.quantity || 0,
        costCents: cat._sum.costCents || 0,
        costDollars: ((cat._sum.costCents || 0) / 100).toFixed(2),
      })),
      topOperations: operationTotals.map((op) => ({
        category: op.category,
        operation: op.operation,
        eventCount: op._count.id,
        totalQty: op._sum.quantity || 0,
        costCents: op._sum.costCents || 0,
        costDollars: ((op._sum.costCents || 0) / 100).toFixed(2),
      })),
      dailyTrend: dailyTotals.map((d) => ({
        date: d.date.toISOString().split("T")[0],
        category: d.category,
        eventCount: Number(d.event_count),
        totalQty: d.total_qty || 0,
        costCents: d.total_cost || 0,
      })),
      aiByCallPoint: aiByCallPoint.map((cp) => ({
        callPoint: cp.sourceOp || "unknown",
        model: cp.model || "unknown",
        eventCount: cp._count.id,
        totalTokens: cp._sum.quantity || 0,
        costCents: cp._sum.costCents || 0,
        costDollars: ((cp._sum.costCents || 0) / 100).toFixed(2),
      })),
      uncategorizedAI: {
        eventCount: uncategorizedAI._count.id,
        totalTokens: uncategorizedAI._sum.quantity || 0,
        costCents: uncategorizedAI._sum.costCents || 0,
        costDollars: ((uncategorizedAI._sum.costCents || 0) / 100).toFixed(2),
      },
      // AI breakdown by engine type (mock vs real)
      aiByEngine: aiByEngine.map((e) => ({
        engine: e.engine || "unknown",
        eventCount: e._count.id,
        totalQty: e._sum.quantity || 0,
        costCents: e._sum.costCents || 0,
        costDollars: ((e._sum.costCents || 0) / 100).toFixed(2),
        isMock: e.engine === "mock",
      })),
      // Summary: mock vs real AI
      aiSummary: {
        mock: {
          eventCount: mockCalls._count.id,
          costCents: mockCalls._sum.costCents || 0,
          costDollars: ((mockCalls._sum.costCents || 0) / 100).toFixed(2),
        },
        real: {
          eventCount: totalRealCalls.eventCount,
          totalTokens: totalRealCalls.totalQty,
          costCents: totalRealCalls.costCents,
          costDollars: (totalRealCalls.costCents / 100).toFixed(2),
        },
        mockPercentage: totalRealCalls.eventCount + mockCalls._count.id > 0
          ? Math.round((mockCalls._count.id / (totalRealCalls.eventCount + mockCalls._count.id)) * 100)
          : 0,
      },
    });
  } catch (error: unknown) {
    console.error("[metering/summary] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch summary",
      },
      { status: 500 }
    );
  }
}

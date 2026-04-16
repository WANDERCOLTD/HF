import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEntityAccess, isEntityAuthError } from "@/lib/access-control";

type Params = { params: Promise<{ callerId: string }> };

/**
 * @api GET /api/callers/:callerId/uplift
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers
 * @description Compute uplift metrics for a learner — survey deltas, score trends, adaptation evidence, engagement
 * @pathParam callerId string - The caller ID
 * @response 200 { ok: true, uplift: UpliftData }
 * @response 404 { ok: false, error: "Caller not found" }
 */
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const authResult = await requireEntityAccess("callers", "R");
  if (isEntityAuthError(authResult)) return authResult.error;

  const { callerId } = await params;

  // Verify caller exists
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
  }

  // Fetch all data in parallel
  const [
    attributes,
    callScores,
    callerTargets,
    calls,
    moduleProgress,
    goals,
    memorySummary,
  ] = await Promise.all([
    // 1. Survey attributes (pre/post confidence + test scores)
    prisma.callerAttribute.findMany({
      where: {
        callerId,
        scope: { in: ["PRE_SURVEY", "POST_SURVEY", "PRE_TEST", "POST_TEST"] },
      },
      select: { key: true, scope: true, numberValue: true, stringValue: true },
    }),

    // 2. Call scores with call dates for trend sparklines
    prisma.callScore.findMany({
      where: { call: { callerId } },
      select: {
        parameterId: true,
        score: true,
        confidence: true,
        scoredAt: true,
        parameter: { select: { name: true } },
        call: { select: { createdAt: true } },
      },
      orderBy: { scoredAt: "asc" },
      take: 500,
    }),

    // 3. Caller targets + parameter names for adaptation evidence
    prisma.callerTarget.findMany({
      where: { callerId },
      include: {
        parameter: {
          select: {
            name: true,
          },
        },
      },
    }),

    // 4. Call dates for engagement metrics
    prisma.call.findMany({
      where: { callerId },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),

    // 5. Module progress
    prisma.callerModuleProgress.findMany({
      where: { callerId },
      select: {
        moduleId: true,
        mastery: true,
        status: true,
        callCount: true,
        module: {
          select: {
            id: true,
            slug: true,
            title: true,
            sortOrder: true,
          },
        },
      },
      orderBy: { module: { sortOrder: "asc" } },
    }),

    // 6. Goals
    prisma.goal.findMany({
      where: { callerId, status: { in: ["ACTIVE", "COMPLETED", "PAUSED"] } },
      select: {
        id: true,
        type: true,
        name: true,
        description: true,
        status: true,
        priority: true,
        progress: true,
        startedAt: true,
        completedAt: true,
        targetDate: true,
        isAssessmentTarget: true,
        assessmentConfig: true,
        playbook: { select: { id: true, name: true, version: true } },
        contentSpec: { select: { id: true, slug: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { priority: "desc" }],
    }),

    // 7. Memory summary
    prisma.callerMemorySummary.findFirst({
      where: { callerId },
      select: {
        factCount: true,
        preferenceCount: true,
        eventCount: true,
        topicCount: true,
      },
    }),
  ]);

  // --- Compute deltas ---

  const getNum = (scope: string, key: string): number | null =>
    attributes.find((a) => a.scope === scope && a.key === key)?.numberValue ?? null;

  const confidencePre = getNum("PRE_SURVEY", "confidence");
  const confidencePost = getNum("POST_SURVEY", "confidence_lift") ?? getNum("POST_SURVEY", "confidence");
  const confidenceDelta = confidencePre != null && confidencePost != null
    ? Math.round((confidencePost - confidencePre) * 100) / 100
    : null;

  const testScorePre = getNum("PRE_TEST", "score");
  const testScorePost = getNum("POST_TEST", "score");
  const knowledgeDelta = testScorePre != null && testScorePost != null
    ? Math.round((testScorePost - testScorePre) * 1000) / 1000
    : null;

  // --- Module mastery ---

  const modules = moduleProgress.map((mp) => ({
    moduleId: mp.module.id,
    slug: mp.module.slug,
    title: mp.module.title,
    sortOrder: mp.module.sortOrder,
    mastery: mp.mastery,
    status: mp.status,
    callCount: mp.callCount,
  }));

  const overallMastery = modules.length > 0
    ? Math.round((modules.reduce((sum, m) => sum + m.mastery, 0) / modules.length) * 1000) / 1000
    : 0;

  // --- Score trends (group by parameter, chronological) ---

  const trendMap = new Map<string, { parameterName: string; scores: { callDate: string; score: number; confidence: number }[] }>();
  for (const s of callScores) {
    if (!trendMap.has(s.parameterId)) {
      trendMap.set(s.parameterId, { parameterName: s.parameter.name, scores: [] });
    }
    trendMap.get(s.parameterId)!.scores.push({
      callDate: s.call.createdAt.toISOString(),
      score: s.score,
      confidence: s.confidence,
    });
  }
  const scoreTrends = Array.from(trendMap.entries()).map(([parameterId, data]) => ({
    parameterId,
    ...data,
  }));

  // --- Adaptation evidence ---

  // System default target is 0.5 — deviations show personalisation
  const SYSTEM_DEFAULT = 0.5;
  const adaptationEvidence = callerTargets
    .map((ct) => ({
      parameterName: ct.parameter.name,
      defaultValue: SYSTEM_DEFAULT,
      currentValue: ct.targetValue,
      delta: Math.round((ct.targetValue - SYSTEM_DEFAULT) * 1000) / 1000,
      callsUsed: ct.callsUsed,
      confidence: ct.confidence,
    }))
    .filter((a) => Math.abs(a.delta) > 0.01) // Only show meaningful adaptations
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // --- Engagement ---

  const totalCalls = calls.length;
  const firstCallAt = calls.length > 0 ? calls[0].createdAt.toISOString() : null;
  const latestCallAt = calls.length > 0 ? calls[calls.length - 1].createdAt.toISOString() : null;

  const timeOnPlatformDays = firstCallAt
    ? Math.max(1, Math.ceil((Date.now() - new Date(firstCallAt).getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  const weeksOnPlatform = Math.max(1, timeOnPlatformDays / 7);
  const callFrequencyPerWeek = Math.round((totalCalls / weeksOnPlatform) * 10) / 10;

  // --- Memory counts ---

  const memoryCounts = {
    facts: memorySummary?.factCount ?? 0,
    preferences: memorySummary?.preferenceCount ?? 0,
    events: memorySummary?.eventCount ?? 0,
    topics: memorySummary?.topicCount ?? 0,
    total: (memorySummary?.factCount ?? 0) + (memorySummary?.preferenceCount ?? 0) +
           (memorySummary?.eventCount ?? 0) + (memorySummary?.topicCount ?? 0),
  };

  return NextResponse.json({
    ok: true,
    uplift: {
      confidencePre,
      confidencePost,
      confidenceDelta,
      testScorePre,
      testScorePost,
      knowledgeDelta,
      overallMastery,
      totalCalls,
      firstCallAt,
      latestCallAt,
      timeOnPlatformDays,
      moduleProgress: modules,
      goals,
      scoreTrends,
      adaptationEvidence,
      memoryCounts,
      callFrequencyPerWeek,
    },
  });
}

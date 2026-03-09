import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { requireEducator, isEducatorAuthError } from "@/lib/educator-access";
import {
  computeMomentum,
  computeTriage,
  daysAgo,
  computeDiagnostic,
  type Momentum,
  type TriageCategory,
} from "@/lib/caller-utils";

export type RosterCaller = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  domain: { id: string; name: string } | null;
  classroom: { id: string; name: string } | null;
  totalCalls: number;
  lastCallAt: string | null;
  recentCallDates: string[];
  mastery: number | null;
  completedModules: number;
  totalModules: number;
  currentModule: string | null;
  momentum: Momentum;
  triage: TriageCategory;
  diagnostic: string;
  pendingConfirmations: number;
  assessmentTarget: { name: string; progress: number; threshold: number } | null;
};

/**
 * @api GET /api/callers/roster
 * @visibility internal
 * @scope callers:read
 * @auth bearer
 * @tags callers, roster
 * @query institutionId - Optional institution ID to scope results
 * @query domainId - Optional domain ID to scope results (ADMIN+)
 * @description Enriched caller list with mastery, momentum, and triage data.
 *   ADMIN+ sees all callers. EDUCATORs see only learners in their owned cohorts.
 * @response 200 { ok: true, roster: RosterCaller[] }
 */
export async function GET(request: NextRequest) {
  const institutionId = request.nextUrl.searchParams.get("institutionId");
  const domainId = request.nextUrl.searchParams.get("domainId");

  try {
  // Determine auth scope
  let where: Record<string, unknown> = { role: "LEARNER", archivedAt: null };

  console.log("[roster] Step 0: Auth...");
  const adminAuth = await requireAuth("ADMIN");
  if (!isAuthError(adminAuth)) {
    console.log("[roster] Step 0: Admin auth OK");
    if (institutionId) {
      where.OR = [
        { cohortMemberships: { some: { cohortGroup: { institutionId, isActive: true } } } },
        { cohortMemberships: { none: {} }, domain: { cohortGroups: { some: { institutionId } } } },
      ];
    }
    if (domainId) {
      where.domainId = domainId;
    }
  } else {
    // Educator path — own cohort members only
    console.log("[roster] Step 0: Trying educator auth...");
    const auth = await requireEducator();
    if (isEducatorAuthError(auth)) return auth.error;

    where.cohortMemberships = {
      some: { cohortGroup: { ownerId: auth.callerId, isActive: true } },
    };
  }

  console.log("[roster] Step 1: Fetching callers...");
  // ── 1. Fetch callers with recent call dates ──────────────────
  const callers = await prisma.caller.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      domain: { select: { id: true, name: true } },
      cohortMemberships: {
        include: { cohortGroup: { select: { id: true, name: true } } },
        take: 1,
      },
      _count: { select: { calls: true } },
      calls: {
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
    orderBy: { name: "asc" },
  });

  console.log("[roster] Step 1 done:", callers.length, "callers");
  if (callers.length === 0) {
    return NextResponse.json({ ok: true, roster: [] });
  }

  const callerIds = callers.map((c) => c.id);

  // ── 2. Batch mastery queries (NOT N+1) ───────────────────────
  const [masteryAgg, completedAgg, currentModules] = await Promise.all([
    // Average mastery per caller
    prisma.callerModuleProgress.groupBy({
      by: ["callerId"],
      where: { callerId: { in: callerIds } },
      _avg: { mastery: true },
      _count: { _all: true },
    }),
    // Count completed modules per caller
    prisma.callerModuleProgress.groupBy({
      by: ["callerId"],
      where: { callerId: { in: callerIds }, status: "COMPLETED" },
      _count: { _all: true },
    }),
    // Current module (lowest mastery non-completed) per caller
    prisma.callerModuleProgress.findMany({
      where: {
        callerId: { in: callerIds },
        status: { not: "COMPLETED" },
      },
      orderBy: { mastery: "asc" },
      distinct: ["callerId"],
      select: {
        callerId: true,
        module: { select: { title: true } },
      },
    }),
  ]);

  console.log("[roster] Step 2 done: mastery/module queries");
  // ── 2b. Pending goal completion signals per caller ──────────
  const pendingSignals = await prisma.callerAttribute.groupBy({
    by: ["callerId"],
    where: {
      callerId: { in: callerIds },
      scope: "GOAL_EVENT",
      key: { startsWith: "goal_completion_signal:" },
      booleanValue: null, // pending only
    },
    _count: { _all: true },
  });
  const pendingMap = new Map(pendingSignals.map((s) => [s.callerId, s._count._all]));

  console.log("[roster] Step 2b done: pending signals");
  // ── 2c. Primary assessment target per caller (highest priority active) ──
  const assessmentTargets = await prisma.goal.findMany({
    where: {
      callerId: { in: callerIds },
      isAssessmentTarget: true,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    select: {
      callerId: true,
      name: true,
      progress: true,
      priority: true,
      assessmentConfig: true,
    },
    orderBy: { priority: "desc" },
    distinct: ["callerId"],
  });
  const assessmentMap = new Map(
    assessmentTargets.map((g) => [g.callerId, {
      name: g.name,
      progress: g.progress,
      threshold: (g.assessmentConfig as any)?.threshold ?? 0.8,
    }])
  );

  console.log("[roster] Step 2c done: assessment targets");
  // Build lookup maps
  const masteryMap = new Map(masteryAgg.map((m) => [m.callerId, { avg: m._avg.mastery, total: m._count._all }]));
  const completedMap = new Map(completedAgg.map((c) => [c.callerId, c._count._all]));
  const currentModuleMap = new Map(currentModules.map((m) => [m.callerId, m.module.title]));

  // ── 3. Assemble roster ───────────────────────────────────────
  const roster: RosterCaller[] = callers.map((c) => {
    const callDates = c.calls.map((call) => call.createdAt.toISOString());
    const lastCallAt = callDates[0] ?? null;
    const lastDays = daysAgo(lastCallAt);
    const totalCalls = c._count.calls;

    const masteryInfo = masteryMap.get(c.id);
    const mastery = masteryInfo?.avg ?? null;
    const totalModules = masteryInfo?.total ?? 0;
    const completedModules = completedMap.get(c.id) ?? 0;
    const currentModule = currentModuleMap.get(c.id) ?? null;

    const momentum = computeMomentum(callDates);
    const triage = computeTriage(mastery, momentum, lastDays, totalCalls);
    const diagnostic = computeDiagnostic(triage, mastery, momentum, totalCalls, lastDays);

    const primaryCohort = c.cohortMemberships?.[0]?.cohortGroup;

    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      domain: c.domain,
      classroom: primaryCohort ? { id: primaryCohort.id, name: primaryCohort.name } : null,
      totalCalls,
      lastCallAt,
      recentCallDates: callDates,
      mastery,
      completedModules,
      totalModules,
      currentModule,
      momentum,
      triage,
      diagnostic,
      pendingConfirmations: pendingMap.get(c.id) ?? 0,
      assessmentTarget: assessmentMap.get(c.id) ?? null,
    };
  });

  console.log("[roster] Step 3 done: assembled", roster.length, "entries, serializing...");
  return NextResponse.json({ ok: true, roster });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    console.error("[roster] Failed to load roster:", errMsg, errStack);
    return NextResponse.json(
      { ok: false, error: "Failed to load roster", detail: errMsg },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MemoryCategory } from "@prisma/client";
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

// ─── BEH parameter IDs surfaced in the differentiation lens ──────────────────

const KEY_BEH_PARAMS = [
  "BEH-SCAFFOLDING",
  "BEH-CHALLENGE-LEVEL",
  "BEH-EXAMPLE-RICHNESS",
  "BEH-CONCEPT-DENSITY",
  "BEH-SOCRATIC-QUESTIONING",
  "BEH-EXPLANATION-DEPTH",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type MasteryBand = "foundation" | "developing" | "advanced" | "noData";

export type DiffStudentTargets = {
  scaffolding: number | null;
  challengeLevel: number | null;
  exampleRichness: number | null;
  conceptDensity: number | null;
  socratiicQuestioning: number | null;
  explanationDepth: number | null;
};

export type DiffStudent = {
  id: string;
  name: string | null;
  // Triage
  triage: TriageCategory;
  momentum: Momentum;
  diagnostic: string;
  totalCalls: number;
  lastCallAt: string | null;
  // Mastery
  mastery: number | null;
  masteryBand: MasteryBand;
  // Pace (from LEARNER_PROFILE CallerAttributes)
  pacePreference: string | null;
  // Adaptation targets — latest values from CallerTarget
  targets: DiffStudentTargets;
  // Top 2 memories for context
  keyMemories: string[];
};

export type DifferentiationResponse = {
  ok: boolean;
  classroom: { id: string; name: string; memberCount: number };
  students: DiffStudent[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toMasteryBand(mastery: number | null): MasteryBand {
  if (mastery === null) return "noData";
  if (mastery < 0.4) return "foundation";
  if (mastery < 0.7) return "developing";
  return "advanced";
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * @api GET /api/educator/classrooms/[id]/differentiation
 * @visibility internal
 * @scope educator:read
 * @auth bearer
 * @tags educator, classrooms, differentiation
 * @description Enriched per-student differentiation data for a classroom: mastery
 *   bands, triage, pace preference, and personalised BEH adaptation targets.
 *   Educators see only their own classrooms; ADMIN+ can view any.
 * @response 200 { ok: true, classroom: {...}, students: DiffStudent[] }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Auth ─────────────────────────────────────────────────────────────────
  let cohortFilter: Record<string, unknown> = { id };

  const adminAuth = await requireAuth("ADMIN");
  if (isAuthError(adminAuth)) {
    const auth = await requireEducator();
    if (isEducatorAuthError(auth)) return auth.error;
    cohortFilter = { id, ownerId: auth.callerId };
  }

  // ── 1. Classroom + member IDs ─────────────────────────────────────────────
  const classroom = await prisma.cohortGroup.findFirst({
    where: cohortFilter,
    select: {
      id: true,
      name: true,
      memberships: {
        select: { callerId: true },
      },
      // legacy FK members
      members: {
        select: { id: true },
      },
    },
  });

  if (!classroom) {
    return NextResponse.json({ ok: false, error: "Classroom not found" }, { status: 404 });
  }

  // Combine both membership styles, deduplicate
  const memberIdSet = new Set<string>([
    ...classroom.memberships.map((m) => m.callerId),
    ...classroom.members.map((m) => m.id),
  ]);
  const callerIds = [...memberIdSet];

  if (callerIds.length === 0) {
    return NextResponse.json({
      ok: true,
      classroom: { id: classroom.id, name: classroom.name, memberCount: 0 },
      students: [],
    });
  }

  // ── 2. Batch DB queries (all parallel — no N+1) ───────────────────────────
  const [
    callers,
    masteryAgg,
    recentCallRows,
    targetRows,
    paceAttrRows,
    memoryRows,
  ] = await Promise.all([
    // Caller basic info
    prisma.caller.findMany({
      where: { id: { in: callerIds }, archivedAt: null },
      select: {
        id: true,
        name: true,
        _count: { select: { calls: true } },
      },
    }),

    // Average mastery per caller
    prisma.callerModuleProgress.groupBy({
      by: ["callerId"],
      where: { callerId: { in: callerIds } },
      _avg: { mastery: true },
    }),

    // Recent call dates for momentum computation (last 10 per caller)
    prisma.call.findMany({
      where: { callerId: { in: callerIds } },
      select: { callerId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      // We fetch all recent calls and limit in-memory per caller
      take: callerIds.length * 10,
    }),

    // Latest BEH adaptation targets (DISTINCT ON callerId+parameterId via orderBy)
    prisma.callerTarget.findMany({
      where: {
        callerId: { in: callerIds },
        parameterId: { in: [...KEY_BEH_PARAMS] },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        callerId: true,
        parameterId: true,
        targetValue: true,
      },
    }),

    // Pace preference from LEARNER_PROFILE CallerAttributes
    prisma.callerAttribute.findMany({
      where: {
        callerId: { in: callerIds },
        scope: "LEARNER_PROFILE",
        key: { contains: "pace_preference" },
      },
      select: { callerId: true, stringValue: true },
    }),

    // Top 2 memories per caller (FACT or PREFERENCE for context richness)
    prisma.callerMemory.findMany({
      where: {
        callerId: { in: callerIds },
        category: { in: [MemoryCategory.FACT, MemoryCategory.PREFERENCE, MemoryCategory.TOPIC] },
        confidence: { gte: 0.6 },
      },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      select: { callerId: true, value: true },
      take: callerIds.length * 2,
    }),
  ]);

  // ── 3. Build lookup maps ──────────────────────────────────────────────────

  const masteryMap = new Map(
    masteryAgg.map((m) => [m.callerId, m._avg.mastery ?? null])
  );

  // Group recent calls by caller (newest first, cap at 10 per caller)
  const callsByCallerId = new Map<string, string[]>();
  for (const row of recentCallRows) {
    if (!row.callerId) continue;
    const arr = callsByCallerId.get(row.callerId) ?? [];
    if (arr.length < 10) {
      arr.push(row.createdAt.toISOString());
      callsByCallerId.set(row.callerId, arr);
    }
  }

  // Latest target per (callerId, parameterId)
  const targetMap = new Map<string, Map<string, number>>();
  for (const t of targetRows) {
    if (!targetMap.has(t.callerId)) targetMap.set(t.callerId, new Map());
    const callerTargets = targetMap.get(t.callerId)!;
    // Only set the first (latest) value per parameterId
    if (!callerTargets.has(t.parameterId)) {
      callerTargets.set(t.parameterId, t.targetValue);
    }
  }

  const paceMap = new Map(
    paceAttrRows.map((a) => [a.callerId, a.stringValue])
  );

  // Top 2 memories per caller
  const memoryMap = new Map<string, string[]>();
  for (const m of memoryRows) {
    const arr = memoryMap.get(m.callerId) ?? [];
    if (arr.length < 2) {
      arr.push(m.value);
      memoryMap.set(m.callerId, arr);
    }
  }

  // ── 4. Assemble students ──────────────────────────────────────────────────

  const students: DiffStudent[] = callers.map((c) => {
    const callDates = callsByCallerId.get(c.id) ?? [];
    const lastCallAt = callDates[0] ?? null;
    const lastDays = daysAgo(lastCallAt);
    const totalCalls = c._count.calls;
    const mastery = masteryMap.get(c.id) ?? null;
    const momentum = computeMomentum(callDates);
    const triage = computeTriage(mastery, momentum, lastDays, totalCalls);
    const diagnostic = computeDiagnostic(triage, mastery, momentum, totalCalls, lastDays);
    const callerTargets = targetMap.get(c.id) ?? new Map<string, number>();

    return {
      id: c.id,
      name: c.name,
      triage,
      momentum,
      diagnostic,
      totalCalls,
      lastCallAt,
      mastery,
      masteryBand: toMasteryBand(mastery),
      pacePreference: paceMap.get(c.id) ?? null,
      targets: {
        scaffolding: callerTargets.get("BEH-SCAFFOLDING") ?? null,
        challengeLevel: callerTargets.get("BEH-CHALLENGE-LEVEL") ?? null,
        exampleRichness: callerTargets.get("BEH-EXAMPLE-RICHNESS") ?? null,
        conceptDensity: callerTargets.get("BEH-CONCEPT-DENSITY") ?? null,
        socratiicQuestioning: callerTargets.get("BEH-SOCRATIC-QUESTIONING") ?? null,
        explanationDepth: callerTargets.get("BEH-EXPLANATION-DEPTH") ?? null,
      },
      keyMemories: memoryMap.get(c.id) ?? [],
    };
  });

  // Sort: attention first, then by mastery asc (struggling first within band)
  students.sort((a, b) => {
    const triageOrder: Record<TriageCategory, number> = {
      attention: 0, advancing: 1, active: 2, inactive: 3, new: 4,
    };
    const ta = triageOrder[a.triage];
    const tb = triageOrder[b.triage];
    if (ta !== tb) return ta - tb;
    return (a.mastery ?? 0) - (b.mastery ?? 0);
  });

  return NextResponse.json({
    ok: true,
    classroom: {
      id: classroom.id,
      name: classroom.name,
      memberCount: callerIds.length,
    },
    students,
  } satisfies DifferentiationResponse);
}

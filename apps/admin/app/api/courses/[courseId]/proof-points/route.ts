import { requireAuth, isAuthError } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ courseId: string }> };

type StudentRow = {
  callerId: string;
  name: string | null;
  email: string | null;
  preConfidence: number | null;
  postConfidence: number | null;
  delta: number | null;
  preTestScore: number | null;
  postTestScore: number | null;
  knowledgeDelta: number | null;
  callCount: number;
  nps: number | null;
  satisfaction: number | null;
  preSurveyDone: boolean;
  postSurveyDone: boolean;
  avgMastery: number | null;
  modulesCompleted: number;
  modulesTotal: number;
  lastCallAt: string | null;
};

type ModuleAggregate = {
  moduleId: string;
  slug: string;
  title: string;
  sortOrder: number;
  avgMastery: number;
  completionRate: number;
  learnerCount: number;
};

type MasteryOverview = {
  modules: ModuleAggregate[];
  avgMastery: number | null;
  completionRate: number | null;
  learnersWithProgress: number;
  stdDev: number | null;
  sigma: number | null;
};

type KnowledgeLift = {
  avgPre: number | null;
  avgPost: number | null;
  meanDelta: number | null;
  stdDev: number | null;
  sigma: number | null;
  n: number;
};

type ConfidenceLift = {
  avgPre: number | null;
  avgPost: number | null;
  meanDelta: number | null;
  stdDev: number | null;
  sigma: number | null;
  n: number;
};

type Engagement = {
  totalCallers: number;
  activeCallers: number;
  avgCallsPerStudent: number;
  totalCalls: number;
};

type Satisfaction = {
  avgNps: number | null;
  avgSatisfaction: number | null;
  surveyCount: number;
};

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function escapeCSV(value: string | number | boolean | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCSV(students: StudentRow[]): string {
  const header = 'Name,Email,Pre-Confidence,Post-Confidence,Conf Delta,Pre-Test %,Post-Test %,Knowledge Delta,Calls,Last Call,NPS,Satisfaction,Pre-Survey,Post-Survey,Avg Mastery %,Modules Completed,Modules Total';
  const rows = students.map((s) =>
    [
      escapeCSV(s.name),
      escapeCSV(s.email),
      escapeCSV(s.preConfidence),
      escapeCSV(s.postConfidence),
      escapeCSV(s.delta),
      escapeCSV(s.preTestScore != null ? Math.round(s.preTestScore * 100) : null),
      escapeCSV(s.postTestScore != null ? Math.round(s.postTestScore * 100) : null),
      escapeCSV(s.knowledgeDelta != null ? Math.round(s.knowledgeDelta * 100) : null),
      escapeCSV(s.callCount),
      escapeCSV(s.lastCallAt),
      escapeCSV(s.nps),
      escapeCSV(s.satisfaction),
      escapeCSV(s.preSurveyDone ? 'Yes' : 'No'),
      escapeCSV(s.postSurveyDone ? 'Yes' : 'No'),
      escapeCSV(s.avgMastery != null ? Math.round(s.avgMastery * 100) : null),
      escapeCSV(s.modulesCompleted),
      escapeCSV(s.modulesTotal),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * @api GET /api/courses/[courseId]/proof-points
 * @desc Aggregate pre/post survey data, mastery gains, and engagement metrics for a course's learners
 * @auth OPERATOR+
 * @query format — optional, "csv" to download CSV instead of JSON
 * @returns {object} { ok, confidenceLift, engagement, satisfaction, mastery, students }
 */
export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAuth('OPERATOR');
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;
  const format = request.nextUrl.searchParams.get('format');

  const emptyResponse = {
    ok: true,
    confidenceLift: { avgPre: null, avgPost: null, meanDelta: null, stdDev: null, sigma: null, n: 0 } as ConfidenceLift,
    engagement: { totalCallers: 0, activeCallers: 0, avgCallsPerStudent: 0, totalCalls: 0 } as Engagement,
    satisfaction: { avgNps: null, avgSatisfaction: null, surveyCount: 0 } as Satisfaction,
    knowledgeLift: { avgPre: null, avgPost: null, meanDelta: null, stdDev: null, sigma: null, n: 0 } as KnowledgeLift,
    mastery: { modules: [], avgMastery: null, completionRate: null, learnersWithProgress: 0, stdDev: null, sigma: null } as MasteryOverview,
    students: [] as StudentRow[],
  };

  try {
    // ── 1. Get enrolled callers via CallerPlaybook (canonical source) ──
    const enrollments = await prisma.callerPlaybook.findMany({
      where: { playbookId: courseId, status: 'ACTIVE' },
      select: {
        caller: {
          select: {
            id: true,
            name: true,
            email: true,
            _count: { select: { calls: true } },
            calls: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' as const },
              take: 1,
            },
            callerAttributes: {
              where: { scope: { in: ['PRE_SURVEY', 'POST_SURVEY', 'PRE_TEST', 'POST_TEST'] } },
              select: { key: true, scope: true, numberValue: true, stringValue: true },
            },
          },
        },
      },
    });

    if (enrollments.length === 0) {
      if (format === 'csv') {
        return new NextResponse(buildCSV([]), {
          headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="proof-points.csv"' },
        });
      }
      return NextResponse.json(emptyResponse);
    }

    const callerIds = enrollments.map((e) => e.caller.id);

    // ── 2. Get curriculum modules for this course (4-hop join, batched) ──
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId: courseId },
      select: { subjectId: true },
    });
    const subjectIds = playbookSubjects.map((ps) => ps.subjectId);

    const curricula = await prisma.curriculum.findMany({
      where: { subjectId: { in: subjectIds } },
      select: { id: true },
    });
    const curriculumIds = curricula.map((c) => c.id);

    const modules = await prisma.curriculumModule.findMany({
      where: { curriculumId: { in: curriculumIds }, isActive: true },
      select: { id: true, slug: true, title: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    const moduleIds = modules.map((m) => m.id);
    const moduleMap = new Map(modules.map((m) => [m.id, m]));

    // ── 3. Batch-fetch all mastery progress ──
    const allProgress = moduleIds.length > 0 && callerIds.length > 0
      ? await prisma.callerModuleProgress.findMany({
          where: { moduleId: { in: moduleIds }, callerId: { in: callerIds } },
          select: { callerId: true, moduleId: true, mastery: true, status: true },
        })
      : [];

    // Index progress: callerId → moduleId → record
    const progressByCallerModule = new Map<string, Map<string, { mastery: number; status: string }>>();
    for (const p of allProgress) {
      if (!progressByCallerModule.has(p.callerId)) {
        progressByCallerModule.set(p.callerId, new Map());
      }
      progressByCallerModule.get(p.callerId)!.set(p.moduleId, { mastery: p.mastery, status: p.status });
    }

    // ── 4. Build per-module aggregates ──
    const moduleAggregates: ModuleAggregate[] = modules.map((mod) => {
      const masteries: number[] = [];
      let completed = 0;
      for (const callerId of callerIds) {
        const rec = progressByCallerModule.get(callerId)?.get(mod.id);
        if (rec) {
          masteries.push(rec.mastery);
          if (rec.status === 'COMPLETED') completed++;
        }
      }
      return {
        moduleId: mod.id,
        slug: mod.slug,
        title: mod.title,
        sortOrder: mod.sortOrder,
        avgMastery: masteries.length > 0 ? Math.round(mean(masteries) * 1000) / 1000 : 0,
        completionRate: callerIds.length > 0 ? Math.round((completed / callerIds.length) * 1000) / 1000 : 0,
        learnerCount: masteries.length,
      };
    });

    // ── 5. Build per-student rows with mastery ──
    const totalModules = modules.length;
    const students: StudentRow[] = enrollments.map((e) => {
      const attrs = e.caller.callerAttributes;
      const getNum = (scope: string, key: string): number | null =>
        attrs.find((a) => a.scope === scope && a.key === key)?.numberValue ?? null;
      const hasKey = (scope: string, key: string): boolean =>
        attrs.some((a) => a.scope === scope && a.key === key);

      const preConfidence = getNum('PRE_SURVEY', 'confidence');
      const postConfidence = getNum('POST_SURVEY', 'confidence_lift');
      const delta = preConfidence != null && postConfidence != null ? postConfidence - preConfidence : null;

      // Knowledge test scores (0-1 scale)
      const preTestScore = getNum('PRE_TEST', 'score');
      const postTestScore = getNum('POST_TEST', 'score');
      const knowledgeDelta = preTestScore != null && postTestScore != null ? postTestScore - preTestScore : null;

      // Per-student mastery
      const callerProgress = progressByCallerModule.get(e.caller.id);
      let avgMastery: number | null = null;
      let modulesCompleted = 0;
      if (callerProgress && callerProgress.size > 0) {
        const masteries = Array.from(callerProgress.values()).map((p) => p.mastery);
        avgMastery = Math.round(mean(masteries) * 1000) / 1000;
        modulesCompleted = Array.from(callerProgress.values()).filter((p) => p.status === 'COMPLETED').length;
      }

      return {
        callerId: e.caller.id,
        name: e.caller.name,
        email: e.caller.email,
        preConfidence,
        postConfidence,
        delta,
        preTestScore,
        postTestScore,
        knowledgeDelta,
        callCount: e.caller._count.calls,
        nps: getNum('POST_SURVEY', 'nps'),
        satisfaction: getNum('POST_SURVEY', 'satisfaction'),
        preSurveyDone: hasKey('PRE_SURVEY', 'submitted_at'),
        postSurveyDone: hasKey('POST_SURVEY', 'submitted_at'),
        avgMastery,
        modulesCompleted,
        modulesTotal: totalModules,
        lastCallAt: e.caller.calls[0]?.createdAt?.toISOString() ?? null,
      };
    });

    // CSV response
    if (format === 'csv') {
      return new NextResponse(buildCSV(students), {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="proof-points.csv"' },
      });
    }

    // ── 6. Compute aggregates ──

    // Confidence lift
    const deltas = students.filter((s) => s.delta != null).map((s) => s.delta!);
    const preValues = students.filter((s) => s.preConfidence != null && s.postConfidence != null).map((s) => s.preConfidence!);
    const postValues = students.filter((s) => s.preConfidence != null && s.postConfidence != null).map((s) => s.postConfidence!);

    let confidenceLift: ConfidenceLift;
    if (deltas.length === 0) {
      confidenceLift = { avgPre: null, avgPost: null, meanDelta: null, stdDev: null, sigma: null, n: 0 };
    } else {
      const meanD = mean(deltas);
      const sd = deltas.length >= 2 ? stdDev(deltas, meanD) : null;
      const sigma = sd != null && sd > 0 ? meanD / sd : null;
      confidenceLift = {
        avgPre: Math.round(mean(preValues) * 100) / 100,
        avgPost: Math.round(mean(postValues) * 100) / 100,
        meanDelta: Math.round(meanD * 100) / 100,
        stdDev: sd != null ? Math.round(sd * 100) / 100 : null,
        sigma: sigma != null ? Math.round(sigma * 100) / 100 : null,
        n: deltas.length,
      };
    }

    // Knowledge lift (pre/post test scores)
    const knowledgeDeltas = students.filter((s) => s.knowledgeDelta != null).map((s) => s.knowledgeDelta!);
    const preTests = students.filter((s) => s.preTestScore != null && s.postTestScore != null).map((s) => s.preTestScore!);
    const postTests = students.filter((s) => s.preTestScore != null && s.postTestScore != null).map((s) => s.postTestScore!);

    let knowledgeLift: KnowledgeLift;
    if (knowledgeDeltas.length === 0) {
      knowledgeLift = { avgPre: null, avgPost: null, meanDelta: null, stdDev: null, sigma: null, n: 0 };
    } else {
      const meanD = mean(knowledgeDeltas);
      const sd = knowledgeDeltas.length >= 2 ? stdDev(knowledgeDeltas, meanD) : null;
      const sigma = sd != null && sd > 0 ? meanD / sd : null;
      knowledgeLift = {
        avgPre: Math.round(mean(preTests) * 1000) / 1000,
        avgPost: Math.round(mean(postTests) * 1000) / 1000,
        meanDelta: Math.round(meanD * 1000) / 1000,
        stdDev: sd != null ? Math.round(sd * 1000) / 1000 : null,
        sigma: sigma != null ? Math.round(sigma * 100) / 100 : null,
        n: knowledgeDeltas.length,
      };
    }

    // Engagement
    const totalCalls = students.reduce((sum, s) => sum + s.callCount, 0);
    const activeCallers = students.filter((s) => s.callCount > 0).length;
    const engagement: Engagement = {
      totalCallers: students.length,
      activeCallers,
      avgCallsPerStudent: students.length > 0 ? Math.round((totalCalls / students.length) * 10) / 10 : 0,
      totalCalls,
    };

    // Satisfaction
    const npsValues = students.filter((s) => s.nps != null).map((s) => s.nps!);
    const satValues = students.filter((s) => s.satisfaction != null).map((s) => s.satisfaction!);
    const surveyCount = students.filter((s) => s.postSurveyDone).length;
    const satisfaction: Satisfaction = {
      avgNps: npsValues.length > 0 ? Math.round(mean(npsValues)) : null,
      avgSatisfaction: satValues.length > 0 ? Math.round(mean(satValues) * 10) / 10 : null,
      surveyCount,
    };

    // Mastery overview
    const learnersWithProgress = students.filter((s) => s.avgMastery != null).length;
    const allStudentMasteries = students.filter((s) => s.avgMastery != null).map((s) => s.avgMastery!);
    const allStudentCompleted = students.filter((s) => s.modulesCompleted > 0);
    const masteryStdDev = allStudentMasteries.length >= 2
      ? Math.round(stdDev(allStudentMasteries, mean(allStudentMasteries)) * 1000) / 1000
      : null;
    const masteryMean = allStudentMasteries.length > 0 ? mean(allStudentMasteries) : null;
    const masterySigma = masteryStdDev != null && masteryStdDev > 0 && masteryMean != null
      ? Math.round((masteryMean / masteryStdDev) * 100) / 100
      : null;

    const mastery: MasteryOverview = {
      modules: moduleAggregates,
      avgMastery: masteryMean != null ? Math.round(masteryMean * 1000) / 1000 : null,
      completionRate: totalModules > 0 && students.length > 0
        ? Math.round((allStudentCompleted.length / students.length) * 1000) / 1000
        : null,
      learnersWithProgress,
      stdDev: masteryStdDev,
      sigma: masterySigma,
    };

    return NextResponse.json({
      ok: true,
      confidenceLift,
      knowledgeLift,
      engagement,
      satisfaction,
      mastery,
      students,
    });
  } catch (err) {
    console.error('[GET /api/courses/[courseId]/proof-points]', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch proof points' },
      { status: 500 }
    );
  }
}

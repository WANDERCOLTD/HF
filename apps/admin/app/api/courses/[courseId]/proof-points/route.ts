import { requireAuth, isAuthError } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ courseId: string }> };

type StudentRow = {
  name: string | null;
  email: string | null;
  preConfidence: number | null;
  postConfidence: number | null;
  delta: number | null;
  callCount: number;
  nps: number | null;
  satisfaction: number | null;
  preSurveyDone: boolean;
  postSurveyDone: boolean;
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
  const header = 'Name,Email,Pre-Confidence,Post-Confidence,Delta,Calls,NPS,Satisfaction,Pre-Survey,Post-Survey';
  const rows = students.map((s) =>
    [
      escapeCSV(s.name),
      escapeCSV(s.email),
      escapeCSV(s.preConfidence),
      escapeCSV(s.postConfidence),
      escapeCSV(s.delta),
      escapeCSV(s.callCount),
      escapeCSV(s.nps),
      escapeCSV(s.satisfaction),
      escapeCSV(s.preSurveyDone ? 'Yes' : 'No'),
      escapeCSV(s.postSurveyDone ? 'Yes' : 'No'),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * @api GET /api/courses/[courseId]/proof-points
 * @desc Aggregate pre/post survey data, mastery gains, and engagement metrics for a course's learners
 * @auth OPERATOR+
 * @query format — optional, "csv" to download CSV instead of JSON
 * @returns {object} { ok, confidenceLift, engagement, satisfaction, students }
 */
export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireAuth('OPERATOR');
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;
  const format = request.nextUrl.searchParams.get('format');

  try {
    // Find the course's default cohort (earliest created)
    const cohort = await prisma.cohortGroup.findFirst({
      where: { playbooks: { some: { playbookId: courseId } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!cohort) {
      const empty = {
        ok: true,
        confidenceLift: { avgPre: null, avgPost: null, meanDelta: null, stdDev: null, sigma: null, n: 0 },
        engagement: { totalCallers: 0, activeCallers: 0, avgCallsPerStudent: 0, totalCalls: 0 },
        satisfaction: { avgNps: null, avgSatisfaction: null, surveyCount: 0 },
        students: [],
      };
      if (format === 'csv') {
        return new NextResponse(buildCSV([]), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="proof-points.csv"',
          },
        });
      }
      return NextResponse.json(empty);
    }

    // Get all callers in this cohort with survey attributes and call counts
    const members = await prisma.callerCohortMembership.findMany({
      where: { cohortGroupId: cohort.id },
      include: {
        caller: {
          select: {
            id: true,
            name: true,
            email: true,
            _count: { select: { calls: true } },
            callerAttributes: {
              where: { scope: { in: ['PRE_SURVEY', 'POST_SURVEY'] } },
              select: { key: true, scope: true, numberValue: true, stringValue: true },
            },
          },
        },
      },
    });

    // Extract per-student rows
    const students: StudentRow[] = members.map((m) => {
      const attrs = m.caller.callerAttributes;
      const getNum = (scope: string, key: string): number | null =>
        attrs.find((a) => a.scope === scope && a.key === key)?.numberValue ?? null;
      const hasKey = (scope: string, key: string): boolean =>
        attrs.some((a) => a.scope === scope && a.key === key);

      const preConfidence = getNum('PRE_SURVEY', 'confidence');
      const postConfidence = getNum('POST_SURVEY', 'confidence_lift');
      const delta = preConfidence != null && postConfidence != null ? postConfidence - preConfidence : null;

      return {
        name: m.caller.name,
        email: m.caller.email,
        preConfidence,
        postConfidence,
        delta,
        callCount: m.caller._count.calls,
        nps: getNum('POST_SURVEY', 'nps'),
        satisfaction: getNum('POST_SURVEY', 'satisfaction'),
        preSurveyDone: hasKey('PRE_SURVEY', 'submitted_at'),
        postSurveyDone: hasKey('POST_SURVEY', 'submitted_at'),
      };
    });

    // CSV response
    if (format === 'csv') {
      return new NextResponse(buildCSV(students), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="proof-points.csv"',
        },
      });
    }

    // Compute confidence lift aggregates
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

    // Compute engagement
    const totalCalls = students.reduce((sum, s) => sum + s.callCount, 0);
    const activeCallers = students.filter((s) => s.callCount > 0).length;
    const engagement: Engagement = {
      totalCallers: students.length,
      activeCallers,
      avgCallsPerStudent: students.length > 0 ? Math.round((totalCalls / students.length) * 10) / 10 : 0,
      totalCalls,
    };

    // Compute satisfaction
    const npsValues = students.filter((s) => s.nps != null).map((s) => s.nps!);
    const satValues = students.filter((s) => s.satisfaction != null).map((s) => s.satisfaction!);
    const surveyCount = students.filter((s) => s.postSurveyDone).length;
    const satisfaction: Satisfaction = {
      avgNps: npsValues.length > 0 ? Math.round(mean(npsValues)) : null,
      avgSatisfaction: satValues.length > 0 ? Math.round(mean(satValues) * 10) / 10 : null,
      surveyCount,
    };

    return NextResponse.json({
      ok: true,
      confidenceLift,
      engagement,
      satisfaction,
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

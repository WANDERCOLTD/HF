import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import { loRefsMatch } from "@/lib/lesson-plan/lo-ref-match";

type Params = { params: Promise<{ courseId: string }> };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenomeModule {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
  /** First teaching session this module appears in (1-based) */
  sessionStart: number;
  /** Last teaching session this module appears in (1-based) */
  sessionEnd: number;
  loCount: number;
}

interface GenomeLO {
  ref: string;
  description: string;
  moduleSlug: string;
  /** First teaching session (1-based) */
  sessionStart: number;
  /** Last teaching session (1-based) */
  sessionEnd: number;
  assertionCount: number;
}

export interface GenomeAssertion {
  id: string;
  assertion: string;
  category: string;
}

interface GenomeSessionAssertions {
  /** Teaching session index (1-based, teaching-only — excludes structural stops) */
  teachingIndex: number;
  /** Original session number from lesson plan */
  session: number;
  type: string;
  label: string;
  moduleSlug: string | null;
  /** Assertion count per category */
  categories: Record<string, number>;
  totalAssertions: number;
  /** Is this an assessment waymarker? */
  isAssessment: boolean;
  /** LO refs for this session */
  loRefs: string[];
  /** Individual assertions for drill-down */
  assertions: GenomeAssertion[];
}

export interface GenomeJourneyStop {
  session: number;
  type: string;
  label: string;
  /** 1-based teaching index (null for structural/survey stops) */
  teachingIndex: number | null;
}

export interface GenomeData {
  courseId: string;
  courseName: string;
  teachingSessionCount: number;
  totalAssertions: number;
  modules: GenomeModule[];
  learningOutcomes: GenomeLO[];
  sessions: GenomeSessionAssertions[];
  /** Full lesson plan as compact stops (including structural) for journey rail */
  journeyStops: GenomeJourneyStop[];
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * @api GET /api/courses/:courseId/genome
 * @visibility internal
 * @scope courses:read
 * @auth session (VIEWER+)
 * @tags courses, lesson-plan, visualization
 * @description Returns hierarchical data for the course genome browser visualization.
 *   Computes module spans, LO spans, and per-session assertion category breakdowns
 *   across teaching sessions only (excludes structural/survey stops).
 * @response 200 { ok: true, data: GenomeData }
 * @response 404 { ok: false, error: "..." }
 */
export async function GET(
  _req: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;

    // 1. Load playbook with name
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, name: true, domainId: true },
    });
    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
    }

    // 2. Resolve subjects → curriculum
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId: courseId },
      select: { subjectId: true },
    });
    const subjectIds = playbookSubjects.map((ps) => ps.subjectId);
    if (subjectIds.length === 0) {
      return NextResponse.json({ ok: true, data: emptyGenome(courseId, playbook.name) });
    }

    // 3. Find curriculum with lesson plan
    const curriculum = await prisma.curriculum.findFirst({
      where: { subjectId: { in: subjectIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deliveryConfig: true,
        modules: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            slug: true,
            title: true,
            sortOrder: true,
            learningObjectives: {
              orderBy: { sortOrder: "asc" },
              select: { id: true, ref: true, description: true },
            },
          },
        },
      },
    });

    const dc = curriculum?.deliveryConfig as any;
    const entries: any[] = dc?.lessonPlan?.entries || [];
    if (entries.length === 0) {
      return NextResponse.json({ ok: true, data: emptyGenome(courseId, playbook.name) });
    }

    // 4. Filter to teaching sessions only
    const STRUCTURAL = ["onboarding", "offboarding", "pre_survey", "post_survey", "mid_survey"];
    const teachingEntries = entries.filter((e: any) => !STRUCTURAL.includes(e.type));
    if (teachingEntries.length === 0) {
      return NextResponse.json({ ok: true, data: emptyGenome(courseId, playbook.name) });
    }

    // 5. Resolve sourceIds for assertion lookup
    const sourceIds = await resolveSourceIds(subjectIds);

    // 6. Load assertions for all sessions that have assertionIds
    const allAssertionIds = teachingEntries.flatMap((e: any) => e.assertionIds || []);
    const assertionMap = new Map<string, { assertion: string; category: string; learningOutcomeRef: string | null; learningObjectiveId: string | null }>();

    if (allAssertionIds.length > 0) {
      const assertions = await prisma.contentAssertion.findMany({
        where: { id: { in: allAssertionIds }, category: { notIn: [...INSTRUCTION_CATEGORIES] } },
        select: { id: true, assertion: true, category: true, learningOutcomeRef: true, learningObjectiveId: true },
      });
      for (const a of assertions) {
        assertionMap.set(a.id, { assertion: a.assertion, category: a.category, learningOutcomeRef: a.learningOutcomeRef, learningObjectiveId: a.learningObjectiveId });
      }
    }

    // 7. Build module lookup
    const moduleMap = new Map(
      (curriculum?.modules || []).map((m) => [m.slug, m]),
    );

    // 8. Build genome sessions with category breakdowns
    const genomeSessions: GenomeSessionAssertions[] = teachingEntries.map((entry: any, idx: number) => {
      const ids: string[] = entry.assertionIds || [];
      const categories: Record<string, number> = {};
      const loRefsFromAssertions = new Set<string>();
      const sessionAssertions: GenomeAssertion[] = [];

      for (const id of ids) {
        const a = assertionMap.get(id);
        if (a) {
          categories[a.category] = (categories[a.category] || 0) + 1;
          if (a.learningOutcomeRef) loRefsFromAssertions.add(a.learningOutcomeRef);
          sessionAssertions.push({ id, assertion: a.assertion, category: a.category });
        }
      }

      const loRefs = entry.learningOutcomeRefs?.length
        ? entry.learningOutcomeRefs
        : [...loRefsFromAssertions];

      return {
        teachingIndex: idx + 1,
        session: entry.session,
        type: entry.type,
        label: entry.label || `Session ${idx + 1}`,
        moduleSlug: entry.moduleId || null,
        categories,
        totalAssertions: sessionAssertions.length,
        isAssessment: entry.type === "assess",
        loRefs,
        assertions: sessionAssertions,
      };
    });

    // 9. Compute module spans (first→last teaching session appearance)
    const genomeModules: GenomeModule[] = [];
    for (const [slug, mod] of moduleMap) {
      const sessionsWithModule = genomeSessions.filter((s) => s.moduleSlug === slug);
      if (sessionsWithModule.length === 0) continue;

      genomeModules.push({
        id: mod.id,
        slug,
        title: mod.title,
        sortOrder: mod.sortOrder,
        sessionStart: Math.min(...sessionsWithModule.map((s) => s.teachingIndex)),
        sessionEnd: Math.max(...sessionsWithModule.map((s) => s.teachingIndex)),
        loCount: mod.learningObjectives.length,
      });
    }
    genomeModules.sort((a, b) => a.sortOrder - b.sortOrder);

    // 10. Compute LO spans
    const genomeLOs: GenomeLO[] = [];
    for (const mod of curriculum?.modules || []) {
      for (const lo of mod.learningObjectives) {
        // Find sessions that reference this LO
        // #142: prefer FK matching, fall back to string ref
        const sessionsWithLO = genomeSessions.filter((s) =>
          s.loRefs.some((ref) => loRefsMatch(ref, lo.ref)),
        );
        if (sessionsWithLO.length === 0) continue;

        // #142: Count assertions linked to this LO via FK
        let assertionCount = 0;
        for (const [, a] of assertionMap) {
          if (a.learningObjectiveId === lo.id) {
            assertionCount++;
          }
        }
        // Fallback: string ref matching if FK found nothing
        if (assertionCount === 0) {
          for (const [, a] of assertionMap) {
            if (loRefsMatch(a.learningOutcomeRef, lo.ref)) {
              assertionCount++;
            }
          }
        }

        genomeLOs.push({
          ref: lo.ref,
          description: lo.description,
          moduleSlug: mod.slug,
          sessionStart: Math.min(...sessionsWithLO.map((s) => s.teachingIndex)),
          sessionEnd: Math.max(...sessionsWithLO.map((s) => s.teachingIndex)),
          assertionCount,
        });
      }
    }

    // 11. Build full journey stops (all entries including structural)
    const teachingIndexBySession = new Map(
      genomeSessions.map((s) => [s.session, s.teachingIndex]),
    );
    const journeyStops: GenomeJourneyStop[] = entries.map((entry: any) => ({
      session: entry.session,
      type: entry.type,
      label: entry.label || entry.type,
      teachingIndex: teachingIndexBySession.get(entry.session) ?? null,
    }));

    const data: GenomeData = {
      courseId,
      courseName: playbook.name,
      teachingSessionCount: teachingEntries.length,
      totalAssertions: assertionMap.size,
      modules: genomeModules,
      learningOutcomes: genomeLOs,
      sessions: genomeSessions,
      journeyStops,
    };

    return NextResponse.json({ ok: true, data });
  } catch (error: any) {
    console.error("[courses/:id/genome] GET error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyGenome(courseId: string, courseName: string): GenomeData {
  return {
    courseId,
    courseName,
    teachingSessionCount: 0,
    totalAssertions: 0,
    journeyStops: [],
    modules: [],
    learningOutcomes: [],
    sessions: [],
  };
}

async function resolveSourceIds(subjectIds: string[]): Promise<string[]> {
  const sources = await prisma.subjectSource.findMany({
    where: { subjectId: { in: subjectIds } },
    select: { sourceId: true },
  });
  return [...new Set(sources.map((s) => s.sourceId))];
}

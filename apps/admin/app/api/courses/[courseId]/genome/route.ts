import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import { getSourceIdsForPlaybook } from "@/lib/knowledge/domain-sources";

type Params = { params: Promise<{ courseId: string }> };

// ---------------------------------------------------------------------------
// Types — module-based genome (no session/lesson-plan dependency)
// ---------------------------------------------------------------------------

interface GenomeModule {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
  /** Column index in the genome grid (1-based) */
  sessionStart: number;
  sessionEnd: number;
  loCount: number;
}

interface GenomeLO {
  ref: string;
  description: string;
  moduleSlug: string;
  /** Column index matching the parent module */
  sessionStart: number;
  sessionEnd: number;
  assertionCount: number;
}

export interface GenomeAssertion {
  id: string;
  assertion: string;
  category: string;
}

interface GenomeSessionAssertions {
  /** Module index (1-based) — reuses "session" naming for GenomeBrowser compat */
  teachingIndex: number;
  session: number;
  type: string;
  label: string;
  moduleSlug: string | null;
  /** Assertion count per category */
  categories: Record<string, number>;
  totalAssertions: number;
  isAssessment: boolean;
  loRefs: string[];
  assertions: GenomeAssertion[];
}

export interface GenomeJourneyStop {
  session: number;
  type: string;
  label: string;
  teachingIndex: number | null;
}

export interface GenomeData {
  courseId: string;
  courseName: string;
  /** Number of modules (replaces teachingSessionCount) */
  teachingSessionCount: number;
  totalAssertions: number;
  modules: GenomeModule[];
  learningOutcomes: GenomeLO[];
  /** One entry per module (replaces per-session entries) */
  sessions: GenomeSessionAssertions[];
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
 * @tags courses, curriculum, visualization
 * @description Returns module-based genome data for the course genome browser.
 *   Each module becomes a column with its assertions grouped by category.
 *   No longer depends on lesson plans — works as soon as curriculum modules exist.
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

    // 1. Load playbook
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, name: true },
    });
    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
    }

    // 2. Find curriculum — canonical PlaybookCurriculum primary join,
    // fallback to subject chain. #1177 Slice 6.
    let curriculum = await prisma.curriculum.findFirst({
      where: { playbookLinks: { some: { playbookId: courseId, role: "primary" } } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
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

    if (!curriculum) {
      // Fallback: subject chain
      const ps = await prisma.playbookSubject.findMany({
        where: { playbookId: courseId },
        select: { subjectId: true },
      });
      if (ps.length > 0) {
        curriculum = await prisma.curriculum.findFirst({
          where: { subjectId: { in: ps.map((p) => p.subjectId) } },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
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
      }
    }

    if (!curriculum || curriculum.modules.length === 0) {
      return NextResponse.json({ ok: true, data: emptyGenome(courseId, playbook.name) });
    }

    // 3. Source IDs via PlaybookSource
    const sourceIds = await getSourceIdsForPlaybook(courseId);

    // 4. Load ALL content assertions for this course (exclude instruction categories)
    const allAssertions = sourceIds.length > 0
      ? await prisma.contentAssertion.findMany({
          where: {
            sourceId: { in: sourceIds },
            category: { notIn: [...INSTRUCTION_CATEGORIES] },
          },
          select: {
            id: true,
            assertion: true,
            category: true,
            learningOutcomeRef: true,
            learningObjectiveId: true,
          },
        })
      : [];

    // 5. Build LO ID → module slug mapping
    const loIdToModule = new Map<string, string>();
    const loRefToModule = new Map<string, string>();
    for (const mod of curriculum.modules) {
      for (const lo of mod.learningObjectives) {
        loIdToModule.set(lo.id, mod.slug);
        loRefToModule.set(lo.ref, mod.slug);
      }
    }

    // 6. Assign assertions to modules via LO linkage
    const moduleAssertions = new Map<string, typeof allAssertions>();
    const unassigned: typeof allAssertions = [];

    for (const a of allAssertions) {
      const modSlug = (a.learningObjectiveId && loIdToModule.get(a.learningObjectiveId))
        || (a.learningOutcomeRef && loRefToModule.get(a.learningOutcomeRef))
        || null;

      if (modSlug) {
        const list = moduleAssertions.get(modSlug) || [];
        list.push(a);
        moduleAssertions.set(modSlug, list);
      } else {
        unassigned.push(a);
      }
    }

    // 7. Build genome data — one "session" per module
    const genomeModules: GenomeModule[] = [];
    const genomeSessions: GenomeSessionAssertions[] = [];
    const genomeLOs: GenomeLO[] = [];

    for (let i = 0; i < curriculum.modules.length; i++) {
      const mod = curriculum.modules[i];
      const colIndex = i + 1;
      const assertions = moduleAssertions.get(mod.slug) || [];

      // Module span
      genomeModules.push({
        id: mod.id,
        slug: mod.slug,
        title: mod.title,
        sortOrder: mod.sortOrder,
        sessionStart: colIndex,
        sessionEnd: colIndex,
        loCount: mod.learningObjectives.length,
      });

      // Category breakdown for this module
      const categories: Record<string, number> = {};
      const loRefsInModule = new Set<string>();
      const genomeAssertions: GenomeAssertion[] = [];

      for (const a of assertions) {
        categories[a.category] = (categories[a.category] || 0) + 1;
        if (a.learningOutcomeRef) loRefsInModule.add(a.learningOutcomeRef);
        genomeAssertions.push({ id: a.id, assertion: a.assertion, category: a.category });
      }

      genomeSessions.push({
        teachingIndex: colIndex,
        session: colIndex,
        type: "module",
        label: mod.title,
        moduleSlug: mod.slug,
        categories,
        totalAssertions: assertions.length,
        isAssessment: false,
        loRefs: [...loRefsInModule],
        assertions: genomeAssertions,
      });

      // LOs for this module
      for (const lo of mod.learningObjectives) {
        const loAssertionCount = assertions.filter(
          (a) => a.learningObjectiveId === lo.id || a.learningOutcomeRef === lo.ref,
        ).length;

        genomeLOs.push({
          ref: lo.ref,
          description: lo.description,
          moduleSlug: mod.slug,
          sessionStart: colIndex,
          sessionEnd: colIndex,
          assertionCount: loAssertionCount,
        });
      }
    }

    // 8. Journey stops = modules (simple)
    const journeyStops: GenomeJourneyStop[] = curriculum.modules.map((mod, i) => ({
      session: i + 1,
      type: "module",
      label: mod.title,
      teachingIndex: i + 1,
    }));

    const data: GenomeData = {
      courseId,
      courseName: playbook.name,
      teachingSessionCount: curriculum.modules.length,
      totalAssertions: allAssertions.length,
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

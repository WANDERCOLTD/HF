import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

type Params = { params: Promise<{ courseId: string }> };

/**
 * @api GET /api/courses/:courseId/sessions
 * @visibility internal
 * @scope courses:read
 * @auth session (VIEWER+)
 * @tags courses, lesson-plan, sessions
 * @description Returns the lesson plan sessions for a course. Looks up subjects via
 *   PlaybookSubject (domain fallback), then finds the first curriculum with a persisted
 *   lessonPlan in deliveryConfig. Falls back to raw CurriculumModule list when no plan exists.
 * @response 200 { ok, plan, modules, curriculumId, subjectCount }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: Params,
) {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;

    // 1. Fetch playbook
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, domainId: true },
    });

    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
    }

    // 2. Get subjects — PlaybookSubject first, domain fallback
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId: courseId },
      select: { subjectId: true },
    });

    const subjectIds = playbookSubjects.length > 0
      ? playbookSubjects.map((ps) => ps.subjectId)
      : (await prisma.subjectDomain.findMany({
          where: { domainId: playbook.domainId },
          select: { subjectId: true },
        })).map((sd) => sd.subjectId);

    if (subjectIds.length === 0) {
      return NextResponse.json({
        ok: true,
        plan: null,
        modules: [],
        curriculumId: null,
        subjectCount: 0,
      });
    }

    // 3. Fetch curricula with deliveryConfig and modules
    const curricula = await prisma.curriculum.findMany({
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
            description: true,
            estimatedDurationMinutes: true,
            sortOrder: true,
            _count: { select: { learningObjectives: true } },
          },
        },
      },
    });

    // 4. Find first curriculum with a persisted lesson plan
    let plan: Record<string, any> | null = null;
    let curriculumId: string | null = null;

    for (const c of curricula) {
      const dc = c.deliveryConfig as Record<string, any> | null;
      if (dc?.lessonPlan?.entries?.length) {
        plan = dc.lessonPlan;
        curriculumId = c.id;
        break;
      }
    }

    // If no plan found, still track the first curriculum for regenerate
    if (!curriculumId && curricula.length > 0) {
      curriculumId = curricula[0].id;
    }

    // 5. Collect modules as fallback
    const modules = curricula.flatMap((c) =>
      c.modules.map((m) => ({
        id: m.id,
        slug: m.slug,
        title: m.title,
        description: m.description,
        estimatedDurationMinutes: m.estimatedDurationMinutes,
        sortOrder: m.sortOrder,
        learningObjectiveCount: m._count.learningObjectives,
      })),
    );

    return NextResponse.json({
      ok: true,
      plan: plan
        ? {
            entries: (plan.entries as any[]).map((e: any) => ({
              session: e.session,
              type: e.type,
              moduleId: e.moduleId || null,
              moduleLabel: e.moduleLabel || "",
              label: e.label || e.title || `Session ${e.session}`,
              notes: e.notes || null,
              estimatedDurationMins: e.estimatedDurationMins || e.durationMins || null,
              assertionCount: e.assertionCount || null,
              phases: Array.isArray(e.phases) ? e.phases : null,
              learningOutcomeRefs: Array.isArray(e.learningOutcomeRefs) ? e.learningOutcomeRefs : null,
            })),
            estimatedSessions: plan.estimatedSessions || plan.entries?.length || 0,
            generatedAt: plan.generatedAt || null,
          }
        : null,
      modules,
      curriculumId,
      subjectCount: subjectIds.length,
    });
  } catch (error: unknown) {
    console.error("[courses/:id/sessions] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load sessions" },
      { status: 500 },
    );
  }
}

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
 *   Pass ?includeProgress=true to also return per-student session progress (CallerAttribute).
 * @response 200 { ok, plan, modules, curriculumId, subjectCount, studentProgress? }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  req: NextRequest,
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

    // 6. Optionally include student progress
    const includeProgress = req.nextUrl.searchParams.get("includeProgress") === "true";
    let studentProgress: Array<{ callerId: string; name: string; currentSession: number | null }> | undefined;

    if (includeProgress && plan) {
      // Get enrolled students via CallerPlaybook
      const callerPlaybooks = await prisma.callerPlaybook.findMany({
        where: { playbookId: courseId },
        select: { caller: { select: { id: true, name: true } } },
      });

      const memberMap = new Map<string, string>();
      for (const cp of callerPlaybooks) {
        memberMap.set(cp.caller.id, cp.caller.name ?? "Unknown");
      }
      const memberIds = [...memberMap.keys()];

      // Get current_session CallerAttribute for each member
      const sessionAttrs = memberIds.length > 0
        ? await prisma.callerAttribute.findMany({
            where: {
              callerId: { in: memberIds },
              key: { contains: ":current_session" },
              scope: "CURRICULUM",
            },
            select: { callerId: true, numberValue: true },
          })
        : [];

      const sessionByCallerId = new Map<string, number>();
      for (const attr of sessionAttrs) {
        if (attr.numberValue !== null) {
          sessionByCallerId.set(attr.callerId, Math.round(attr.numberValue));
        }
      }

      studentProgress = [...memberMap.entries()].map(([callerId, name]) => ({
        callerId,
        name,
        currentSession: sessionByCallerId.get(callerId) ?? null,
      }));
    }

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
            model: plan.model || null,
          }
        : null,
      modules,
      curriculumId,
      subjectCount: subjectIds.length,
      ...(studentProgress !== undefined && { studentProgress }),
    });
  } catch (error: unknown) {
    console.error("[courses/:id/sessions] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load sessions" },
      { status: 500 },
    );
  }
}

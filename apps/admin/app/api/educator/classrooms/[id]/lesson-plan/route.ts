import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/educator/classrooms/[id]/lesson-plan
 * @visibility internal
 * @scope classroom:read
 * @auth EDUCATOR
 * @tags educator, classroom, lesson-plan
 * @description Returns the lesson plan sessions for all courses assigned to a classroom,
 *   plus each student's current session number (from CallerAttribute key :current_session).
 *   Used by the Lesson Plan tab on the classroom detail page.
 * @response 200 { ok, courses, studentProgress }
 * @response 404 { ok: false, error: "Classroom not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await requireAuth("EDUCATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { id } = await params;

    // Verify classroom exists
    const classroom = await prisma.cohortGroup.findUnique({
      where: { id },
      select: { id: true, domainId: true },
    });

    if (!classroom) {
      return NextResponse.json({ ok: false, error: "Classroom not found" }, { status: 404 });
    }

    // Get all playbooks assigned to this classroom, including their subjects' curricula
    const cohortPlaybooks = await prisma.cohortPlaybook.findMany({
      where: { cohortGroupId: id },
      select: {
        playbook: {
          select: {
            id: true,
            name: true,
            subjects: {
              select: {
                subject: {
                  select: {
                    curricula: {
                      orderBy: { createdAt: "desc" },
                      take: 1,
                      select: { slug: true, deliveryConfig: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Build course list with lesson plan entries + collect first curriculum slug for TP progress
    let firstCurriculumSlug: string | null = null;
    const courses = cohortPlaybooks
      .map(({ playbook }) => {
        let lessonPlanConfig: Record<string, any> | null = null;
        for (const ps of playbook.subjects) {
          const c = ps.subject.curricula[0];
          if (!c) continue;
          if (c.slug && !firstCurriculumSlug) firstCurriculumSlug = c.slug;
          const dc = c.deliveryConfig as Record<string, any> | null;
          if (dc?.lessonPlan?.entries?.length) {
            lessonPlanConfig = dc.lessonPlan;
            break;
          }
        }
        if (!lessonPlanConfig) return null;

        return {
          playbookId: playbook.id,
          playbookName: playbook.name,
          model: lessonPlanConfig.model ?? null,
          entries: (lessonPlanConfig.entries as any[]).map((e: any) => ({
            session: e.session,
            type: e.type,
            label: e.label || e.title || `Session ${e.session}`,
            moduleLabel: e.moduleLabel || null,
            estimatedDurationMins: e.estimatedDurationMins || e.durationMins || null,
            phases: Array.isArray(e.phases) ? e.phases : null,
          })),
        };
      })
      .filter(Boolean);

    // Get all classroom members (new join table + legacy FK)
    const [memberships, legacyMembers] = await Promise.all([
      prisma.callerCohortMembership.findMany({
        where: { cohortGroupId: id },
        select: {
          caller: { select: { id: true, name: true } },
        },
      }),
      prisma.caller.findMany({
        where: { cohortGroupId: id, cohortMemberships: { none: { cohortGroupId: id } } },
        select: { id: true, name: true },
      }),
    ]);

    const memberMap = new Map<string, string | null>();
    for (const m of memberships) {
      memberMap.set(m.caller.id, m.caller.name ?? null);
    }
    for (const c of legacyMembers) {
      memberMap.set(c.id, c.name ?? null);
    }

    // Get TP mastery progress for each member
    let studentProgress: Array<{ callerId: string; name: string | null; mastered: number; inProgress: number; notStarted: number; totalTps: number }>;

    if (firstCurriculumSlug) {
      const { getTpProgressSummary } = await import("@/lib/curriculum/track-progress");
      studentProgress = await Promise.all(
        [...memberMap.entries()].map(async ([callerId, name]) => {
          const summary = await getTpProgressSummary(callerId, firstCurriculumSlug!);
          return { callerId, name, ...summary };
        }),
      );
    } else {
      studentProgress = [...memberMap.entries()].map(([callerId, name]) => ({
        callerId,
        name,
        mastered: 0,
        inProgress: 0,
        notStarted: 0,
        totalTps: 0,
      }));
    }

    return NextResponse.json({ ok: true, courses, studentProgress });
  } catch (error: unknown) {
    console.error("[classrooms/lesson-plan] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load lesson plan" },
      { status: 500 },
    );
  }
}

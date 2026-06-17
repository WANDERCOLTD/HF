import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getLessonPlanModel } from "@/lib/lesson-plan/models";
import { runAdvisoryChecks, type LessonSession } from "@/lib/content-trust/lesson-planner";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import { PlaybookCurriculumRole } from "@prisma/client";

/**
 * @api GET /api/courses/:courseId/distribution-advisory
 * @visibility internal
 * @scope courses:read
 * @auth VIEWER
 * @tags courses, lesson-plan
 * @description Runs advisory checks against the course's current lesson plan.
 *   Checks: overloaded_session, thin_session, unassigned_tps, prerequisite_violation.
 *   Returns an array of advisory warnings/errors.
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, advisories, stats }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId } = await params;

    // Load playbook with its curriculum (#1205 — via canonical PlaybookCurriculum join)
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        config: true,
        playbookCurricula: {
          where: { role: PlaybookCurriculumRole.primary },
          take: 1,
          select: { curriculum: { select: { id: true, deliveryConfig: true } } },
        },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    // Extract lesson plan entries from the primary curriculum (variant-aware).
    // Pre-#1205 this used `find(c => c.deliveryConfig)` against the deprecated
    // direct relation; the primary join is the single source of truth.
    const curriculum = playbook.playbookCurricula[0]?.curriculum;

    const deliveryConfig = curriculum?.deliveryConfig as Record<string, unknown> | null;
    const lessonPlanEntries = (deliveryConfig?.lessonPlan as Array<Record<string, unknown>>) || [];

    if (lessonPlanEntries.length === 0) {
      return NextResponse.json({
        ok: true,
        advisories: [],
        stats: { totalChecks: 4, errors: 0, warnings: 0, infos: 0 },
      });
    }

    // Convert lesson plan entries to LessonSession shape for advisory checks
    const sessions: LessonSession[] = lessonPlanEntries.map((entry) => ({
      sessionNumber: (entry.session as number) || 0,
      title: (entry.label as string) || (entry.moduleLabel as string) || "",
      objectives: [],
      assertionIds: (entry.assertionIds as string[]) || [],
      questionIds: [],
      vocabularyIds: [],
      estimatedMinutes: (entry.estimatedDurationMins as number) || 0,
      sessionType: ((entry.type as string) || "introduce") as LessonSession["sessionType"],
    }));

    // Load assertions with parentId for prerequisite violation checks
    const { getSourceIdsForPlaybook } = await import("@/lib/knowledge/domain-sources");
    const sourceIds = await getSourceIdsForPlaybook(courseId);

    const assertions = sourceIds.length > 0
      ? await prisma.contentAssertion.findMany({
          where: { sourceId: { in: sourceIds }, category: { notIn: [...INSTRUCTION_CATEGORIES] } },
          select: { id: true, parentId: true },
        })
      : [];

    // Get maxTpsPerSession from model
    const config = (playbook.config as Record<string, unknown>) || {};
    const modelDef = getLessonPlanModel((config.lessonPlanModel as string) || null);
    const maxTPs = modelDef.defaults.maxTpsPerSession;

    const advisories = runAdvisoryChecks(sessions, assertions, maxTPs);

    const stats = {
      totalChecks: 4,
      errors: advisories.filter((a) => a.severity === "error").length,
      warnings: advisories.filter((a) => a.severity === "warning").length,
      infos: advisories.filter((a) => a.severity === "info").length,
    };

    return NextResponse.json({ ok: true, advisories, stats });
  } catch (error: unknown) {
    console.error("[distribution-advisory] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to run advisory checks" },
      { status: 500 },
    );
  }
}

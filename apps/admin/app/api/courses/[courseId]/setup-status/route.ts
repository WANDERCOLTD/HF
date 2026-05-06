import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/courses/:courseId/setup-status
 * @visibility public
 * @scope courses:read
 * @auth VIEWER
 * @tags courses, readiness
 * @description Returns aggregated setup status for stages 4-6 of the Course Setup Tracker.
 *   Stages 1-3 are derived client-side from data already loaded on the page.
 *   This endpoint checks: lesson plan existence, onboarding config, and prompt composability.
 *
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, lessonPlanBuilt, onboardingConfigured, promptComposable, allCriticalPass, details }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const user = await requireAuth("VIEWER");
    if (isAuthError(user)) return user;

    const { courseId } = await params;

    // Load playbook with domain
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        domainId: true,
        config: true,
        domain: {
          select: {
            id: true,
            onboardingIdentitySpecId: true,
            onboardingFlowPhases: true,
          },
        },
      },
    });

    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
    }

    // ── Stage 4: Lesson Plan Built ──────────────────
    // Continuous courses don't have fixed lesson plans — the scheduler decides
    // call-by-call. Mark as built automatically for continuous mode.
    const pbConfig = (playbook.config as Record<string, any>) || {};
    // A course is continuous if explicitly set, OR if no session count is declared
    // (default = open-ended/continuous). Only structured courses with a fixed
    // session count need a lesson plan.
    const hasFixedSessionCount = typeof pbConfig.sessionCount === "number" && pbConfig.sessionCount > 0;
    const isContinuous = pbConfig.lessonPlanMode === "continuous"
      || pbConfig.lessonPlanModel === "continuous"
      || pbConfig.learningStructure === "continuous"
      || !hasFixedSessionCount;

    let lessonPlanBuilt = false;
    if (isContinuous) {
      // Continuous courses normally have no fixed lesson plan — but if the
      // author opted in to authored modules (Issue #236), the catalogue
      // becomes the structure, and we require it to exist with no blocking
      // errors before we mark "Lesson Plan Built". Authors who haven't
      // imported their catalogue yet will see this stage stay open.
      const modules = Array.isArray(pbConfig.modules) ? pbConfig.modules : [];
      const warnings = Array.isArray(pbConfig.validationWarnings)
        ? pbConfig.validationWarnings
        : [];
      const hasBlockingErrors = warnings.some(
        (w: { severity?: string }) => w?.severity === "error",
      );
      if (pbConfig.modulesAuthored === true) {
        lessonPlanBuilt = modules.length > 0 && !hasBlockingErrors;
      } else {
        lessonPlanBuilt = true;
      }
    } else {
      // Structured courses: check for lesson plan entries in curriculum
      const subjectIds = await prisma.playbookSubject.findMany({
        where: { playbookId: courseId },
        select: { subjectId: true },
      });
      if (subjectIds.length > 0) {
        const curriculum = await prisma.curriculum.findFirst({
          where: {
            subjectId: { in: subjectIds.map((s) => s.subjectId) },
          },
          select: { deliveryConfig: true },
        });
        const dc = curriculum?.deliveryConfig as Record<string, any> | null;
        const lessonPlan = dc?.lessonPlan;
        const entries = Array.isArray(lessonPlan)
          ? lessonPlan
          : Array.isArray(lessonPlan?.entries)
            ? lessonPlan.entries
            : [];
        lessonPlanBuilt = entries.length > 0;
      }
    }

    // ── Stage 5: Tutor Configured ───────────────────
    const hasIdentity = !!playbook.domain.onboardingIdentitySpecId;
    const hasPhases = !!playbook.domain.onboardingFlowPhases;
    const onboardingConfigured = hasIdentity && hasPhases;

    // ── Stage 6: Prompt Composable ──────────────────
    // Check if any caller for this domain has a composed prompt
    const composedPrompt = await prisma.composedPrompt.findFirst({
      where: {
        caller: {
          domainId: playbook.domainId,
        },
      },
      select: { id: true },
    });
    const promptComposable = !!composedPrompt;

    // All critical = lesson plan + onboarding configured
    // Prompt composition happens on first call — not an educator-facing readiness gate
    const allCriticalPass = lessonPlanBuilt && onboardingConfigured;

    return NextResponse.json({
      ok: true,
      lessonPlanBuilt,
      onboardingConfigured,
      promptComposable,
      allCriticalPass,
    });
  } catch (err) {
    console.error("[setup-status] Error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to check setup status" },
      { status: 500 },
    );
  }
}

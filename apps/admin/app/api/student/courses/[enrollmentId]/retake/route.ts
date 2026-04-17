/**
 * @api POST /api/student/courses/:enrollmentId/retake
 * @visibility public
 * @scope student:write
 * @auth STUDENT | OPERATOR+ (with callerId param)
 * @tags student, courses
 * @description Soft-restart a completed course. Resets goals, curriculum progress, surveys, and onboarding
 *   for this playbook only — preserves call history, personality, memories, and other playbook data.
 * @param enrollmentId string - CallerPlaybook ID to retake
 * @body skipOnboarding boolean - Skip onboarding on retake, go straight to content (optional, default false)
 * @response 200 { ok: true, enrollment: { id, status, isDefault } }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Enrollment not found" }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { autoComposeForCaller } from "@/lib/enrollment/auto-compose";
// initializeLessonPlanSession removed — scheduler replaces session tracking
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ enrollmentId: string }> },
) {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const { callerId } = auth;
  const { enrollmentId } = await params;

  let skipOnboarding = false;
  try {
    const body = await request.json();
    skipOnboarding = body?.skipOnboarding === true;
  } catch {
    // No body is fine — defaults to false
  }

  // Verify ownership and fetch playbook + domain context
  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { id: enrollmentId, callerId },
    include: {
      playbook: {
        select: {
          id: true,
          curricula: {
            orderBy: { updatedAt: "desc" as const },
            take: 1,
            select: { slug: true },
          },
        },
      },
    },
  });

  if (!enrollment) {
    return NextResponse.json(
      { ok: false, error: "Enrollment not found" },
      { status: 404 },
    );
  }

  if (enrollment.status !== "COMPLETED") {
    return NextResponse.json(
      { ok: false, error: `Can only retake completed courses. Current status: ${enrollment.status}` },
      { status: 400 },
    );
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });
  const domainId = caller?.domainId;

  // 1. Reactivate enrollment and set as default
  await prisma.$transaction([
    prisma.callerPlaybook.updateMany({
      where: { callerId, isDefault: true, id: { not: enrollmentId } },
      data: { isDefault: false },
    }),
    prisma.callerPlaybook.update({
      where: { id: enrollmentId },
      data: {
        status: "ACTIVE",
        isDefault: true,
        completedAt: null,
      },
    }),
  ]);

  // 2. Reset goals for this playbook
  await prisma.goal.updateMany({
    where: { callerId, playbookId: enrollment.playbookId },
    data: {
      status: "ACTIVE",
      progress: 0,
      progressMetrics: undefined,
      completedAt: null,
      startedAt: new Date(),
    },
  });

  // 3. Reset curriculum progress CallerAttributes for this playbook's spec slug
  const specSlug = enrollment.playbook.curricula[0]?.slug;
  if (specSlug) {
    await prisma.callerAttribute.deleteMany({
      where: {
        callerId,
        key: { startsWith: `curriculum:${specSlug}:` },
      },
    });
  }

  // 4. Reset onboarding session
  // skipOnboarding=true (from body OR original wasSkipped) → mark complete + skip surveys
  // skipOnboarding=false + original wasSkipped=false → reset for full re-onboarding
  if (domainId) {
    const existing = await prisma.onboardingSession.findUnique({
      where: { callerId_domainId: { callerId, domainId } },
      select: { wasSkipped: true },
    });

    const shouldSkip = skipOnboarding || existing?.wasSkipped;

    if (existing) {
      if (shouldSkip) {
        await prisma.onboardingSession.update({
          where: { callerId_domainId: { callerId, domainId } },
          data: {
            isComplete: true,
            wasSkipped: true,
            completedAt: new Date(),
            currentPhase: null,
            completedPhases: [],
            discoveredGoals: 0,
            successMetricsMet: undefined,
            firstCallId: null,
          },
        });
      } else {
        await prisma.onboardingSession.update({
          where: { callerId_domainId: { callerId, domainId } },
          data: {
            isComplete: false,
            completedAt: null,
            currentPhase: null,
            completedPhases: [],
            discoveredGoals: 0,
            successMetricsMet: undefined,
            firstCallId: null,
          },
        });
      }
    }

    // 5. Reset or skip surveys
    if (shouldSkip) {
      // Mark surveys as submitted so student skips them
      const { PRE_SURVEY_KEYS, POST_SURVEY_KEYS } = await import("@/lib/learner/survey-keys");
      const now = new Date().toISOString();
      for (const scope of [SURVEY_SCOPES.PRE, SURVEY_SCOPES.POST]) {
        const key = scope === SURVEY_SCOPES.PRE ? PRE_SURVEY_KEYS.SUBMITTED_AT : POST_SURVEY_KEYS.SUBMITTED_AT;
        await prisma.callerAttribute.upsert({
          where: { callerId_key_scope: { callerId, key, scope } },
          create: { callerId, key, scope, valueType: "STRING", stringValue: now },
          update: { stringValue: now },
        });
      }
    } else {
      // Delete survey data so student re-takes them
      await prisma.callerAttribute.deleteMany({
        where: {
          callerId,
          scope: { in: [SURVEY_SCOPES.PRE, SURVEY_SCOPES.POST] },
        },
      });
    }

    // 6. Session initialization removed — scheduler handles pacing
  }

  // 7. Recompose prompt
  autoComposeForCaller(callerId).catch((err) =>
    console.error(`[student/courses/retake] Auto-compose failed for ${callerId}:`, err.message),
  );

  return NextResponse.json({
    ok: true,
    enrollment: {
      id: enrollmentId,
      playbookId: enrollment.playbookId,
      status: "ACTIVE",
      isDefault: true,
    },
  });
}

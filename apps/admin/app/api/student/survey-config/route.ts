/**
 * @api GET /api/student/survey-config
 * @auth STUDENT | OPERATOR+ (with callerId param)
 * @tags student, survey
 * @desc Returns onboarding + offboarding survey config for the student's enrolled course.
 *       Resolves the student's active CallerPlaybook → Playbook.config → survey steps.
 *       Falls back to defaults from lib/learner/survey-config.
 * @response 200 { ok, subject, onboarding: { surveySteps }, offboarding: { triggerAfterCalls, surveySteps } }
 * @response 404 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import type {
  PlaybookConfig,
  OnboardingPhase,
  OffboardingConfig,
} from "@/lib/types/json-fields";
import {
  DEFAULT_ONBOARDING_SURVEY,
  DEFAULT_OFFBOARDING_SURVEY,
  DEFAULT_OFFBOARDING_TRIGGER,
} from "@/lib/learner/survey-config";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireStudentOrAdmin(request);
    if (isStudentAuthError(auth)) return auth.error;

    // Find the student's active enrollment
    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId: auth.callerId, status: "ACTIVE" },
      select: {
        playbook: {
          select: {
            config: true,
            name: true,
            domain: { select: { name: true } },
          },
        },
      },
    });

    if (!enrollment) {
      return NextResponse.json(
        { ok: false, error: "No active enrollment found" },
        { status: 404 },
      );
    }

    const pbConfig = (enrollment.playbook.config ?? {}) as PlaybookConfig;
    const subject = enrollment.playbook.domain?.name ?? enrollment.playbook.name;

    // Onboarding: find a phase with surveySteps
    const phases = pbConfig.onboardingFlowPhases?.phases ?? [];
    const surveyPhase = phases.find(
      (p: OnboardingPhase) => p.surveySteps && p.surveySteps.length > 0,
    );
    const onboardingSurveySteps =
      surveyPhase?.surveySteps ?? DEFAULT_ONBOARDING_SURVEY;

    // Offboarding
    const offboardingCfg = pbConfig.offboarding as OffboardingConfig | undefined;
    const offboardingSurveySteps =
      offboardingCfg?.phases?.[0]?.surveySteps ?? DEFAULT_OFFBOARDING_SURVEY;
    const triggerAfterCalls =
      offboardingCfg?.triggerAfterCalls ?? DEFAULT_OFFBOARDING_TRIGGER;

    return NextResponse.json({
      ok: true,
      subject,
      onboarding: { surveySteps: onboardingSurveySteps },
      offboarding: { triggerAfterCalls, surveySteps: offboardingSurveySteps },
    });
  } catch (err) {
    console.error("[student/survey-config GET]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

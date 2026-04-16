/**
 * @api GET /api/student/survey-config
 * @auth STUDENT | OPERATOR+ (with callerId param)
 * @tags student, survey
 * @desc Returns survey + assessment config for the student's enrolled course.
 *       Resolution chain per survey type:
 *         1. playbook.config.surveys.{pre,post}.questions  (educator overrides)
 *         2. playbook.config.onboardingFlowPhases (legacy fallback for pre)
 *         3. SURVEY_TEMPLATES_V1 contract defaults
 *       Also returns assessment config (personality questions, pre/post-test settings).
 * @response 200 { ok, subject, assessment, onboarding, offboarding }
 * @response 404 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import type {
  PlaybookConfig,
  OnboardingPhase,
  OffboardingConfig,
  SurveyStepConfig,
} from "@/lib/types/json-fields";
import {
  DEFAULT_ONBOARDING_SURVEY,
  DEFAULT_OFFBOARDING_SURVEY,
  DEFAULT_OFFBOARDING_TRIGGER,
  getSurveyTemplateConfig,
} from "@/lib/learner/survey-config";
import { DEFAULT_PERSONALITY_QUESTIONS } from "@/lib/assessment/personality-defaults";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireStudentOrAdmin(request);
    if (isStudentAuthError(auth)) return auth.error;

    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId: auth.callerId, status: "ACTIVE" },
      select: {
        playbook: {
          select: {
            config: true,
            name: true,
            domain: { select: { name: true } },
            subjects: {
              select: { subject: { select: { teachingProfile: true } } },
              take: 1,
            },
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
    const templates = await getSurveyTemplateConfig();

    // ── Resolution chain: pre-survey questions ──
    // 1. config.surveys.pre.questions (educator override)
    // 2. onboardingFlowPhases.phases[].surveySteps (legacy)
    // 3. contract/fallback defaults
    const legacyPhases = pbConfig.onboardingFlowPhases?.phases ?? [];
    const legacySurveyPhase = legacyPhases.find(
      (p: OnboardingPhase) => p.surveySteps && p.surveySteps.length > 0,
    );
    const onboardingSurveySteps: SurveyStepConfig[] =
      pbConfig.surveys?.pre?.questions?.length
        ? pbConfig.surveys.pre.questions
        : legacySurveyPhase?.surveySteps?.length
          ? legacySurveyPhase.surveySteps
          : templates.templates.pre_survey.questions ?? DEFAULT_ONBOARDING_SURVEY;

    // ── Resolution chain: post-survey questions ──
    const offboardingCfg = pbConfig.offboarding as OffboardingConfig | undefined;
    const postSurveySteps: SurveyStepConfig[] =
      pbConfig.surveys?.post?.questions?.length
        ? pbConfig.surveys.post.questions
        : offboardingCfg?.phases?.[0]?.surveySteps?.length
          ? offboardingCfg.phases[0].surveySteps
          : templates.templates.post_survey.questions ?? DEFAULT_OFFBOARDING_SURVEY;

    const triggerAfterCalls =
      offboardingCfg?.triggerAfterCalls ?? DEFAULT_OFFBOARDING_TRIGGER;

    // ── Assessment config (personality + pre/mid/post-test) ──
    const teachingProfile = enrollment.playbook.subjects?.[0]?.subject?.teachingProfile;
    const isComprehension = teachingProfile === "comprehension-led";

    const personalityQuestions: SurveyStepConfig[] =
      pbConfig.assessment?.personality?.questions?.length
        ? pbConfig.assessment.personality.questions
        : DEFAULT_PERSONALITY_QUESTIONS;

    // Profile-aware defaults: comprehension courses skip pre-test (continuous retrieval handles it)
    const preTestDefault = !isComprehension;

    return NextResponse.json({
      ok: true,
      subject,
      tone: pbConfig.interactionPattern ?? "default",
      assessment: {
        personality: {
          enabled: pbConfig.assessment?.personality?.enabled ?? true,
          questions: personalityQuestions,
        },
        preTest: {
          enabled: pbConfig.assessment?.preTest?.enabled ?? preTestDefault,
          questionCount: pbConfig.assessment?.preTest?.questionCount ?? 5,
        },
        postTest: {
          enabled: pbConfig.assessment?.postTest?.enabled ?? true,
        },
      },
      onboarding: {
        surveySteps: onboardingSurveySteps,
        endAction: templates.templates.pre_survey.endAction,
      },
      offboarding: {
        triggerAfterCalls,
        surveySteps: postSurveySteps,
        endAction: templates.templates.post_survey.endAction,
      },
    });
  } catch (err) {
    console.error("[student/survey-config GET]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

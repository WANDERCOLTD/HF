import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import type {
  PlaybookConfig,
  OnboardingPhase,
  SurveyStepConfig,
  OffboardingConfig,
} from "@/lib/types/json-fields";
import {
  DEFAULT_ONBOARDING_SURVEY,
  DEFAULT_OFFBOARDING_SURVEY,
  DEFAULT_OFFBOARDING_TRIGGER,
} from "@/lib/learner/survey-config";

/**
 * @api GET /api/courses/:courseId/survey-config
 * @visibility internal
 * @scope survey:read
 * @auth session
 * @tags courses, survey
 * @description Load survey config for a course — onboarding + offboarding steps, with defaults.
 * @response 200 { ok: true, onboarding: {...}, offboarding: {...}, subject: string }
 * @response 401 Unauthorized
 * @response 404 { ok: false, error: "Course not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        config: true,
        name: true,
        domain: { select: { name: true } },
      },
    });

    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
    }

    const pbConfig = (playbook.config ?? {}) as PlaybookConfig;
    const subject = playbook.domain?.name ?? playbook.name;

    // Onboarding: find a phase with surveySteps
    const phases = pbConfig.onboardingFlowPhases?.phases ?? [];
    const surveyPhase = phases.find((p: OnboardingPhase) => p.surveySteps && p.surveySteps.length > 0);
    const onboardingSurveySteps = surveyPhase?.surveySteps ?? DEFAULT_ONBOARDING_SURVEY;

    // Offboarding
    const offboardingCfg = pbConfig.offboarding as OffboardingConfig | undefined;
    const offboardingSurveySteps =
      offboardingCfg?.phases?.[0]?.surveySteps ?? DEFAULT_OFFBOARDING_SURVEY;
    const triggerAfterCalls = offboardingCfg?.triggerAfterCalls ?? DEFAULT_OFFBOARDING_TRIGGER;

    return NextResponse.json({
      ok: true,
      onboarding: { surveySteps: onboardingSurveySteps },
      offboarding: { triggerAfterCalls, surveySteps: offboardingSurveySteps },
      subject,
    });
  } catch (err) {
    console.error("[survey-config GET]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * @api PATCH /api/courses/:courseId/survey-config
 * @visibility internal
 * @scope survey:write
 * @auth session
 * @tags courses, survey
 * @description Update survey config for a course — onboarding and/or offboarding steps.
 * @body { onboardingSurveySteps?: SurveyStepConfig[], offboardingSurveySteps?: SurveyStepConfig[], triggerAfterCalls?: number }
 * @response 200 { ok: true }
 * @response 401 Unauthorized
 * @response 404 { ok: false, error: "Course not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;
    const body = (await req.json()) as {
      onboardingSurveySteps?: SurveyStepConfig[];
      offboardingSurveySteps?: SurveyStepConfig[];
      triggerAfterCalls?: number;
    };

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { config: true },
    });

    if (!playbook) {
      return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
    }

    const pbConfig = (playbook.config ?? {}) as PlaybookConfig;

    // ---- Onboarding survey steps ----
    if (body.onboardingSurveySteps) {
      const phases: OnboardingPhase[] = pbConfig.onboardingFlowPhases?.phases ?? [];
      const surveyIdx = phases.findIndex(
        (p) => p.surveySteps && p.surveySteps.length > 0,
      );

      if (surveyIdx >= 0) {
        // Update existing survey phase
        phases[surveyIdx] = { ...phases[surveyIdx], surveySteps: body.onboardingSurveySteps };
      } else {
        // Insert a survey phase after "welcome" (or at position 1)
        const welcomeIdx = phases.findIndex((p) => p.phase.toLowerCase() === "welcome");
        const insertAt = welcomeIdx >= 0 ? welcomeIdx + 1 : Math.min(1, phases.length);
        phases.splice(insertAt, 0, {
          phase: "survey",
          duration: "2min",
          goals: ["Capture learner baseline"],
          surveySteps: body.onboardingSurveySteps,
        });
      }

      pbConfig.onboardingFlowPhases = {
        ...pbConfig.onboardingFlowPhases,
        phases,
      };
    }

    // ---- Offboarding survey / trigger ----
    if (body.offboardingSurveySteps !== undefined || body.triggerAfterCalls !== undefined) {
      const existing = (pbConfig.offboarding ?? {}) as Partial<OffboardingConfig>;
      const existingPhases = existing.phases ?? [];

      if (body.offboardingSurveySteps) {
        if (existingPhases.length > 0) {
          existingPhases[0] = { ...existingPhases[0], surveySteps: body.offboardingSurveySteps };
        } else {
          existingPhases.push({
            phase: "survey",
            duration: "3min",
            goals: ["Gather feedback"],
            surveySteps: body.offboardingSurveySteps,
          });
        }
      }

      pbConfig.offboarding = {
        triggerAfterCalls: body.triggerAfterCalls ?? existing.triggerAfterCalls ?? DEFAULT_OFFBOARDING_TRIGGER,
        phases: existingPhases,
      } satisfies OffboardingConfig;
    }

    await prisma.playbook.update({
      where: { id: courseId },
      data: { config: pbConfig as Record<string, unknown> },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[survey-config PATCH]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

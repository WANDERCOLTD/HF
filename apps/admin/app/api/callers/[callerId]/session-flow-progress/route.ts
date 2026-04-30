/**
 * @api GET /api/callers/[callerId]/session-flow-progress
 * @visibility internal
 * @scope caller:read
 * @auth session (OPERATOR+)
 * @tags caller, session-flow
 * @description Returns the resolved Session Flow for the caller's active
 *   enrolment, plus per-stop progress state (which stops the learner has
 *   reached, completed, or skipped). Used by the Caller page Session Flow
 *   panel (#224) to overlay learner state on the same timeline shown on
 *   the Course page (#223).
 * @response 200 { ok, sessionFlow: SessionFlowResolved, mode, progress }
 * @response 404 { ok: false, error: "Caller has no active enrolment" }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";
import type {
  PlaybookConfig,
  OnboardingFlowPhases,
  SessionFlowResolved,
} from "@/lib/types/json-fields";

export interface CallerSessionFlowProgress {
  /** Course-level state */
  callCount: number;
  masteryPct: number;
  totalTps: number;
  mastered: number;
  onboardingComplete: boolean;
  /** Per-stop state — keyed by stop id */
  stops: {
    /** Pre-test (id="pre-test") submitted? */
    preTestCompleted: boolean;
    /** Welcome / pre-survey scope completed (any welcome flow data captured) */
    welcomeCompleted: boolean;
    /** Post-survey (NPS / post-test) submitted? */
    postSurveyCompleted: boolean;
  };
  /** Captured values per stop — short summaries to show in detail rows */
  capturedValues: {
    goalText?: string | null;
    confidence?: string | null;
    priorKnowledge?: string | null;
    npsScore?: number | null;
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { callerId } = await params;

    const enrollment = await prisma.callerPlaybook.findFirst({
      where: { callerId, status: "ACTIVE" },
      select: {
        playbook: {
          select: {
            id: true,
            name: true,
            config: true,
            domain: {
              select: {
                slug: true,
                onboardingWelcome: true,
                onboardingFlowPhases: true,
              },
            },
            curricula: {
              where: { deliveryConfig: { not: undefined } },
              select: { id: true, slug: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!enrollment) {
      return NextResponse.json(
        { ok: false, error: "Caller has no active enrolment" },
        { status: 404 },
      );
    }

    const playbook = enrollment.playbook;
    const pbConfig = (playbook.config ?? {}) as PlaybookConfig;
    const curriculum = playbook.curricula?.[0];

    const onboardingSpec = await prisma.analysisSpec.findUnique({
      where: { slug: config.specs.onboarding },
      select: { config: true },
    });

    const sessionFlow: SessionFlowResolved = resolveSessionFlow({
      playbook: { name: playbook.name, config: pbConfig },
      domain: playbook.domain,
      onboardingSpec: (onboardingSpec ?? null) as { config: { firstCallFlow?: OnboardingFlowPhases } } | null,
    });

    // ── Aggregate progress in parallel ──
    const [onboardingSession, callCount, surveyAttrs] = await Promise.all([
      prisma.onboardingSession.findFirst({
        where: { callerId },
        select: { isComplete: true, wasSkipped: true },
      }),
      prisma.call.count({ where: { callerId, endedAt: { not: null } } }),
      prisma.callerAttribute.findMany({
        where: {
          callerId,
          scope: { in: [SURVEY_SCOPES.PRE, SURVEY_SCOPES.POST, SURVEY_SCOPES.PRE_TEST] },
        },
        select: { scope: true, key: true, stringValue: true, numberValue: true },
      }),
    ]);

    let masteryPct = 0;
    let totalTps = 0;
    let mastered = 0;
    if (curriculum?.slug) {
      const summary = await import("@/lib/curriculum/track-progress")
        .then(m => m.getTpProgressSummary(callerId, curriculum.slug));
      totalTps = summary.totalTps;
      mastered = summary.mastered;
      masteryPct = totalTps > 0 ? Math.round((mastered / totalTps) * 100) : 0;
    }

    const submitted = new Set(surveyAttrs.map(a => `${a.scope}:${a.key}`));
    const preTestCompleted = submitted.has(`${SURVEY_SCOPES.PRE_TEST}:submitted_at`);
    const welcomeCompleted = submitted.has(`${SURVEY_SCOPES.PRE}:submitted_at`);
    const postSurveyCompleted = submitted.has(`${SURVEY_SCOPES.POST}:submitted_at`);

    const findValue = (scope: string, key: string): { string?: string | null; number?: number | null } | null => {
      const attr = surveyAttrs.find(a => a.scope === scope && a.key === key);
      return attr ? { string: attr.stringValue, number: attr.numberValue } : null;
    };
    const goalText = findValue(SURVEY_SCOPES.PRE, "goal_text")?.string ?? null;
    const confidence = findValue(SURVEY_SCOPES.PRE, "confidence")?.string ?? null;
    const priorKnowledge = findValue(SURVEY_SCOPES.PRE, "prior_knowledge")?.string ?? null;
    const npsScore = findValue(SURVEY_SCOPES.POST, "nps")?.number ?? null;

    const progress: CallerSessionFlowProgress = {
      callCount,
      masteryPct,
      totalTps,
      mastered,
      onboardingComplete: onboardingSession?.isComplete || onboardingSession?.wasSkipped || false,
      stops: { preTestCompleted, welcomeCompleted, postSurveyCompleted },
      capturedValues: { goalText, confidence, priorKnowledge, npsScore },
    };

    return NextResponse.json({
      ok: true,
      sessionFlow,
      mode: pbConfig.lessonPlanMode ?? "structured",
      teachingMode: pbConfig.teachingMode ?? null,
      sessionCount: pbConfig.sessionCount ?? null,
      courseId: playbook.id,
      courseName: playbook.name,
      progress,
    });
  } catch (err) {
    console.error("[callers/[callerId]/session-flow-progress GET]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

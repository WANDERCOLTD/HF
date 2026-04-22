/**
 * @api GET /api/student/journey-position
 * @visibility internal
 * @scope student:read
 * @auth session (STUDENT | OPERATOR+)
 * @tags student, journey
 * @description Resolves the student's next stop via a 4-state machine (continuous mode):
 *   WELCOME → PRE_SURVEY → LEARNING → NPS/POST_SURVEY → COMPLETE.
 *   Pre-survey fires after first call if educator enabled it. NPS fires at mastery threshold or call count.
 *   Post-test MCQs only included when pre-test was completed (for clean uplift delta).
 * @response 200 { ok, nextStop: { type, session, redirect, includePostTest? }, journey: { totalStops, completedStops, currentPosition, progressPercentage? } | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { DEFAULT_NPS_CONFIG } from "@/lib/types/json-fields";
import type { PlaybookConfig, NpsConfig } from "@/lib/types/json-fields";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireStudentOrAdmin(request);
    if (isStudentAuthError(auth)) return auth.error;

    const { callerId } = auth;

    // Load enrollment + onboarding state in parallel
    const [enrollment, onboardingSession] = await Promise.all([
      prisma.callerPlaybook.findFirst({
        where: { callerId, status: "ACTIVE" },
        select: {
          playbook: {
            select: {
              id: true,
              config: true,
              curricula: {
                where: { deliveryConfig: { not: null } },
                select: { id: true, slug: true, deliveryConfig: true },
                take: 1,
              },
            },
          },
        },
      }),
      prisma.onboardingSession.findFirst({
        where: { callerId },
        select: { isComplete: true, wasSkipped: true },
      }),
    ]);

    if (!enrollment) {
      return NextResponse.json({
        ok: true,
        nextStop: { type: "complete", session: 0, redirect: "/x/student/progress" },
        journey: null,
      });
    }

    const curriculum = enrollment.playbook.curricula?.[0];
    const pbConfig = (enrollment.playbook.config ?? {}) as PlaybookConfig;
    const onboardingComplete = onboardingSession?.isComplete || onboardingSession?.wasSkipped || false;

    // ── Continuous mode: 4-state resolver (WELCOME → LEARNING → NPS → COMPLETE) ──
    // lessonPlanMode lives on Playbook.config (written by wizard), not Curriculum.deliveryConfig
    const lessonPlanMode = pbConfig.lessonPlanMode;
    if (lessonPlanMode === 'continuous' && curriculum?.slug) {
      const nps: NpsConfig = { ...DEFAULT_NPS_CONFIG, ...pbConfig.nps };
      // Wizard writes welcome.knowledgeCheck; seed/legacy writes assessment.preTest
      const preTestEnabled = pbConfig.welcome?.knowledgeCheck?.enabled
        ?? pbConfig.assessment?.preTest?.enabled
        ?? false;

      // Load progress + survey state + call count in parallel
      const [summary, surveyAttrs, callCount] = await Promise.all([
        import("@/lib/curriculum/track-progress").then(m => m.getTpProgressSummary(callerId, curriculum!.slug!)),
        prisma.callerAttribute.findMany({
          where: {
            callerId,
            scope: { in: [SURVEY_SCOPES.PRE, SURVEY_SCOPES.POST, SURVEY_SCOPES.PRE_TEST] },
            key: { in: ["submitted_at", "skipped"] },
          },
          select: { scope: true, key: true },
        }),
        prisma.call.count({ where: { callerId, endedAt: { not: null } } }),
      ]);

      const submitted = new Set(surveyAttrs.map(a => `${a.scope}:${a.key}`));
      const preTestCompleted = submitted.has(`${SURVEY_SCOPES.PRE_TEST}:submitted_at`);
      const preSurveyDone = submitted.has(`${SURVEY_SCOPES.PRE}:submitted_at`);
      const postSurveyDone = submitted.has(`${SURVEY_SCOPES.POST}:submitted_at`);

      const pct = summary.totalTps > 0
        ? Math.round((summary.mastered / summary.totalTps) * 100)
        : 0;

      const journeyData = {
        totalStops: 1,
        completedStops: pct >= 100 ? 1 : 0,
        currentPosition: 1,
        progressPercentage: pct,
        mastered: summary.mastered,
        inProgress: summary.inProgress,
        notStarted: summary.notStarted,
        totalTps: summary.totalTps,
      };

      // State 1: WELCOME — onboarding not complete
      // (handled by default branch below if not continuous, but continuous also gates)
      if (!onboardingComplete) {
        return NextResponse.json({
          ok: true,
          nextStop: { type: "onboarding", session: 1, redirect: "/x/sim" },
          journey: journeyData,
        });
      }

      // State 2: PRE_SURVEY — pre-test enabled, not submitted, at least 1 completed call
      if (preTestEnabled && !preSurveyDone && callCount >= 1) {
        return NextResponse.json({
          ok: true,
          nextStop: { type: "pre_survey", session: 1, redirect: "/x/student/welcome" },
          journey: journeyData,
        });
      }

      // State 3: NPS — post-survey not submitted, trigger condition met
      const npsFired = nps.enabled && !postSurveyDone && (
        (nps.trigger === "mastery" && pct >= nps.threshold) ||
        (nps.trigger === "session_count" && callCount >= nps.threshold)
      );
      if (npsFired) {
        return NextResponse.json({
          ok: true,
          nextStop: {
            type: "post_survey",
            session: 1,
            redirect: "/x/student/survey/post",
            includePostTest: preTestCompleted,
          },
          journey: journeyData,
        });
      }

      // State 4: COMPLETE or LEARNING
      return NextResponse.json({
        ok: true,
        nextStop: pct >= 100
          ? { type: "complete", session: 1, redirect: "/x/student/progress" }
          : { type: "continuous", session: 1, redirect: "/x/sim" },
        journey: journeyData,
      });
    }

    // ── Default: onboarding gate then teaching ──
    return NextResponse.json({
      ok: true,
      nextStop: onboardingComplete
        ? { type: "teaching", session: 1, redirect: "/x/sim" }
        : { type: "onboarding", session: 1, redirect: "/x/sim" },
      journey: { totalStops: 0, completedStops: onboardingComplete ? 1 : 0, currentPosition: 0 },
    });
  } catch (err) {
    console.error("[student/journey-position GET]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

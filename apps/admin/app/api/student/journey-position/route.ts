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
import type { PlaybookConfig, NpsConfig, JourneyStop } from "@/lib/types/json-fields";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";
import { config } from "@/lib/config";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import { evaluateStops, type JourneyStopState } from "@/lib/session-flow/journey-stop-runner";

/**
 * Translate a fired JourneyStop into the legacy nextStop response shape.
 * Mapping is centralised here so tests + server agree on representation.
 */
function stopToNextStop(
  stop: JourneyStop,
  ctx: { preTestCompleted: boolean },
): { type: string; session: number; redirect: string; includePostTest?: boolean } {
  switch (stop.id) {
    case "pre-test":
      return { type: "pre_survey", session: 1, redirect: "/x/student/welcome" };
    case "nps":
    case "post-test":
      return {
        type: "post_survey",
        session: 1,
        redirect: "/x/student/survey/post",
        includePostTest: ctx.preTestCompleted,
      };
    default:
      // Unknown stop id — fall back to a generic survey route.
      return { type: stop.kind, session: 1, redirect: "/x/student/survey/post" };
  }
}

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

      // States 2 & 3: PRE_SURVEY + NPS — when SESSION_FLOW_RESOLVER_ENABLED,
      // delegate to the JourneyStop runner. Both flag states must produce
      // identical responses for continuous-mode courses (epic #221, #218).
      if (config.features.sessionFlowResolverEnabled) {
        const resolved = resolveSessionFlow({
          playbook: { name: null, config: pbConfig },
        });
        const completedStopIds = new Set<string>();
        if (preSurveyDone) completedStopIds.add("pre-test");
        if (postSurveyDone) {
          completedStopIds.add("nps");
          completedStopIds.add("post-test");
        }
        const state: JourneyStopState = {
          currentSession: callCount + 1,
          masteryPct: pct,
          callCount,
          onboardingComplete,
          completedStopIds,
          courseComplete: pct >= 100,
        };
        const verdict = evaluateStops(state, resolved.stops);
        if (verdict.fire) {
          return NextResponse.json({
            ok: true,
            nextStop: stopToNextStop(verdict.stop, { preTestCompleted }),
            journey: journeyData,
          });
        }
      } else {
        // Legacy path — preserved for byte-equal output when flag is OFF.
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

    // ── Default (structured mode): onboarding gate, then optionally NPS ──
    // Structured-mode courses today never deliver NPS through this route —
    // the legacy path falls straight to teaching. When SESSION_FLOW_RESOLVER_ENABLED,
    // evaluate event-triggered stops (mastery_reached / session_count / course_complete)
    // for structured courses too. This is the structured-mode NPS gap closure
    // that #218 promises. Position-anchored stops (pre/mid/post-test) remain
    // owned by applyAutoIncludeStops in the lesson-plan rail (Track A hybrid).
    if (config.features.sessionFlowResolverEnabled && onboardingComplete && curriculum?.slug) {
      const resolved = resolveSessionFlow({
        playbook: { name: null, config: pbConfig },
      });
      const eventStops = resolved.stops.filter(
        s => s.trigger.type === "mastery_reached"
          || s.trigger.type === "session_count"
          || s.trigger.type === "course_complete",
      );
      if (eventStops.length > 0) {
        const [summary, surveyAttrs, callCount] = await Promise.all([
          import("@/lib/curriculum/track-progress").then(m => m.getTpProgressSummary(callerId, curriculum!.slug!)),
          prisma.callerAttribute.findMany({
            where: {
              callerId,
              scope: { in: [SURVEY_SCOPES.POST] },
              key: "submitted_at",
            },
            select: { scope: true },
          }),
          prisma.call.count({ where: { callerId, endedAt: { not: null } } }),
        ]);
        const pct = summary.totalTps > 0
          ? Math.round((summary.mastered / summary.totalTps) * 100)
          : 0;
        const completedStopIds = new Set<string>();
        if (surveyAttrs.length > 0) {
          completedStopIds.add("nps");
          completedStopIds.add("post-test");
        }
        const verdict = evaluateStops(
          {
            currentSession: callCount + 1,
            masteryPct: pct,
            callCount,
            onboardingComplete,
            completedStopIds,
            courseComplete: pct >= 100,
          },
          eventStops,
        );
        if (verdict.fire) {
          return NextResponse.json({
            ok: true,
            nextStop: stopToNextStop(verdict.stop, { preTestCompleted: false }),
            journey: { totalStops: 1, completedStops: 0, currentPosition: 1, progressPercentage: pct },
          });
        }
      }
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

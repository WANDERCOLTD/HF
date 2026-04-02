/**
 * @api GET /api/student/journey-position
 * @visibility internal
 * @scope student:read
 * @auth session (STUDENT | OPERATOR+)
 * @tags student, journey
 * @description Resolves the student's next stop on the course journey rail.
 *   Walks the lesson plan entries checking survey completion, onboarding status,
 *   and current_session to determine where the student should go next.
 * @response 200 { ok, nextStop: { type, session, redirect }, journey: { totalStops, completedStops, currentPosition } }
 * @response 404 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";
import { isFormStop } from "@/lib/lesson-plan/session-ui";
import type { SessionEntry } from "@/lib/lesson-plan/types";

// Map session types to student-facing redirect URLs
function redirectForStop(type: string): string {
  switch (type) {
    case "pre_survey":
      return "/x/student/welcome";
    case "mid_survey":
      return "/x/student/survey/mid";
    case "post_survey":
      return "/x/student/survey/post";
    default:
      return "/x/sim";
  }
}

// Map survey stop types to CallerAttribute scopes that must be completed.
// pre_survey and post_survey now have multi-phase flows:
//   pre_survey  → PERSONALITY + PRE_TEST (or legacy PRE_SURVEY)
//   post_survey → POST_TEST + POST_SURVEY (or legacy POST_SURVEY)
function surveyScopesForStop(type: string): string[] {
  switch (type) {
    case "pre_survey":
      return [SURVEY_SCOPES.PERSONALITY, SURVEY_SCOPES.PRE_TEST, SURVEY_SCOPES.PRE];
    case "mid_survey":
      return [SURVEY_SCOPES.MID];
    case "post_survey":
      return [SURVEY_SCOPES.POST_TEST, SURVEY_SCOPES.POST];
    default:
      return [];
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireStudentOrAdmin(request);
    if (isStudentAuthError(auth)) return auth.error;

    const { callerId } = auth;

    // Load enrollment + lesson plan + caller state in parallel
    const [enrollment, onboardingSession, callerAttrs] = await Promise.all([
      prisma.callerPlaybook.findFirst({
        where: { callerId, status: "ACTIVE" },
        select: {
          playbook: {
            select: {
              id: true,
              config: true,
              subjects: {
                select: {
                  subject: {
                    select: {
                      curricula: {
                        where: { deliveryConfig: { not: null } },
                        select: { id: true, slug: true, deliveryConfig: true },
                        take: 1,
                      },
                    },
                  },
                },
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
      prisma.callerAttribute.findMany({
        where: { callerId },
        select: { key: true, scope: true, stringValue: true, numberValue: true, booleanValue: true },
      }),
    ]);

    if (!enrollment) {
      return NextResponse.json(
        { ok: false, error: "No active enrollment", nextStop: { type: "complete", session: 0, redirect: "/x/student/progress" } },
        { status: 404 },
      );
    }

    // Extract lesson plan entries
    const curriculum = enrollment.playbook.subjects?.[0]?.subject?.curricula?.[0];
    const deliveryConfig = curriculum?.deliveryConfig as Record<string, unknown> | null;
    const lessonPlan = deliveryConfig?.lessonPlan as { entries: SessionEntry[] } | undefined;
    const entries = lessonPlan?.entries ?? [];

    // If no lesson plan, go straight to sim
    if (entries.length === 0) {
      return NextResponse.json({
        ok: true,
        nextStop: { type: "onboarding", session: 1, redirect: "/x/sim" },
        journey: { totalStops: 0, completedStops: 0, currentPosition: 0 },
      });
    }

    // Build lookup maps from CallerAttributes
    const surveySubmitted = new Set<string>();
    let currentSession: number | null = null;
    const skippedSessions = new Set<number>();
    let preTestSkipped = false;

    for (const attr of callerAttrs) {
      // Survey completion check
      if (attr.key === "submitted_at" && attr.stringValue) {
        surveySubmitted.add(attr.scope);
      }
      // Pre-test skip marker (no questions available)
      if (attr.key === "skipped" && attr.scope === "PRE_TEST" && attr.stringValue) {
        preTestSkipped = true;
      }
      // Current session
      if (attr.key.endsWith(":current_session") && attr.scope === "CURRICULUM") {
        currentSession = attr.numberValue ?? null;
      }
      // Session skips
      if (attr.key.includes(":session_skipped:") && attr.scope === "CURRICULUM") {
        const sessionNum = parseInt(attr.key.split(":session_skipped:")[1], 10);
        if (!isNaN(sessionNum)) skippedSessions.add(sessionNum);
      }
    }

    const onboardingComplete = onboardingSession?.isComplete || onboardingSession?.wasSkipped || false;

    // Walk the rail to find the first incomplete stop
    let completedStops = 0;
    let nextStop: { type: string; session: number; redirect: string } | null = null;

    for (const entry of entries) {
      const isSkipped = skippedSessions.has(entry.session);

      if (isFormStop(entry.type)) {
        // Survey stop — check if submitted or skipped
        // Multi-phase stops: pre_survey requires PERSONALITY + (PRE_TEST or skipped),
        // post_survey requires (POST_TEST or skipped) + POST_SURVEY.
        // For backward compat, also accept legacy PRE_SURVEY scope.
        const scopes = surveyScopesForStop(entry.type);

        let isSubmitted = false;
        if (entry.type === "pre_survey") {
          // New flow: PERSONALITY done (or legacy PRE_SURVEY done)
          const personalityDone = surveySubmitted.has(SURVEY_SCOPES.PERSONALITY);
          const legacyPreDone = surveySubmitted.has(SURVEY_SCOPES.PRE);
          // PRE_TEST may be skipped (no questions available) — check for skipped marker
          const preTestDone = surveySubmitted.has(SURVEY_SCOPES.PRE_TEST) || preTestSkipped;
          isSubmitted = (personalityDone && preTestDone) || legacyPreDone;
        } else if (entry.type === "post_survey") {
          // POST_TEST may not exist (no pre-test taken) — only require POST_SURVEY
          const postSurveyDone = surveySubmitted.has(SURVEY_SCOPES.POST);
          const postTestDone = surveySubmitted.has(SURVEY_SCOPES.POST_TEST);
          // Post-test is only required if a pre-test was taken
          const preTestWasTaken = surveySubmitted.has(SURVEY_SCOPES.PRE_TEST);
          isSubmitted = postSurveyDone && (!preTestWasTaken || postTestDone);
        } else {
          // mid_survey — simple single scope
          isSubmitted = scopes.some((s) => surveySubmitted.has(s));
        }

        const isDone = isSubmitted || (isSkipped && entry.isOptional !== false);
        if (isDone) {
          completedStops++;
          continue;
        }
        // Not done — this is the next stop
        nextStop = { type: entry.type, session: entry.session, redirect: redirectForStop(entry.type) };
        break;
      }

      if (entry.type === "onboarding") {
        if (onboardingComplete) {
          completedStops++;
          continue;
        }
        nextStop = { type: "onboarding", session: entry.session, redirect: "/x/sim" };
        break;
      }

      if (entry.type === "offboarding") {
        // Offboarding is the last voice call — check if current_session has passed it
        if (currentSession !== null && currentSession > entry.session) {
          completedStops++;
          continue;
        }
        nextStop = { type: "offboarding", session: entry.session, redirect: "/x/sim" };
        break;
      }

      // Teaching session — check current_session
      if (isSkipped) {
        completedStops++;
        continue;
      }
      if (currentSession !== null && currentSession > entry.session) {
        completedStops++;
        continue;
      }
      // This is the current or next teaching session
      nextStop = { type: entry.type, session: entry.session, redirect: "/x/sim" };
      break;
    }

    // All stops done
    if (!nextStop) {
      nextStop = { type: "complete", session: entries.length + 1, redirect: "/x/student/progress" };
    }

    return NextResponse.json({
      ok: true,
      nextStop,
      journey: {
        totalStops: entries.length,
        completedStops,
        currentPosition: nextStop.session,
      },
    });
  } catch (err) {
    console.error("[student/journey-position GET]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

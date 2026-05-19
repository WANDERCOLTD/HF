/**
 * @api GET /api/student/progress
 * @auth STUDENT | OPERATOR+ (with callerId param)
 * @desc Returns the student's learning profile: personality, goals, call count, classroom info,
 *   survey answers, test scores, and journey position.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";
import { SURVEY_SCOPES } from "@/lib/learner/survey-keys";

const SURVEY_ATTR_SCOPES = [
  SURVEY_SCOPES.PERSONALITY, SURVEY_SCOPES.PRE, SURVEY_SCOPES.POST,
  SURVEY_SCOPES.PRE_TEST, SURVEY_SCOPES.POST_TEST,
];

export async function GET(request: NextRequest) {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const { callerId } = auth;

  // #493 Slice 5.1 — load per-module progress for the SimProgressPanel "Modules"
  // section. CallerModuleProgress already tracks callCount + mastery + status;
  // we surface those for the panel to render coloured chips per module.
  // Module status is mapped at this boundary: DB "COMPLETED" → presentational
  // "MASTERED" (E5 vocabulary); other statuses pass through verbatim.
  const [profile, goals, callCount, caller, memorySummary, keyFactCount, surveyAttrs, moduleProgress] = await Promise.all([
    prisma.callerPersonalityProfile.findUnique({
      where: { callerId },
      select: { parameterValues: true, lastUpdatedAt: true, callsUsed: true },
    }),
    prisma.goal.findMany({
      where: { callerId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        type: true,
        progress: true,
        description: true,
      },
      orderBy: { priority: "desc" },
    }),
    prisma.call.count({ where: { callerId } }),
    prisma.caller.findUnique({
      where: { id: callerId },
      select: {
        name: true,
        cohortGroup: {
          select: {
            name: true,
            domain: { select: { name: true } },
            owner: { select: { name: true } },
            institution: {
              select: {
                name: true,
                logoUrl: true,
                welcomeMessage: true,
              },
            },
          },
        },
        cohortMemberships: {
          select: {
            cohortGroup: {
              select: {
                id: true,
                name: true,
                domain: { select: { name: true } },
                owner: { select: { name: true } },
                institution: {
                  select: {
                    name: true,
                    logoUrl: true,
                    welcomeMessage: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.callerMemorySummary.findUnique({
      where: { callerId },
      select: { topTopics: true, topicCount: true },
    }),
    prisma.conversationArtifact.count({
      where: { callerId, type: "KEY_FACT" },
    }),
    prisma.callerAttribute.findMany({
      where: { callerId, scope: { in: SURVEY_ATTR_SCOPES } },
      select: { key: true, scope: true, valueType: true, stringValue: true, numberValue: true, booleanValue: true },
    }),
    prisma.callerModuleProgress.findMany({
      where: { callerId },
      select: {
        moduleId: true,
        status: true,
        mastery: true,
        callCount: true,
        completedAt: true,
        module: { select: { id: true, slug: true, title: true, sortOrder: true, masteryThreshold: true } },
      },
      orderBy: { module: { sortOrder: "asc" } },
    }),
  ]);

  // ── Build survey buckets ──
  const surveys: Record<string, Record<string, string | number | boolean | null>> = {};
  for (const scope of SURVEY_ATTR_SCOPES) surveys[scope] = {};

  for (const attr of surveyAttrs) {
    const value = attr.valueType === "NUMBER" ? attr.numberValue
      : attr.valueType === "BOOLEAN" ? attr.booleanValue
      : attr.stringValue;
    surveys[attr.scope][attr.key] = value ?? null;
  }

  // ── Compute test score summary ──
  const preTestScore = surveys[SURVEY_SCOPES.PRE_TEST]?.score != null ? Number(surveys[SURVEY_SCOPES.PRE_TEST].score) : null;
  const postTestScore = surveys[SURVEY_SCOPES.POST_TEST]?.score != null ? Number(surveys[SURVEY_SCOPES.POST_TEST].score) : null;
  const upliftAbsolute = surveys[SURVEY_SCOPES.POST_TEST]?.uplift_absolute != null ? Number(surveys[SURVEY_SCOPES.POST_TEST].uplift_absolute) : null;
  const upliftNormalised = surveys[SURVEY_SCOPES.POST_TEST]?.uplift_normalised != null ? Number(surveys[SURVEY_SCOPES.POST_TEST].uplift_normalised) : null;

  const hasData = (d: Record<string, unknown>) => Object.keys(d).length > 0;

  // #493 Slice 5.1 — shape CallerModuleProgress rows for the panel. DB enum
  // "COMPLETED" maps to presentational "MASTERED" (see #480 tech-lead review).
  // LOCKED is purely presentation (E4 derives it from prereqs); not returned here.
  const moduleStatusMap = (dbStatus: string): "MASTERED" | "IN_PROGRESS" | "NOT_STARTED" => {
    if (dbStatus === "COMPLETED") return "MASTERED";
    if (dbStatus === "IN_PROGRESS") return "IN_PROGRESS";
    return "NOT_STARTED";
  };
  const modules = moduleProgress.map((p) => ({
    id: p.moduleId,
    slug: p.module.slug,
    title: p.module.title,
    status: moduleStatusMap(p.status),
    callCount: p.callCount,
    mastery: p.mastery,
    masteryThreshold: p.module.masteryThreshold ?? 0.7,
    completedAt: p.completedAt,
  }));

  // Prefer join table memberships, fall back to legacy FK
  const primaryCohort = caller?.cohortMemberships?.[0]?.cohortGroup ?? caller?.cohortGroup;

  return NextResponse.json({
    ok: true,
    profile: profile
      ? {
          parameterValues: profile.parameterValues,
          lastUpdated: profile.lastUpdatedAt,
          callsAnalyzed: profile.callsUsed,
        }
      : null,
    goals,
    totalCalls: callCount,
    classroom: primaryCohort?.name ?? null,
    classrooms: (caller?.cohortMemberships ?? []).map(m => ({
      id: m.cohortGroup.id,
      name: m.cohortGroup.name,
      teacher: m.cohortGroup.owner?.name ?? null,
    })),
    domain: primaryCohort?.domain?.name ?? null,
    teacherName: primaryCohort?.owner?.name ?? null,
    institutionName: primaryCohort?.institution?.name ?? null,
    institutionLogo: primaryCohort?.institution?.logoUrl ?? null,
    welcomeMessage: primaryCohort?.institution?.welcomeMessage ?? null,
    topTopics: (memorySummary?.topTopics as Array<{ topic: string; lastMentioned: string }>) ?? [],
    topicCount: memorySummary?.topicCount ?? 0,
    keyFactCount,
    // Survey & assessment data
    surveys: {
      personality: hasData(surveys[SURVEY_SCOPES.PERSONALITY]) ? surveys[SURVEY_SCOPES.PERSONALITY] : null,
      pre: hasData(surveys[SURVEY_SCOPES.PRE]) ? surveys[SURVEY_SCOPES.PRE] : null,
      post: hasData(surveys[SURVEY_SCOPES.POST]) ? surveys[SURVEY_SCOPES.POST] : null,
    },
    testScores: {
      preTest: preTestScore,
      postTest: postTestScore,
      uplift: upliftAbsolute != null ? { absolute: upliftAbsolute, normalised: upliftNormalised } : null,
    },
    // #493 Slice 5.1 — per-module progress for SimProgressPanel Modules section
    modules,
    // #493 Slice 5.3 — populated by E2 once diagnosticFromMock lands. Null until then.
    diagnosticFromMock: null,
    // #493 Slice 5.4 — populated by E2 once isCourseComplete() lands. Null until then.
    courseComplete: null,
  });
}

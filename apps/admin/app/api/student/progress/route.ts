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
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { resolveCurriculumIdForPlaybook } from "@/lib/curriculum/resolve-module";
import { isCourseComplete } from "@/lib/curriculum/is-course-complete";
import { resolveOnboardingWelcomeForCaller } from "@/lib/learner/resolve-onboarding-welcome";
import type { PlaybookConfig } from "@/lib/types/json-fields";

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
  const [profile, goals, callCount, caller, memorySummary, keyFactCount, surveyAttrs, moduleProgress, diagnosticAttr] = await Promise.all([
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
    // #493 Slice 5.3 — latest diagnosticFromMock written by E2 AGGREGATE.
    // Sorted by updatedAt so the most recent Mock's diagnostic wins.
    prisma.callerAttribute.findFirst({
      where: { callerId, scope: "DIAGNOSTIC", key: "fromMock" },
      orderBy: { updatedAt: "desc" },
      select: { stringValue: true, updatedAt: true },
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

  // #493 Slice 5.3 — parse the latest DIAGNOSTIC/fromMock attribute, then
  // resolve its module IDs into `{id, slug, title}` triples so the panel can
  // render titles directly. The writer stores just IDs (see
  // `generateDiagnosticFromMock` in lib/curriculum/diagnostic-from-mock.ts);
  // resolution lives at this API boundary to keep the writer cheap.
  const diagnosticFromMock = await resolveDiagnosticFromMock(diagnosticAttr);

  // #493 Slice 5.4 — compute course-complete verdict using the learner's
  // resolved playbook → curriculum. Works uniformly for authored + AI-generated
  // routes because both write `CurriculumModule` + `CallerModuleProgress` rows.
  const courseComplete = await resolveCourseComplete(callerId);

  // Welcome cascade. Helper at `lib/learner/resolve-onboarding-welcome.ts`
  // is the canonical reader for `Playbook.config.welcomeMessage` (cascade-
  // resolved via Domain.onboardingWelcome) + `Playbook.config.onboardingClosingLine`
  // (course-only) — same reader used by any future surface that wants the
  // FOH onboarding bundle.
  const welcome = await resolveOnboardingWelcomeForCaller(
    callerId,
    primaryCohort?.institution?.welcomeMessage ?? null,
  );

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
    welcomeMessage: welcome.welcomeMessage,
    onboardingClosingLine: welcome.onboardingClosingLine,
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
    // #493 Slice 5.3 — latest diagnostic written by E2 AGGREGATE after a Mock call.
    diagnosticFromMock,
    // #493 Slice 5.4 — current course-complete verdict from isCourseComplete().
    courseComplete,
  });
}

interface ModuleRef {
  id: string;
  slug: string;
  title: string;
}

interface DiagnosticFromMockResponse {
  focusModules: ModuleRef[];
  strengthModule: ModuleRef | null;
  weakSkill: string | null;
  summary: string;
  fromCallId: string;
  generatedAt: string;
}

/**
 * Parse the latest DIAGNOSTIC/fromMock CallerAttribute and resolve its
 * module IDs into `{id, slug, title}` triples. Returns null when:
 *   - no row exists yet (no Mock call has completed); or
 *   - the stored JSON is malformed (logged warn — defensive).
 *
 * Deleted modules are silently dropped from focusModules (UI shouldn't crash);
 * a deleted strengthModule becomes null.
 */
async function resolveDiagnosticFromMock(
  attr: { stringValue: string | null; updatedAt: Date } | null,
): Promise<DiagnosticFromMockResponse | null> {
  if (!attr || !attr.stringValue) return null;

  let parsed: {
    focusModules?: unknown;
    strengthModule?: unknown;
    weakSkill?: unknown;
    summary?: unknown;
    fromCallId?: unknown;
    generatedAt?: unknown;
  };
  try {
    parsed = JSON.parse(attr.stringValue);
  } catch (err) {
    console.warn(
      "[student/progress] Failed to parse DIAGNOSTIC/fromMock stringValue as JSON",
      (err as Error).message,
    );
    return null;
  }

  const focusIds = Array.isArray(parsed.focusModules)
    ? parsed.focusModules.filter((v): v is string => typeof v === "string")
    : [];
  const strengthId =
    typeof parsed.strengthModule === "string" ? parsed.strengthModule : null;
  const allIds = [...focusIds];
  if (strengthId) allIds.push(strengthId);

  // Resolve module IDs → {id, slug, title}. Missing rows (deleted modules)
  // simply don't appear in the map → dropped from focus list.
  const modulesRefs = allIds.length
    ? await prisma.curriculumModule.findMany({
        where: { id: { in: allIds } },
        select: { id: true, slug: true, title: true },
      })
    : [];
  const byId = new Map<string, ModuleRef>(modulesRefs.map((m) => [m.id, m]));

  const focusModules = focusIds
    .map((id) => byId.get(id))
    .filter((m): m is ModuleRef => m !== undefined);
  const strengthModule = strengthId ? byId.get(strengthId) ?? null : null;

  return {
    focusModules,
    strengthModule,
    weakSkill: typeof parsed.weakSkill === "string" ? parsed.weakSkill : null,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    fromCallId:
      typeof parsed.fromCallId === "string" ? parsed.fromCallId : "",
    generatedAt:
      typeof parsed.generatedAt === "string"
        ? parsed.generatedAt
        : attr.updatedAt.toISOString(),
  };
}

interface CourseCompleteResponse {
  complete: boolean;
  mode: "all-modules" | "terminal-only" | "any";
  completedAt: string | null;
}

/**
 * Resolve the caller's playbook → curriculum → completion verdict. Returns null
 * when the caller has no resolved playbook or curriculum yet (new learner who
 * hasn't enrolled, or a course that hasn't been synced to CurriculumModule).
 */
async function resolveCourseComplete(
  callerId: string,
): Promise<CourseCompleteResponse | null> {
  const playbookId = await resolvePlaybookId(callerId);
  if (!playbookId) return null;

  const curriculumId = await resolveCurriculumIdForPlaybook(playbookId);
  if (!curriculumId) return null;

  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  const playbookConfig = (playbook?.config ?? null) as PlaybookConfig | null;

  const verdict = await isCourseComplete(prisma, {
    callerId,
    curriculumId,
    playbookConfig,
  });
  // Drop triggeringModuleIds from the API surface — UI only needs the hero.
  return {
    complete: verdict.complete,
    mode: verdict.mode,
    completedAt: verdict.completedAt,
  };
}

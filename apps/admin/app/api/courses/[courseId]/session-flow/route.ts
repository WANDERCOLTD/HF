/**
 * @api GET /api/courses/[courseId]/session-flow
 * @visibility internal
 * @scope course:read
 * @auth session (OPERATOR+)
 * @tags course, session-flow
 * @description Returns the resolved Session Flow shape for a course — the
 *   single source of truth used by both the Course page Timeline (read view)
 *   and the upcoming Course page editor (#225). Reads via resolveSessionFlow
 *   regardless of feature flag — this endpoint is the *configuration view*,
 *   not the runtime path.
 * @response 200 { ok, sessionFlow: SessionFlowResolved, mode: "continuous"|"structured", teachingMode?: string, sessionCount?: number }
 * @response 404 { ok: false, error: "Course not found" }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import type {
  PlaybookConfig,
  OnboardingFlowPhases,
  SessionFlowConfig,
  SessionFlowResolved,
  NpsConfig,
} from "@/lib/types/json-fields";

interface PutBody {
  sessionFlow?: SessionFlowConfig;
  lessonPlanMode?: "continuous" | "structured";
  /** Top-level welcome message — read by quickstart greeting cascade. */
  welcomeMessage?: string | null;
  /** NPS configuration — kept top-level for back-compat with continuous-mode delivery path. */
  nps?: NpsConfig;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { courseId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        name: true,
        config: true,
        domain: {
          select: {
            id: true,
            name: true,
            slug: true,
            onboardingWelcome: true,
            onboardingFlowPhases: true,
          },
        },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const onboardingSpec = await prisma.analysisSpec.findUnique({
      where: { slug: config.specs.onboarding },
      select: { config: true },
    });

    const pbConfig = (playbook.config ?? {}) as PlaybookConfig;
    const resolved: SessionFlowResolved = resolveSessionFlow({
      playbook: { name: playbook.name, config: pbConfig },
      domain: playbook.domain,
      onboardingSpec: (onboardingSpec ?? null) as { config: { firstCallFlow?: OnboardingFlowPhases } } | null,
    });

    return NextResponse.json({
      ok: true,
      sessionFlow: resolved,
      mode: pbConfig.lessonPlanMode ?? "structured",
      teachingMode: pbConfig.teachingMode ?? null,
      sessionCount: pbConfig.sessionCount ?? null,
      courseName: playbook.name,
      domainId: playbook.domain?.id ?? null,
      domainName: playbook.domain?.name ?? null,
    });
  } catch (err) {
    console.error("[courses/[courseId]/session-flow GET]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * @api PUT /api/courses/[courseId]/session-flow
 * @visibility internal
 * @scope course:write
 * @auth session (OPERATOR+)
 * @description Partial update of Playbook.config — accepts a sessionFlow
 *   shape and/or a lessonPlanMode. Other Playbook.config fields are left
 *   untouched. Used by the Course page Session Flow editor (#225).
 * @request { sessionFlow?: SessionFlowConfig, lessonPlanMode?: "continuous" | "structured" }
 * @response 200 { ok, sessionFlow: SessionFlowResolved, mode, ... }
 * @response 400 { ok: false, error: "Invalid body" }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  try {
    const { courseId } = await params;
    const body = (await req.json()) as PutBody;

    if (
      body.lessonPlanMode !== undefined
      && body.lessonPlanMode !== "continuous"
      && body.lessonPlanMode !== "structured"
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid lessonPlanMode" },
        { status: 400 },
      );
    }

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        config: true,
      },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const existing = (playbook.config ?? {}) as PlaybookConfig;

    // ── Mirror sessionFlow.intake → legacy `welcome` during dual-read window ──
    // The runtime transforms (and journey-position route, when the flag is OFF)
    // read `playbook.config.welcome.*.enabled`. Without this mirror, edits in
    // the Session Flow editor would silently fail when SESSION_FLOW_RESOLVER_ENABLED
    // is false (currently the case in test/prod). Same pattern the wizard
    // already uses for `nps.enabled` → `surveys.post.enabled`. Removed in
    // Phase 5 (#220) once legacy fields are dropped.
    let mirroredWelcome = existing.welcome;
    if (body.sessionFlow?.intake) {
      const i = body.sessionFlow.intake;
      mirroredWelcome = {
        goals: { enabled: i.goals.enabled },
        aboutYou: { enabled: i.aboutYou.enabled },
        knowledgeCheck: { enabled: i.knowledgeCheck.enabled },
        aiIntroCall: { enabled: i.aiIntroCall.enabled },
      };
    }

    // ── Mirror nps.enabled → surveys.post.enabled (existing wizard pattern) ──
    let mirroredSurveys = existing.surveys;
    if (body.nps !== undefined) {
      mirroredSurveys = {
        ...(existing.surveys ?? {}),
        post: { ...(existing.surveys?.post ?? {}), enabled: body.nps.enabled },
      };
    }

    const merged: PlaybookConfig = {
      ...existing,
      ...(body.lessonPlanMode !== undefined ? { lessonPlanMode: body.lessonPlanMode } : {}),
      ...(body.welcomeMessage !== undefined ? { welcomeMessage: body.welcomeMessage ?? undefined } : {}),
      ...(body.nps !== undefined
        ? { nps: body.nps, ...(mirroredSurveys !== existing.surveys ? { surveys: mirroredSurveys } : {}) }
        : {}),
      ...(body.sessionFlow !== undefined
        ? {
            sessionFlow: { ...(existing.sessionFlow ?? {}), ...body.sessionFlow },
            ...(mirroredWelcome !== existing.welcome ? { welcome: mirroredWelcome } : {}),
          }
        : {}),
    };

    await prisma.playbook.update({
      where: { id: courseId },
      data: { config: merged as object },
    });

    // Re-resolve and return so the client can update without a second fetch.
    const updated = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        name: true,
        config: true,
        domain: {
          select: {
            id: true,
            name: true,
            slug: true,
            onboardingWelcome: true,
            onboardingFlowPhases: true,
          },
        },
      },
    });
    const onboardingSpec = await prisma.analysisSpec.findUnique({
      where: { slug: config.specs.onboarding },
      select: { config: true },
    });
    const updatedConfig = (updated?.config ?? {}) as PlaybookConfig;
    const resolved: SessionFlowResolved = resolveSessionFlow({
      playbook: { name: updated?.name ?? null, config: updatedConfig },
      domain: updated?.domain ?? null,
      onboardingSpec: (onboardingSpec ?? null) as { config: { firstCallFlow?: OnboardingFlowPhases } } | null,
    });

    return NextResponse.json({
      ok: true,
      sessionFlow: resolved,
      mode: updatedConfig.lessonPlanMode ?? "structured",
      teachingMode: updatedConfig.teachingMode ?? null,
      sessionCount: updatedConfig.sessionCount ?? null,
      courseName: updated?.name ?? "",
      domainId: updated?.domain?.id ?? null,
      domainName: updated?.domain?.name ?? null,
    });
  } catch (err) {
    console.error("[courses/[courseId]/session-flow PUT]", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

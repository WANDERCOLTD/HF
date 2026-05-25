import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import type { PlaybookConfig, OnboardingFlowPhases, OnboardingPhase } from "@/lib/types/json-fields";
import { getFlowPhasesFallback } from "@/lib/fallback-settings";

/**
 * @api GET /api/courses/:courseId/onboarding
 * @visibility internal
 * @auth session
 * @tags courses, onboarding
 * @description Get resolved onboarding flow for a course (course override > domain > system fallback). Returns phase source ("course" | "domain" | "fallback" | "none") and available domain media for the editor picker.
 * @pathParam courseId string - The playbook ID (course)
 * @response 200 { ok: true, source, phases, domainName, domainId, domainWelcome, personaName, media }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        config: true,
        domain: {
          select: {
            id: true,
            name: true,
            slug: true,
            onboardingFlowPhases: true,
            onboardingWelcome: true,
            onboardingIdentitySpec: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 }
      );
    }

    const pbConfig = (playbook.config || {}) as PlaybookConfig;
    const courseFlow = pbConfig.onboardingFlowPhases as OnboardingFlowPhases | undefined;
    const domainFlow = playbook.domain?.onboardingFlowPhases as OnboardingFlowPhases | null;

    let source: "course" | "domain" | "fallback" | "none" = "none";
    let resolvedPhases: OnboardingPhase[] = [];

    if (courseFlow?.phases?.length) {
      source = "course";
      resolvedPhases = courseFlow.phases;
    } else if (domainFlow?.phases?.length) {
      source = "domain";
      resolvedPhases = domainFlow.phases;
    } else {
      // INIT-001 fallback — system default onboarding phases
      const fallback = await getFlowPhasesFallback();
      if (fallback?.phases?.length) {
        source = "fallback";
        resolvedPhases = fallback.phases as OnboardingPhase[];
      }
    }

    // Load domain media for editor picker (SubjectDomain → Subject → SubjectMedia → MediaAsset)
    let media: Array<{ id: string; title: string | null; fileName: string; mimeType: string }> = [];
    if (playbook.domain) {
      const subjectMedia = await prisma.subjectMedia.findMany({
        where: {
          subject: {
            domains: { some: { domainId: playbook.domain.id } },
          },
        },
        select: {
          media: {
            select: { id: true, title: true, fileName: true, mimeType: true },
          },
        },
        take: 100,
      });
      const seen = new Set<string>();
      for (const sm of subjectMedia) {
        if (!seen.has(sm.media.id)) {
          seen.add(sm.media.id);
          media.push(sm.media);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      source,
      phases: resolvedPhases,
      domainId: playbook.domain?.id || null,
      domainName: playbook.domain?.name || null,
      domainWelcome: playbook.domain?.onboardingWelcome || null,
      personaName: playbook.domain?.onboardingIdentitySpec?.name?.replace(/ Identity$/i, '') || null,
      media,
    });
  } catch (error: unknown) {
    console.error("[course-onboarding-api] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch course onboarding" },
      { status: 500 }
    );
  }
}

/**
 * @api PUT /api/courses/:courseId/onboarding
 * @visibility internal
 * @auth session (OPERATOR+)
 * @tags courses, onboarding
 * @description Set or clear course-level onboarding flow phase override. Pass null to reset to institution default.
 * @pathParam courseId string - The playbook ID (course)
 * @body onboardingFlowPhases object|null - Phase config or null to reset to domain default
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId } = await params;
    const body = await req.json();
    const { onboardingFlowPhases } = body as { onboardingFlowPhases: OnboardingFlowPhases | null };

    // #819 — central helper enforces TUNER -> COMPOSE chain-contract.
    // onboardingFlowPhases is in COMPOSE_AFFECTING_KEYS, so this PUT
    // automatically fans out recompose-all when the override changes.
    try {
      await updatePlaybookConfig(courseId, (cfg) => {
        if (onboardingFlowPhases === null) {
          delete cfg.onboardingFlowPhases;
        } else {
          cfg.onboardingFlowPhases = onboardingFlowPhases;
        }
        return cfg;
      }, { reason: "course-onboarding:PUT" });
    } catch (e) {
      if (e instanceof Error && e.message.includes("not found")) {
        return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
      }
      throw e;
    }

    const action = onboardingFlowPhases === null ? "reset to domain default" : "set course override";
    console.log(`[course-onboarding-api] ${action} for course ${courseId}`);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[course-onboarding-api] PUT error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update course onboarding" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import type { PlaybookConfig, OnboardingFlowPhases } from "@/lib/types/json-fields";

/**
 * @api GET /api/courses/:courseId/onboarding
 * @visibility internal
 * @auth session
 * @tags courses, onboarding
 * @description Get resolved onboarding flow for a course (course override > domain > INIT-001 fallback). Returns phase source ("course" | "domain" | "none") and available domain media for the editor picker.
 * @pathParam courseId string - The playbook ID (course)
 * @response 200 { ok: true, source, phases, domainName, domainId, media }
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

    let source: "course" | "domain" | "none" = "none";
    let phases: OnboardingFlowPhases | null = null;

    if (courseFlow?.phases?.length) {
      source = "course";
      phases = courseFlow;
    } else if (domainFlow?.phases?.length) {
      source = "domain";
      phases = domainFlow;
    }

    // Load domain media for editor picker
    const media = playbook.domain
      ? await prisma.media.findMany({
          where: {
            source: {
              subject: {
                domainId: playbook.domain.id,
              },
            },
          },
          select: {
            id: true,
            title: true,
            fileName: true,
            mimeType: true,
          },
          take: 100,
          orderBy: { title: "asc" },
        })
      : [];

    return NextResponse.json({
      ok: true,
      source,
      phases,
      domainId: playbook.domain?.id || null,
      domainName: playbook.domain?.name || null,
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

    // Verify playbook exists
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, config: true },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 }
      );
    }

    // Merge into existing config (preserve other config fields)
    const existingConfig = (playbook.config || {}) as PlaybookConfig;
    const updatedConfig: PlaybookConfig = { ...existingConfig };

    if (onboardingFlowPhases === null) {
      // Reset to institution default — remove the override
      delete updatedConfig.onboardingFlowPhases;
    } else {
      updatedConfig.onboardingFlowPhases = onboardingFlowPhases;
    }

    await prisma.playbook.update({
      where: { id: courseId },
      data: { config: updatedConfig },
    });

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

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  getLessonPlanDefaultsWithSource,
  type LessonPlanSettings,
} from "@/lib/lesson-plan/defaults";

/**
 * @api GET /api/domains/:domainId/lesson-plan-defaults
 * @visibility internal
 * @scope domains:read
 * @auth session (VIEWER+)
 * @tags domains, lesson-plan
 * @description Get resolved lesson plan defaults for a domain with source badges (system vs domain override).
 * @pathParam domainId string - The domain ID
 * @response 200 { ok: true, defaults: Record<string, { value, source }> }
 * @response 404 { ok: false, error: "Domain not found" }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ domainId: string }> },
) {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { domainId } = await params;

    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true },
    });

    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 },
      );
    }

    const defaults = await getLessonPlanDefaultsWithSource(domainId);

    return NextResponse.json({ ok: true, defaults });
  } catch (error: any) {
    console.error("[domains/lesson-plan-defaults] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}

/**
 * @api PUT /api/domains/:domainId/lesson-plan-defaults
 * @visibility internal
 * @scope domains:write
 * @auth session (OPERATOR+)
 * @tags domains, lesson-plan
 * @description Save domain-level lesson plan default overrides. Null values reset to system default.
 * @pathParam domainId string - The domain ID
 * @body Partial<LessonPlanSettings> — keys with null reset to system default
 * @response 200 { ok: true, defaults: Record<string, { value, source }> }
 * @response 404 { ok: false, error: "Domain not found" }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ domainId: string }> },
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { domainId } = await params;
    const body = await req.json();

    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true },
    });

    if (!domain) {
      return NextResponse.json(
        { ok: false, error: "Domain not found" },
        { status: 404 },
      );
    }

    // Build overrides object — only store non-null values
    const validKeys: Array<keyof LessonPlanSettings> = [
      "sessionCount",
      "durationMins",
      "emphasis",
      "assessments",
      "lessonPlanModel",
      "audience",
    ];

    const overrides: Partial<LessonPlanSettings> = {};
    for (const key of validKeys) {
      if (body[key] != null) {
        (overrides as any)[key] = body[key];
      }
    }

    // Store null if all values are system defaults (clean slate)
    const hasOverrides = Object.keys(overrides).length > 0;

    await prisma.domain.update({
      where: { id: domainId },
      data: { lessonPlanDefaults: hasOverrides ? overrides : null },
    });

    // Return updated cascade
    const defaults = await getLessonPlanDefaultsWithSource(domainId);

    return NextResponse.json({ ok: true, defaults });
  } catch (error: any) {
    console.error("[domains/lesson-plan-defaults] PUT error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}

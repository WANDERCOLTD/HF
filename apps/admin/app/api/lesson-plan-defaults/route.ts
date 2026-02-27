import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getLessonPlanDefaults } from "@/lib/lesson-plan/defaults";

/**
 * @api GET /api/lesson-plan-defaults
 * @visibility internal
 * @scope courses:read
 * @auth session (VIEWER+)
 * @tags lesson-plan
 * @description Get resolved lesson plan defaults (flat values). Cascades: Domain → SystemSettings → hardcoded.
 * Used by Course Setup Wizard IntentStep for eager plan generation.
 * @query domainId string? - Optional domain ID for institution-level overrides
 * @response 200 { ok: true, defaults: LessonPlanSettings }
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const domainId = request.nextUrl.searchParams.get("domainId");
    const defaults = await getLessonPlanDefaults(domainId);

    return NextResponse.json({ ok: true, defaults });
  } catch (error: any) {
    console.error("[lesson-plan-defaults] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}

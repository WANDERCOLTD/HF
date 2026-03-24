import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { backfillTeachMethods } from "@/lib/content-trust/backfill-teach-methods";

/**
 * @api POST /api/courses/:courseId/backfill-teach-methods
 * @visibility internal
 * @scope courses:write
 * @auth OPERATOR
 * @tags courses, content-trust
 * @description Backfill teachMethod on ContentAssertions that have teachMethod=null.
 *   Uses the course's teachingMode (from playbook config) or falls back to each
 *   subject's teaching profile. Only updates assertions with null teachMethod.
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, updated, total, teachingMode }
 * @response 404 { ok: false, error }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId } = await params;
    const result = await backfillTeachMethods(courseId);

    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    console.error("[courses/:id/backfill-teach-methods] POST error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to backfill teach methods",
      },
      { status: 500 },
    );
  }
}

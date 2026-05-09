import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { computeCourseLinkageScorecard } from "@/lib/content-trust/validate-lo-linkage";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ courseId: string }> };

/**
 * @api GET /api/courses/:courseId/curriculum-scorecard
 * @visibility internal
 * @scope courses:read
 * @auth session (VIEWER+)
 * @tags courses, curriculum, content-trust
 * @description Returns LO linkage health for a course — assertion coverage,
 *   FK coverage, garbage description count, orphan LOs, question linkage, and
 *   human-readable warnings. Used by the Curriculum tab (epic #131 #138) to
 *   render a data-quality banner above the module list, and shared with the
 *   one-time repair script as its before/after measurement.
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, scorecard }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;
    const [scorecard, playbook] = await Promise.all([
      computeCourseLinkageScorecard(courseId),
      // #318: surface persisted curriculum-gen failure state so the
      // Curriculum tab can warn educators about silent-failed background
      // jobs (no more "no curriculum yet" with no explanation).
      prisma.playbook.findUnique({
        where: { id: courseId },
        select: { config: true },
      }),
    ]);
    if (!scorecard) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const cfg = (playbook?.config as Record<string, unknown> | null) ?? {};
    const lastCurriculumGenError =
      cfg.lastCurriculumGenError as { reason: string; at: string } | undefined;

    return NextResponse.json({
      ok: true,
      scorecard,
      ...(lastCurriculumGenError && { lastCurriculumGenError }),
    });
  } catch (error) {
    console.error("[courses/:id/curriculum-scorecard] GET error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

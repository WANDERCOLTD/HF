import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSourceIdsForPlaybook } from "@/lib/knowledge/domain-sources";

export const runtime = "nodejs";

const TRUNCATE_LEN = 120;
const MAX_SAMPLES = 3;

/**
 * @api GET /api/courses/[courseId]/call1-override-preview
 * @visibility internal
 * @scope course:read
 * @auth session (OPERATOR+)
 * @tags course, design, felt-progress, call-1
 * @description Read-only preview of `ContentAssertion` rows scoped to this
 *   course's content surface with `category = 'session_override'` AND
 *   `section = '1'` (exact match). These assertions REPLACE
 *   `onboardingFlowPhases` entirely on call 1 (Layer 0 in
 *   `transforms/pedagogy.ts::deriveSessionOverridePhases`). Surfaced in
 *   `FirstSessionSettings` so educators can see "what does my course-ref
 *   actually do on call 1?" without opening the source markdown.
 *
 *   Exact-match only: assertions with `section = '1-3'` etc. ALSO apply
 *   to call 1 at runtime (via `matchesSessionRange`) but are not shown
 *   here — the response includes `rangeFormCount` so the UI can render
 *   a "range-form assertions not shown" disclaimer when relevant.
 * @response 200 {
 *   ok: true,
 *   count: number,
 *   samples: Array<{ id: string, ref: string | null, text: string, truncated: boolean }>,
 *   rangeFormCount: number,
 * }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!playbook) {
    return NextResponse.json({ ok: false, error: "Course not found" }, { status: 404 });
  }

  const sourceIds = await getSourceIdsForPlaybook(courseId);
  if (sourceIds.length === 0) {
    return NextResponse.json({ ok: true, count: 0, samples: [], rangeFormCount: 0 });
  }

  const [exactMatch, rangeFormCount] = await Promise.all([
    prisma.contentAssertion.findMany({
      where: {
        sourceId: { in: sourceIds },
        category: "session_override",
        section: "1",
      },
      select: { id: true, learningOutcomeRef: true, assertion: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.contentAssertion.count({
      where: {
        sourceId: { in: sourceIds },
        category: "session_override",
        section: { contains: "-" },
      },
    }),
  ]);

  const samples = exactMatch.slice(0, MAX_SAMPLES).map((a) => {
    const truncated = a.assertion.length > TRUNCATE_LEN;
    return {
      id: a.id,
      ref: a.learningOutcomeRef,
      text: truncated ? `${a.assertion.slice(0, TRUNCATE_LEN)}…` : a.assertion,
      truncated,
    };
  });

  return NextResponse.json({
    ok: true,
    count: exactMatch.length,
    samples,
    rangeFormCount,
  });
}

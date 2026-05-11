/**
 * @api POST /api/curricula/:curriculumId/reclassify-los
 * @scope curricula:write
 * @auth session (OPERATOR+)
 * @desc Run the LO audience classifier across every Learning Objective in a
 *   curriculum. Heuristic-first; LLM fallback for ambiguous cases. Decisions
 *   are validated through the AI-to-DB guard, then written as
 *   LearningObjective updates (apply path) and LoClassification history rows
 *   (always). Human-overridden rows are skipped unless `force=true`.
 *
 * @body force boolean? - Re-classify even rows where humanOverriddenAt IS NOT NULL (default false). The guard still won't overwrite the LO row, but the history row records what the classifier would have done.
 * @body maxLOs number? - Cap the number of LOs processed (useful for smoke-testing). Default: no cap.
 * @body concurrency number? - LLM concurrency. Default 4.
 * @returns ReclassifyLosResult
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { reclassifyLearningObjectives } from "@/lib/curriculum/reclassify-los";

type Params = { params: Promise<{ curriculumId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { curriculumId } = await params;
    const body = await req.json().catch(() => ({}));

    const result = await reclassifyLearningObjectives(curriculumId, {
      includeHumanOverridden: body.force === true,
      maxLOs: typeof body.maxLOs === "number" ? body.maxLOs : undefined,
      concurrency: typeof body.concurrency === "number" ? body.concurrency : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("[curricula/:id/reclassify-los] POST error:", error);
    return NextResponse.json({ error: error?.message ?? "unknown error" }, { status: 500 });
  }
}

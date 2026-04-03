/**
 * @api GET /api/curricula/:curriculumId/assessment-preview
 * @auth OPERATOR+
 * @tags curriculum, assessment
 * @desc Returns MCQ questions that would be used for pre/post-test assessment.
 *       Admin preview only — shows what buildPreTest would select.
 * @response 200 { ok, questions: SurveyStepConfig[], questionCount, sourceId, skipped, skipReason? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { buildPreTest, buildPreTestForPlaybook } from "@/lib/assessment/pre-test-builder";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ curriculumId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { curriculumId } = await params;
  let result = await buildPreTest(curriculumId);

  // Fallback: if curriculum-scoped search found nothing, try playbook-wide
  const playbookId = req.nextUrl.searchParams.get("playbookId");
  if (result.skipped && playbookId) {
    result = await buildPreTestForPlaybook(playbookId);
  }

  return NextResponse.json({
    ok: true,
    questions: result.questions,
    questionCount: result.questions.length,
    questionIds: result.questionIds,
    skipped: result.skipped,
    skipReason: result.skipReason,
    sourceId: result.sourceId,
  });
}

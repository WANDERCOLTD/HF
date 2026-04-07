/**
 * @api GET /api/curricula/:curriculumId/assessment-preview
 * @auth OPERATOR+
 * @tags curriculum, assessment
 * @desc Returns MCQ questions that would be used for pre/mid/post-test assessment.
 *       Admin preview only — shows what the test builder would select.
 * @query type — "pre_test" (default) | "mid_test" | "post_test"
 * @query playbookId — required for playbook-wide fallback and comprehension post/mid tests
 * @response 200 { ok, questions: SurveyStepConfig[], questionCount, sourceId, skipped, skipReason? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { buildPreTest, buildPreTestForPlaybook, buildComprehensionPostTest } from "@/lib/assessment/pre-test-builder";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ curriculumId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { curriculumId } = await params;
  const playbookId = req.nextUrl.searchParams.get("playbookId");
  const type = req.nextUrl.searchParams.get("type") ?? "pre_test";

  let result;

  if ((type === "mid_test" || type === "post_test") && playbookId) {
    // Mid/post tests use comprehension post-test builder (queries POST_TEST MCQs directly)
    result = await buildComprehensionPostTest(playbookId);
  } else {
    // Pre-test: curriculum-scoped, then playbook-wide fallback
    result = await buildPreTest(curriculumId);
    if (result.skipped && playbookId) {
      result = await buildPreTestForPlaybook(playbookId);
    }
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

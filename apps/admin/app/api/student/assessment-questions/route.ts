/**
 * @api GET /api/student/assessment-questions
 * @visibility internal
 * @scope student:read
 * @auth session (VIEWER+)
 * @tags student, assessment
 * @description Returns pre-test or post-test questions for the authenticated student.
 *   Pre-test sources MCQ questions from the enrolled curriculum's content.
 *   Post-test mirrors the exact questions used in the pre-test.
 * @query type — "pre_test" | "post_test"
 * @response 200 { ok, questions: SurveyStepConfig[], questionIds: string[], skipped: boolean, skipReason?: string }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { buildPreTest, buildPreTestForPlaybook, buildPostTest } from "@/lib/assessment/pre-test-builder";

const VALID_TYPES = new Set(["pre_test", "post_test"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const type = request.nextUrl.searchParams.get("type");
  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing type parameter. Must be 'pre_test' or 'post_test'." },
      { status: 400 },
    );
  }

  // Resolve caller
  const caller = await prisma.caller.findFirst({
    where: { userId: auth.session.user.id, role: "LEARNER" },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json({ ok: false, error: "No learner profile found" }, { status: 404 });
  }

  if (type === "post_test") {
    const result = await buildPostTest(caller.id);
    return NextResponse.json({ ok: true, ...result });
  }

  // pre_test — resolve enrolled playbook and curriculum
  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { callerId: caller.id, status: "ACTIVE" },
    select: {
      playbookId: true,
      playbook: {
        select: {
          subjects: {
            select: {
              subject: {
                select: {
                  curricula: {
                    where: { deliveryConfig: { not: null } },
                    select: { id: true },
                    take: 1,
                  },
                },
              },
            },
            take: 1,
          },
        },
      },
    },
  });

  const curriculumId = enrollment?.playbook?.subjects?.[0]?.subject?.curricula?.[0]?.id;

  // Try curriculum-scoped first, then fall back to playbook-wide search
  if (curriculumId) {
    const result = await buildPreTest(curriculumId);
    if (!result.skipped) {
      return NextResponse.json({ ok: true, ...result });
    }
  }

  // Playbook-wide fallback — searches all subjects' content sources
  if (enrollment?.playbookId) {
    const result = await buildPreTestForPlaybook(enrollment.playbookId);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json(
    { ok: true, questions: [], questionIds: [], skipped: true, skipReason: "no_curriculum" },
  );
}

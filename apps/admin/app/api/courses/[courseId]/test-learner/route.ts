import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { createTestLearnerForPlaybook } from "@/lib/enrollment/create-test-learner";
import { PlaybookCurriculumRole } from "@prisma/client";

/**
 * @api POST /api/courses/:courseId/test-learner
 * @visibility internal
 * @scope courses:write
 * @auth OPERATOR
 * @tags courses, learners, sim
 * @description Create a fresh test learner enrolled in this course. Random
 *   name, instantiated goals, fire-and-forget compose. Used by the "+ New
 *   test learner" button on the Learners tab so educators can verify config
 *   changes against a guaranteed-fresh prompt.
 *
 *   Pre-checks that the course has at least one published curriculum module
 *   so the test learner doesn't land on a sim that immediately errors.
 *
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok: true, callerId, callerName }
 * @response 400 { ok: false, error } - Course has no curriculum modules yet
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { courseId } = await params;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true, domainId: true, status: true },
  });
  if (!playbook) {
    return NextResponse.json(
      { ok: false, error: "Course not found" },
      { status: 404 },
    );
  }

  // Pre-check: course needs at least one active CurriculumModule so the
  // sim doesn't land on a broken state. Mirrors the lesson-plan guard.
  // #1177 Slice 6 — canonical PlaybookCurriculum primary join (variant-aware).
  const moduleCount = await prisma.curriculumModule.count({
    where: {
      isActive: true,
      curriculum: {
        OR: [
          { playbookLinks: { some: { playbookId: courseId, role: PlaybookCurriculumRole.primary } } },
          { subject: { playbooks: { some: { playbookId: courseId } } } },
        ],
      },
    },
  });
  if (moduleCount === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Course has no curriculum modules yet — generate the curriculum before adding a test learner.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await createTestLearnerForPlaybook(
      courseId,
      "test-learner-button",
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/courses/:id/test-learner] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to create test learner",
      },
      { status: 500 },
    );
  }
}

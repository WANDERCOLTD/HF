/**
 * @api POST /api/playbooks/:playbookId/reset-mcqs
 * @auth OPERATOR+
 * @tags playbook, assessment
 * @desc Regenerate MCQ questions for the playbook's curriculum from assertions.
 *       Warns if callers have pre-test results that would be orphaned.
 *       Pass { force: true } to proceed despite existing results.
 * @body { force?: boolean }
 * @response 200 { ok, created, duplicatesSkipped }
 * @response 200 { ok: false, hasResults: true, affectedCallerCount }
 * @response 404 { ok: false, error: "..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { deleteQuestionsForSource } from "@/lib/content-trust/save-questions";
import { generateMcqsForSource } from "@/lib/assessment/generate-mcqs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const { playbookId } = await params;
  const body = await req.json().catch(() => ({}));
  const force = body.force === true;

  // Resolve curriculum + source(s) — check primarySourceId first, fall back to SubjectSource
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: {
      curriculum: {
        select: {
          id: true,
          primarySourceId: true,
          subjectId: true,
        },
      },
    },
  });

  if (!playbook?.curriculum) {
    return NextResponse.json(
      { ok: false, error: "No curriculum found for this course" },
      { status: 404 },
    );
  }

  // Resolve source IDs: primarySourceId > SubjectSource fallback
  let sourceIds: string[] = [];
  let subjectSourceId: string | undefined;

  if (playbook.curriculum.primarySourceId) {
    sourceIds = [playbook.curriculum.primarySourceId];
  } else if (playbook.curriculum.subjectId) {
    const subjectSources = await prisma.subjectSource.findMany({
      where: { subjectId: playbook.curriculum.subjectId },
      select: { id: true, sourceId: true },
      orderBy: { createdAt: "asc" },
    });
    sourceIds = subjectSources.map((s) => s.sourceId);
    subjectSourceId = subjectSources[0]?.id;
  }

  if (sourceIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No content sources linked to this curriculum" },
      { status: 404 },
    );
  }

  // Check if any enrolled callers have pre-test results
  if (!force) {
    const affectedCallerCount = await prisma.callerAttribute.count({
      where: {
        scope: "PRE_TEST",
        key: "question_ids",
        caller: {
          callerPlaybooks: {
            some: { playbookId, status: "ACTIVE" },
          },
        },
      },
    });

    if (affectedCallerCount > 0) {
      return NextResponse.json({
        ok: false,
        hasResults: true,
        affectedCallerCount,
        message: `${affectedCallerCount} student${affectedCallerCount !== 1 ? "s have" : " has"} completed pre-tests. Regenerating will invalidate their results for uplift comparison.`,
      });
    }
  }

  // Delete existing MCQs and regenerate across all resolved sources
  let totalDeleted = 0;
  let totalCreated = 0;
  let totalDuplicates = 0;
  let lastSkipReason: string | undefined;
  let anyGenerated = false;

  for (const sourceId of sourceIds) {
    const deleted = await deleteQuestionsForSource(sourceId);
    totalDeleted += deleted;
    console.log(`[reset-mcqs] Deleted ${deleted} questions for source ${sourceId}`);

    const result = await generateMcqsForSource(sourceId, {
      userId: auth.userId,
      subjectSourceId,
    });
    totalCreated += result.created;
    totalDuplicates += result.duplicatesSkipped;
    if (!result.skipped) anyGenerated = true;
    if (result.skipReason) lastSkipReason = result.skipReason;
  }

  return NextResponse.json({
    ok: true,
    deleted: totalDeleted,
    created: totalCreated,
    duplicatesSkipped: totalDuplicates,
    skipped: !anyGenerated,
    skipReason: anyGenerated ? undefined : lastSkipReason,
  });
}

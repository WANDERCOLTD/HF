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

  // Resolve content sources via PlaybookSource (direct link)
  const { getSourceIdsForPlaybook } = await import("@/lib/knowledge/domain-sources");
  const sourceIds = await getSourceIdsForPlaybook(playbookId);

  if (sourceIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No content sources linked to this course" },
      { status: 404 },
    );
  }

  // Get a subjectSourceId for backward compat (MCQ generation still uses it)
  const subjects = await prisma.playbookSubject.findMany({
    where: { playbookId },
    select: { subjectId: true },
  });
  const subjectSources = subjects.length > 0
    ? await prisma.subjectSource.findMany({
        where: { subjectId: { in: subjects.map((s) => s.subjectId) } },
        select: { id: true },
        take: 1,
      })
    : [];
  const subjectSourceId = subjectSources[0]?.id;

  // Check if any enrolled callers have pre-test results
  if (!force) {
    const affectedCallerCount = await prisma.callerAttribute.count({
      where: {
        scope: "PRE_TEST",
        key: "question_ids",
        caller: {
          enrollments: {
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
      userId: auth.session.user.id,
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

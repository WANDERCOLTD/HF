import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";

/**
 * @api GET /api/courses/:courseId/questions
 * @visibility internal
 * @scope courses:read
 * @auth VIEWER
 * @tags courses, content-trust, questions
 * @description Returns all extracted questions for a course with linked teaching-point
 *   and source info. Powers the Questions & MCQs tab on the Curriculum health card.
 * @pathParam courseId string - Playbook UUID
 * @query limit number - Max questions to return (default 500, max 1000)
 * @response 200 { ok, questions: Array<{ id, questionText, questionType, assertion: { id, category, text, learningOutcomeRef } | null, sourceName, linkedToTp }>, total, linkedCount }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") || "500"), 1000);

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { domain: { select: { id: true } } },
    });
    if (!playbook?.domain?.id) {
      return NextResponse.json({ ok: true, questions: [], total: 0, linkedCount: 0 });
    }

    const { subjects } = await getSubjectsForPlaybook(courseId, playbook.domain.id);
    const sourceIds = subjects.flatMap((s) => s.sources.map((src) => src.sourceId));
    if (sourceIds.length === 0) {
      return NextResponse.json({ ok: true, questions: [], total: 0, linkedCount: 0 });
    }

    const [questions, total, linkedCount] = await Promise.all([
      prisma.contentQuestion.findMany({
        where: { sourceId: { in: sourceIds } },
        select: {
          id: true,
          questionText: true,
          questionType: true,
          // #281 Slice 3b: provenance signal so the McqPanel can render
          // a trust badge per question. AI_ASSISTED for generator output;
          // higher tiers reserved for educator-imported question banks.
          trustLevel: true,
          assertionId: true,
          assertion: {
            select: { id: true, assertion: true, category: true, learningOutcomeRef: true },
          },
          source: { select: { name: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: limit,
      }),
      prisma.contentQuestion.count({ where: { sourceId: { in: sourceIds } } }),
      prisma.contentQuestion.count({
        where: { sourceId: { in: sourceIds }, assertionId: { not: null } },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      questions: questions.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        trustLevel: q.trustLevel ?? null,
        assertion: q.assertion
          ? {
              id: q.assertion.id,
              text: q.assertion.assertion,
              category: q.assertion.category,
              learningOutcomeRef: q.assertion.learningOutcomeRef,
            }
          : null,
        sourceName: q.source?.name ?? null,
        linkedToTp: q.assertionId !== null,
      })),
      total,
      linkedCount,
    });
  } catch (err: any) {
    console.error("[course-questions] Error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Internal error" }, { status: 500 });
  }
}

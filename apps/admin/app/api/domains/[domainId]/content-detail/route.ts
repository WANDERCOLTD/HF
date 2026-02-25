import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/domains/:domainId/content-detail
 * @visibility internal
 * @scope domains:read
 * @auth VIEWER
 * @tags domains, content-trust
 * @description Lazy-load individual content items for a group type + category.
 *   Used by the Teach wizard to show expandable TP review rows.
 * @pathParam domainId string - Domain UUID
 * @query subjectIds string - Comma-separated subject IDs to scope results
 * @query groupType string - "assertion" | "question" | "vocabulary"
 * @query category string - Category filter (e.g., "FACT", "MCQ", or ignored for vocabulary)
 * @query limit number - Max items to return (default 100)
 * @response 200 { ok, items: Array<{ id, text, ... }> }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Domain not found" }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> },
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;
    const { searchParams } = new URL(req.url);
    const subjectIdsParam = searchParams.get("subjectIds");
    const groupType = searchParams.get("groupType");
    const category = searchParams.get("category");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10) || 100, 500);

    if (!groupType || !["assertion", "question", "vocabulary"].includes(groupType)) {
      return NextResponse.json(
        { ok: false, error: "groupType must be one of: assertion, question, vocabulary" },
        { status: 400 },
      );
    }

    // Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true },
    });
    if (!domain) {
      return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
    }

    // Resolve sourceIds from domain (optionally scoped by subjects)
    const subjectIds = subjectIdsParam ? subjectIdsParam.split(",").filter(Boolean) : undefined;
    const subjectFilter = subjectIds?.length
      ? { subject: { id: { in: subjectIds }, domains: { some: { domainId } } } }
      : { subject: { domains: { some: { domainId } } } };

    const sources = await prisma.contentSource.findMany({
      where: { subjects: { some: subjectFilter } },
      select: { id: true },
    });
    const sourceIds = sources.map((s) => s.id);

    if (sourceIds.length === 0) {
      return NextResponse.json({ ok: true, items: [] });
    }

    // Fetch items based on groupType
    if (groupType === "assertion") {
      const assertions = await prisma.contentAssertion.findMany({
        where: {
          sourceId: { in: sourceIds },
          ...(category ? { category } : {}),
        },
        select: {
          id: true,
          assertion: true,
          category: true,
          tags: true,
          chapter: true,
          depth: true,
        },
        orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
        take: limit,
      });

      return NextResponse.json({
        ok: true,
        items: assertions.map((a) => ({
          id: a.id,
          text: a.assertion,
          category: a.category,
          tags: a.tags,
          chapter: a.chapter,
          depth: a.depth,
        })),
      });
    }

    if (groupType === "question") {
      const questions = await prisma.contentQuestion.findMany({
        where: {
          sourceId: { in: sourceIds },
          ...(category ? { questionType: category.toUpperCase() } : {}),
        },
        select: {
          id: true,
          questionText: true,
          questionType: true,
          correctAnswer: true,
          chapter: true,
        },
        orderBy: { sortOrder: "asc" },
        take: limit,
      });

      return NextResponse.json({
        ok: true,
        items: questions.map((q) => ({
          id: q.id,
          text: q.questionText,
          questionType: q.questionType,
          correctAnswer: q.correctAnswer,
          chapter: q.chapter,
        })),
      });
    }

    // vocabulary
    const vocabulary = await prisma.contentVocabulary.findMany({
      where: { sourceId: { in: sourceIds } },
      select: {
        id: true,
        term: true,
        definition: true,
        partOfSpeech: true,
        chapter: true,
      },
      orderBy: { sortOrder: "asc" },
      take: limit,
    });

    return NextResponse.json({
      ok: true,
      items: vocabulary.map((v) => ({
        id: v.id,
        term: v.term,
        definition: v.definition,
        partOfSpeech: v.partOfSpeech,
        chapter: v.chapter,
      })),
    });
  } catch (error: unknown) {
    console.error("[domains/:id/content-detail] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load content detail" },
      { status: 500 },
    );
  }
}

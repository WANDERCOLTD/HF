import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/domains/:domainId/content-stats
 * @visibility internal
 * @scope domains:read
 * @auth VIEWER
 * @tags domains, content-trust
 * @description Lightweight stats for a domain's content sources — assertion count
 *   and extraction status. Used by the Plan Sessions step to poll for extraction progress.
 * @pathParam domainId string - Domain UUID
 * @query subjectIds string - Comma-separated subject IDs to scope results (course-scoped)
 * @response 200 { ok, assertionCount, sourceCount, extractedSourceCount, allExtracted, questionCount, vocabularyCount }
 * @response 404 { ok: false, error: "Domain not found" }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;
    const { searchParams } = new URL(req.url);
    const subjectIdsParam = searchParams.get("subjectIds");
    const subjectIds = subjectIdsParam ? subjectIdsParam.split(",").filter(Boolean) : undefined;

    // Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true },
    });
    if (!domain) {
      return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
    }

    // When subjectIds provided, scope to those subjects only (must still belong to domain)
    const subjectFilter = subjectIds?.length
      ? { subject: { id: { in: subjectIds }, domains: { some: { domainId } } } }
      : { subject: { domains: { some: { domainId } } } };

    // Get all content sources linked to this domain through subjects
    const sources = await prisma.contentSource.findMany({
      where: {
        subjects: {
          some: subjectFilter,
        },
      },
      select: {
        id: true,
        _count: { select: { assertions: true } },
      },
    });

    const sourceCount = sources.length;
    const sourceIds = sources.map((s) => s.id);
    const extractedSourceCount = sources.filter((s) => s._count.assertions > 0).length;
    const assertionCount = sources.reduce((sum, s) => sum + s._count.assertions, 0);

    // Check for recent in-progress extraction tasks (30-min staleness guard)
    let hasActiveJobs = false;
    if (sourceIds.length > 0) {
      const activeTasks = await prisma.userTask.count({
        where: {
          taskType: { in: ["extraction", "content_extraction", "course_pack_ingest"] },
          status: "in_progress",
          startedAt: { gte: new Date(Date.now() - 30 * 60_000) },
        },
      });
      hasActiveJobs = activeTasks > 0;
    }

    // Question + vocabulary counts (for enriched wizard display)
    const questionCount = sourceIds.length > 0
      ? await prisma.contentQuestion.count({ where: { sourceId: { in: sourceIds } } })
      : 0;
    const vocabularyCount = sourceIds.length > 0
      ? await prisma.contentVocabulary.count({ where: { sourceId: { in: sourceIds } } })
      : 0;

    const allExtracted = sourceCount > 0 && extractedSourceCount === sourceCount && !hasActiveJobs;

    return NextResponse.json({
      ok: true,
      assertionCount,
      sourceCount,
      extractedSourceCount,
      allExtracted,
      questionCount,
      vocabularyCount,
    });
  } catch (error: unknown) {
    console.error("[domains/:id/content-stats] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load content stats" },
      { status: 500 }
    );
  }
}

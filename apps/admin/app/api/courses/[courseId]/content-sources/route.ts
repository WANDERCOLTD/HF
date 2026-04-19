import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";

/**
 * @api GET /api/courses/:courseId/content-sources
 * @visibility internal
 * @scope courses:read
 * @auth VIEWER
 * @tags courses, content-trust
 * @description Returns a flat list of content sources linked to this course via PlaybookSource.
 *   No subject grouping — sources are course-scoped. Includes per-source assertion counts
 *   split into content vs instruction categories.
 * @pathParam courseId string - Playbook UUID
 * @response 200 { ok, sources, course, totals }
 * @response 404 { ok: false, error }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId } = await params;

    // Load playbook + config
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        name: true,
        domainId: true,
        config: true,
        domain: { select: { name: true } },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    // Sources via PlaybookSource (direct link — no subject chain)
    const playbookSources = await prisma.playbookSource.findMany({
      where: { playbookId: courseId },
      select: {
        sourceId: true,
        sortOrder: true,
        tags: true,
        source: {
          select: {
            id: true,
            name: true,
            documentType: true,
            extractorVersion: true,
            _count: { select: { assertions: true } },
          },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    const sourceIds = playbookSources.map((ps) => ps.sourceId);

    // Count instruction-category assertions per source
    const instructionBySource = sourceIds.length > 0
      ? await prisma.contentAssertion.groupBy({
          by: ["sourceId"],
          where: {
            sourceId: { in: sourceIds },
            category: { in: [...INSTRUCTION_CATEGORIES] },
          },
          _count: { id: true },
        })
      : [];

    const instrMap = new Map(
      instructionBySource.map((g) => [g.sourceId, g._count.id]),
    );

    // Build flat source list
    const sources = playbookSources.map((ps) => {
      const assertionCount = ps.source._count.assertions;
      const instructionCount = instrMap.get(ps.sourceId) || 0;
      return {
        id: ps.source.id,
        name: ps.source.name,
        documentType: ps.source.documentType,
        extractorVersion: ps.source.extractorVersion,
        assertionCount,
        contentAssertionCount: assertionCount - instructionCount,
        instructionAssertionCount: instructionCount,
        sortOrder: ps.sortOrder,
        tags: ps.tags,
      };
    });

    // Teaching profile: playbook config > PlaybookSubject[0]
    const pbConfig = (playbook.config as Record<string, unknown>) || {};
    let teachingProfile = (pbConfig.teachingProfile as string) || null;
    if (!teachingProfile) {
      const ps = await prisma.playbookSubject.findFirst({
        where: { playbookId: courseId },
        select: { subject: { select: { teachingProfile: true } } },
      });
      teachingProfile = ps?.subject?.teachingProfile || null;
    }

    // Totals
    const totalAssertions = sources.reduce((sum, s) => sum + s.assertionCount, 0);
    const totalContent = sources.reduce((sum, s) => sum + s.contentAssertionCount, 0);
    const totalInstructions = sources.reduce((sum, s) => sum + s.instructionAssertionCount, 0);

    return NextResponse.json({
      ok: true,
      sources,
      course: {
        id: playbook.id,
        name: playbook.name,
        domainId: playbook.domainId,
        domainName: playbook.domain.name,
        teachingProfile,
      },
      totals: {
        assertions: totalAssertions,
        contentAssertions: totalContent,
        instructionAssertions: totalInstructions,
        sources: sources.length,
      },
    }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (error: unknown) {
    console.error("[courses/:id/content-sources] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

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
 * @response 200 { ok, assertionCount, sourceCount, extractedSourceCount, allExtracted }
 * @response 404 { ok: false, error: "Domain not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { domainId } = await params;

    // Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true },
    });
    if (!domain) {
      return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
    }

    // Get all content sources linked to this domain through subjects
    const sources = await prisma.contentSource.findMany({
      where: {
        subjects: {
          some: { subject: { domains: { some: { domainId } } } },
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

    // Check for any in-progress extraction tasks on these sources
    let hasActiveJobs = false;
    if (sourceIds.length > 0) {
      const activeTasks = await prisma.userTask.count({
        where: {
          taskType: { in: ["extraction", "content_extraction", "course_pack_ingest"] },
          status: "in_progress",
        },
      });
      hasActiveJobs = activeTasks > 0;
    }

    const allExtracted = sourceCount > 0 && extractedSourceCount === sourceCount && !hasActiveJobs;

    return NextResponse.json({
      ok: true,
      assertionCount,
      sourceCount,
      extractedSourceCount,
      allExtracted,
    });
  } catch (error: unknown) {
    console.error("[domains/:id/content-stats] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load content stats" },
      { status: 500 }
    );
  }
}

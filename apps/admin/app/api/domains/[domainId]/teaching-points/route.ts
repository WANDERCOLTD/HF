import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/domains/:domainId/teaching-points
 * @visibility internal
 * @scope domains:read
 * @auth session
 * @tags domains, content-trust
 * @description Get teaching points (assertions) for a domain through the subject→source chain.
 * @pathParam domainId string - Domain UUID
 * @query limit number - Max results (default 50, max 200)
 * @response 200 { ok: true, teachingPoints: [...], total: number }
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
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

    // Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true },
    });
    if (!domain) {
      return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
    }

    // Query assertions directly through the subject chain (same pattern as course-readiness)
    const [assertions, total] = await Promise.all([
      prisma.contentAssertion.findMany({
        where: {
          source: {
            subjects: {
              some: { subject: { domains: { some: { domainId } } } },
            },
          },
        },
        orderBy: [{ chapter: "asc" }, { createdAt: "asc" }],
        take: limit,
        select: {
          id: true,
          assertion: true,
          category: true,
          chapter: true,
          reviewedAt: true,
          source: { select: { id: true, name: true } },
        },
      }),
      prisma.contentAssertion.count({
        where: {
          source: {
            subjects: {
              some: { subject: { domains: { some: { domainId } } } },
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      teachingPoints: assertions.map((a) => ({
        id: a.id,
        text: a.assertion,
        type: a.category || "FACT",
        chapter: a.chapter,
        reviewed: !!a.reviewedAt,
        sourceId: a.source.id,
        sourceName: a.source.name,
      })),
      total,
    });
  } catch (error: unknown) {
    console.error("[domains/:id/teaching-points] GET error:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to load teaching points" }, { status: 500 });
  }
}

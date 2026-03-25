import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";

/**
 * @api GET /api/courses/:courseId/assertions
 * @visibility internal
 * @scope courses:read
 * @auth VIEWER
 * @tags courses, content-trust
 * @description Returns teaching point assertions for a course, with source name and optional session assignment.
 *   Used by the What tab TP inventory.
 * @pathParam courseId string - Playbook UUID
 * @query limit number - Max assertions to return (default 500, max 1000)
 * @response 200 { ok, assertions: Array<{ id, assertion, category, teachMethod, learningOutcomeRef, sourceName, session }>, total }
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

    // Get source IDs for this playbook's subjects
    const subjects = await getSubjectsForPlaybook(courseId);
    if (!subjects || subjects.length === 0) {
      return NextResponse.json({ ok: true, assertions: [], total: 0 });
    }

    const sourceIds = subjects.flatMap((s: any) =>
      (s.sources || []).map((src: any) => src.sourceId || src.id)
    );

    if (sourceIds.length === 0) {
      return NextResponse.json({ ok: true, assertions: [], total: 0 });
    }

    // Fetch assertions with source name
    const [assertions, total] = await Promise.all([
      prisma.contentAssertion.findMany({
        where: { sourceId: { in: sourceIds } },
        select: {
          id: true,
          assertion: true,
          category: true,
          teachMethod: true,
          learningOutcomeRef: true,
          source: { select: { name: true } },
        },
        orderBy: [{ learningOutcomeRef: "asc" }, { orderIndex: "asc" }],
        take: limit,
      }),
      prisma.contentAssertion.count({
        where: { sourceId: { in: sourceIds } },
      }),
    ]);

    // Get lesson plan to map assertions to sessions
    const curriculum = await prisma.curriculum.findFirst({
      where: { subject: { playbooks: { some: { playbookId: courseId } } } },
      select: { deliveryConfig: true },
    });
    const lessonPlan = (curriculum?.deliveryConfig as any)?.lessonPlan as Array<{
      session: number;
      assertionIds?: string[];
      learningOutcomeRefs?: string[];
    }> | undefined;

    // Build assertion-to-session map
    const assertionSessionMap = new Map<string, number>();
    if (lessonPlan) {
      for (const entry of lessonPlan) {
        // Direct assertion ID assignment
        if (entry.assertionIds) {
          for (const aid of entry.assertionIds) {
            assertionSessionMap.set(aid, entry.session);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      assertions: assertions.map((a) => ({
        id: a.id,
        assertion: a.assertion,
        category: a.category,
        teachMethod: a.teachMethod,
        learningOutcomeRef: a.learningOutcomeRef,
        sourceName: a.source?.name || "Unknown",
        session: assertionSessionMap.get(a.id) ?? null,
      })),
      total,
    });
  } catch (err: any) {
    console.error("[assertions] Error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Internal error" }, { status: 500 });
  }
}

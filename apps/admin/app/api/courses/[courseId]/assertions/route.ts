import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";

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
 * @query scope string - "content" (default, TPs only), "instructions" (TIs only), or "all" (both)
 * @response 200 { ok, assertions: Array<{ id, assertion, category, teachMethod, learningOutcomeRef, sourceName, session, trustLevel }>, total }
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
    const scope = (searchParams.get("scope") || "content") as "content" | "instructions" | "all";
    const categoryFilter =
      scope === "all"
        ? {}
        : scope === "instructions"
          ? { category: { in: [...INSTRUCTION_CATEGORIES] } }
          : { category: { notIn: [...INSTRUCTION_CATEGORIES] } };

    // Look up playbook to get domainId
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { domain: { select: { id: true } } },
    });
    if (!playbook?.domain?.id) {
      return NextResponse.json({ ok: true, assertions: [], total: 0 });
    }

    // Get source IDs for this playbook's subjects
    const { subjects } = await getSubjectsForPlaybook(courseId, playbook.domain.id);
    if (subjects.length === 0) {
      return NextResponse.json({ ok: true, assertions: [], total: 0 });
    }

    const sourceIds = subjects.flatMap((s) =>
      s.sources.map((src) => src.sourceId)
    );

    if (sourceIds.length === 0) {
      return NextResponse.json({ ok: true, assertions: [], total: 0 });
    }

    // Fetch assertions with source name
    const whereClause = { sourceId: { in: sourceIds }, ...categoryFilter };
    const [assertions, total] = await Promise.all([
      prisma.contentAssertion.findMany({
        where: whereClause,
        select: {
          id: true,
          assertion: true,
          category: true,
          teachMethod: true,
          learningOutcomeRef: true,
          trustLevel: true,
          source: { select: { name: true } },
        },
        orderBy: [{ learningOutcomeRef: "asc" }, { orderIndex: "asc" }],
        take: limit,
      }),
      prisma.contentAssertion.count({ where: whereClause }),
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
    if (Array.isArray(lessonPlan)) {
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
        trustLevel: a.trustLevel,
        sourceName: a.source?.name ?? null,
        session: assertionSessionMap.get(a.id) ?? null,
      })),
      total,
    });
  } catch (err: any) {
    console.error("[assertions] Error:", err);
    return NextResponse.json({ ok: false, error: err.message || "Internal error" }, { status: 500 });
  }
}

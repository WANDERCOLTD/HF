import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { INSTRUCTION_CATEGORIES, type InstructionCategory } from "@/lib/content-trust/resolve-config";

/**
 * @api GET /api/courses/:courseId/course-instructions
 * @visibility public
 * @scope courses:read
 * @description Returns COURSE_REFERENCE assertions grouped by instruction category.
 *   Aggregates across all subjects/sources for the given course (playbook).
 *   Used by the HOW tab on the course detail page.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const user = await requireAuth("VIEWER");
    if (isAuthError(user)) return user;

    const { courseId } = await params;

    // 1. Get all subject source IDs for this course (playbook)
    const subjects = await prisma.playbookSubject.findMany({
      where: { playbookId: courseId },
      select: {
        subject: {
          select: {
            id: true,
            name: true,
            sources: {
              select: { sourceId: true },
            },
          },
        },
      },
    });

    const allSourceIds = [
      ...new Set(
        subjects.flatMap((ps) => ps.subject.sources.map((ss) => ss.sourceId)),
      ),
    ];

    if (allSourceIds.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: {},
        totals: {},
        grandTotal: 0,
        sourceCount: 0,
      });
    }

    // 2. Fetch all instruction-category assertions (exclude blank text)
    const assertions = await prisma.contentAssertion.findMany({
      where: {
        sourceId: { in: allSourceIds },
        category: { in: [...INSTRUCTION_CATEGORIES] },
        assertion: { not: "" },
      },
      orderBy: [
        { depth: "asc" },
        { orderIndex: "asc" },
      ],
      take: 300,
      select: {
        id: true,
        assertion: true,
        category: true,
        chapter: true,
        section: true,
        tags: true,
        depth: true,
        source: {
          select: { id: true, name: true },
        },
      },
    });

    // 3. Group by category
    const categories: Record<string, Array<{
      id: string;
      assertion: string;
      category: string;
      chapter: string | null;
      section: string | null;
      tags: string[];
      depth: number | null;
      sourceName: string | null;
    }>> = {};

    const totals: Record<string, number> = {};
    const sourceIds = new Set<string>();

    for (const a of assertions) {
      const cat = a.category ?? "other";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push({
        id: a.id,
        assertion: a.assertion,
        category: a.category ?? "other",
        chapter: a.chapter,
        section: a.section,
        tags: (a.tags as string[]) || [],
        depth: a.depth,
        sourceName: a.source?.name ?? null,
      });
      totals[cat] = (totals[cat] || 0) + 1;
      if (a.source?.id) sourceIds.add(a.source.id);
    }

    return NextResponse.json({
      ok: true,
      categories,
      totals,
      grandTotal: assertions.length,
      sourceCount: sourceIds.size,
    });
  } catch (err) {
    console.error("[course-instructions] Error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load course instructions" },
      { status: 500 },
    );
  }
}

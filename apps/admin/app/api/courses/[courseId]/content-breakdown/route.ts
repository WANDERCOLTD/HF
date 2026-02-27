import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";

/**
 * @api GET /api/courses/:courseId/content-breakdown
 * @visibility internal
 * @scope courses:read
 * @auth VIEWER
 * @tags courses, content-trust
 * @description Returns teaching point counts grouped by teachMethod for a course (playbook).
 *   Only returns course-scoped sources (PlaybookSubject records) — does NOT fall back to
 *   domain-wide sources. Returns { noCourseSources: true } if no subjects are linked yet.
 *   In summary mode (default), returns aggregate counts. In drill-down mode (when teachMethod
 *   query param is set), returns paginated individual assertions for that method.
 * @pathParam courseId string - Playbook UUID
 * @query sourceId string - Optional: scope to a single content source
 * @query bySubject boolean - Optional: include per-subject breakdown
 * @query teachMethod string - Optional: drill-down mode — return individual assertions for this method
 * @query limit number - Drill-down pagination limit (default 50, max 50)
 * @query offset number - Drill-down pagination offset (default 0)
 * @query sortBy string - Drill-down sort field: "category" | "chapter" | "source" (default "chapter")
 * @query sortDir string - Sort direction: "asc" | "desc" (default "asc")
 * @response 200 { ok, teachingMode, methods, total, reviewedCount } (summary mode)
 * @response 200 { ok, assertions, total } (drill-down mode)
 * @response 404 { ok: false, error: "Course not found" }
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
    const sourceIdParam = searchParams.get("sourceId");
    const bySubject = searchParams.get("bySubject") === "true";
    const teachMethodParam = searchParams.get("teachMethod");

    // ── Load playbook + domain ────────────────────────
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        config: true,
        domain: { select: { id: true } },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const domainId = playbook.domain?.id;
    if (!domainId) {
      return NextResponse.json({
        ok: true,
        teachingMode: null,
        methods: [],
        total: 0,
        reviewedCount: 0,
      });
    }

    const pbConfig = (playbook.config as Record<string, any>) || {};
    const teachingMode = pbConfig.teachingMode || null;

    // ── Resolve source IDs ────────────────────────────
    let sourceIds: string[];

    if (sourceIdParam) {
      // Scoped to single source — verify it exists
      const source = await prisma.contentSource.findUnique({
        where: { id: sourceIdParam },
        select: { id: true },
      });
      if (!source) {
        return NextResponse.json(
          { ok: false, error: "Source not found" },
          { status: 404 },
        );
      }
      sourceIds = [sourceIdParam];
    } else {
      // Course-scoped only — no domain fallback for display.
      // Domain fallback is for runtime prompt composition only; bleeding
      // domain sources into a new course's content view causes false duplicates.
      const { subjects, scoped } = await getSubjectsForPlaybook(courseId, domainId);
      if (!scoped) {
        return NextResponse.json({
          ok: true,
          teachingMode,
          methods: [],
          total: 0,
          reviewedCount: 0,
          noCourseSources: true,
        });
      }
      sourceIds = [...new Set(subjects.flatMap((s) => s.sources.map((ss) => ss.sourceId)))];
    }

    if (sourceIds.length === 0) {
      return NextResponse.json({
        ok: true,
        teachingMode,
        methods: [],
        total: 0,
        reviewedCount: 0,
      });
    }

    // ── Drill-down mode: return individual assertions ─
    if (teachMethodParam) {
      const limit = Math.min(
        parseInt(searchParams.get("limit") || "50", 10) || 50,
        50,
      );
      const offset = parseInt(searchParams.get("offset") || "0", 10) || 0;
      const sortBy = searchParams.get("sortBy") || "chapter";
      const sortDir =
        searchParams.get("sortDir") === "desc" ? "desc" : "asc";

      // Build where clause — handle "unassigned" as NULL
      const teachMethodWhere =
        teachMethodParam === "unassigned"
          ? { teachMethod: null }
          : { teachMethod: teachMethodParam };

      const orderBy: Record<string, string> =
        sortBy === "source"
          ? { sourceId: sortDir }
          : sortBy === "category"
            ? { category: sortDir }
            : { chapter: sortDir };

      const [assertions, total] = await Promise.all([
        prisma.contentAssertion.findMany({
          where: { sourceId: { in: sourceIds }, ...teachMethodWhere },
          select: {
            id: true,
            assertion: true,
            category: true,
            teachMethod: true,
            chapter: true,
            section: true,
            reviewedAt: true,
            source: {
              select: {
                id: true,
                name: true,
                subjects: {
                  select: { subject: { select: { id: true, name: true } } },
                  take: 1,
                },
              },
            },
          },
          orderBy,
          take: limit,
          skip: offset,
        }),
        prisma.contentAssertion.count({
          where: { sourceId: { in: sourceIds }, ...teachMethodWhere },
        }),
      ]);

      return NextResponse.json({
        ok: true,
        assertions: assertions.map((a) => ({
          id: a.id,
          assertion: a.assertion,
          category: a.category,
          teachMethod: a.teachMethod || "unassigned",
          chapter: a.chapter,
          section: a.section,
          reviewed: !!a.reviewedAt,
          sourceName: a.source?.name || null,
          sourceId: a.source?.id || null,
          subjectName: a.source?.subjects?.[0]?.subject?.name || null,
          subjectId: a.source?.subjects?.[0]?.subject?.id || null,
        })),
        total,
      });
    }

    // ── Summary mode: counts by teachMethod ───────────
    const [methodGroups, totalCount, reviewedCount] = await Promise.all([
      prisma.contentAssertion.groupBy({
        by: ["teachMethod"],
        where: { sourceId: { in: sourceIds } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.contentAssertion.count({
        where: { sourceId: { in: sourceIds } },
      }),
      prisma.contentAssertion.count({
        where: { sourceId: { in: sourceIds }, reviewedAt: { not: null } },
      }),
    ]);

    const methods = methodGroups.map((g) => ({
      teachMethod: g.teachMethod || "unassigned",
      count: g._count.id,
    }));

    // Per-method reviewed counts
    const reviewedByMethod = await prisma.contentAssertion.groupBy({
      by: ["teachMethod"],
      where: {
        sourceId: { in: sourceIds },
        reviewedAt: { not: null },
      },
      _count: { id: true },
    });
    const reviewedMap = new Map(
      reviewedByMethod.map((g) => [
        g.teachMethod || "unassigned",
        g._count.id,
      ]),
    );
    const methodsWithReview = methods.map((m) => ({
      ...m,
      reviewed: reviewedMap.get(m.teachMethod) || 0,
    }));

    // ── Optional: per-subject breakdown ───────────────
    let bySubjectData: Array<{
      subjectId: string;
      subjectName: string;
      methods: Array<{ teachMethod: string; count: number }>;
    }> | undefined;

    if (bySubject) {
      // Get subjects linked to this course (playbook-scoped, domain fallback)
      const playbookSubjects = await prisma.playbookSubject.findMany({
        where: { playbookId: courseId },
        select: {
          subject: {
            select: {
              id: true,
              name: true,
              sources: { select: { sourceId: true } },
            },
          },
        },
      });

      // If we reached here, scoped=true, so playbookSubjects is always populated
      const subjectRecords = playbookSubjects.map((ps) => ps.subject);

      bySubjectData = [];
      for (const subject of subjectRecords) {
        const subSourceIds = subject.sources
          .map((ss) => ss.sourceId)
          .filter((id) => sourceIds.includes(id));
        if (subSourceIds.length === 0) continue;

        const subGroups = await prisma.contentAssertion.groupBy({
          by: ["teachMethod"],
          where: { sourceId: { in: subSourceIds } },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
        });

        bySubjectData.push({
          subjectId: subject.id,
          subjectName: subject.name,
          methods: subGroups.map((g) => ({
            teachMethod: g.teachMethod || "unassigned",
            count: g._count.id,
          })),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      teachingMode,
      methods: methodsWithReview,
      total: totalCount,
      reviewedCount,
      ...(bySubjectData ? { bySubject: bySubjectData } : {}),
    });
  } catch (error: unknown) {
    console.error("[courses/:id/content-breakdown] GET error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load content breakdown",
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api POST /api/courses/:courseId/re-extract-instructions
 * @visibility public
 * @scope courses:write
 * @auth OPERATOR
 * @tags content-trust, extraction, courses
 * @description Find all COURSE_REFERENCE sources for a course and trigger
 *   re-extraction with replace mode. Returns job IDs for tracking.
 *
 * @pathParam courseId string - Playbook UUID
 * @response 202 { ok, sources: [{ sourceId, subjectId, jobId }] }
 * @response 404 { ok: false, error }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const user = await requireAuth("OPERATOR");
    if (isAuthError(user)) return user;

    const { courseId } = await params;

    // Find all COURSE_REFERENCE sources linked to this course's subjects
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId: courseId },
      select: {
        subject: {
          select: {
            id: true,
            sources: {
              select: {
                sourceId: true,
                source: {
                  select: {
                    id: true,
                    name: true,
                    documentType: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Collect unique COURSE_REFERENCE sources with their subject IDs
    const refSources: Array<{ sourceId: string; subjectId: string; name: string }> = [];
    const seen = new Set<string>();

    for (const ps of playbookSubjects) {
      for (const ss of ps.subject.sources) {
        if (ss.source.documentType === "COURSE_REFERENCE" && !seen.has(ss.sourceId)) {
          seen.add(ss.sourceId);
          refSources.push({
            sourceId: ss.sourceId,
            subjectId: ps.subject.id,
            name: ss.source.name,
          });
        }
      }
    }

    if (refSources.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        message: "No COURSE_REFERENCE sources found for this course",
      });
    }

    // Trigger re-extraction for each source (fire-and-forget via extract endpoint)
    const results: Array<{ sourceId: string; name: string; jobId: string | null; error?: string }> = [];

    for (const src of refSources) {
      try {
        // Call the extract endpoint internally
        const baseUrl = _req.nextUrl.origin;
        const res = await fetch(`${baseUrl}/api/content-sources/${src.sourceId}/extract`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: _req.headers.get("cookie") || "",
          },
          body: JSON.stringify({
            subjectId: src.subjectId,
            replace: true,
          }),
        });
        const data = await res.json();
        results.push({
          sourceId: src.sourceId,
          name: src.name,
          jobId: data.ok ? data.jobId : null,
          error: data.ok ? undefined : data.error,
        });
      } catch (err: any) {
        results.push({
          sourceId: src.sourceId,
          name: src.name,
          jobId: null,
          error: err.message || "Failed to trigger extraction",
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        sources: results,
        triggered: results.filter((r) => r.jobId).length,
        total: refSources.length,
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("[re-extract-instructions] Error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to trigger re-extraction" },
      { status: 500 },
    );
  }
}

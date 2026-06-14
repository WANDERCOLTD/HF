/**
 * Course section staleness — #1557 (Story 2 of EPIC #1555).
 *
 * Reads `PlaybookSectionStaleness` rows for the course (a course IS a
 * Playbook here — `courseId === playbookId`) and returns the per-section
 * hash, `staleSince`, and `affectedCallerCount`. Powers the renderer-side
 * staleness chips that Story 3's section-scoped recompose acts on.
 *
 * Sections that have never been bumped are omitted from the response; by
 * convention, "no row" === "never drifted from compose-time state", and
 * the renderer can treat them as fresh.
 *
 * Auth: OPERATOR+ (matches sibling staleness-aggregate route). STUDENT
 * receives 403. No per-caller scoping is needed — this is course-wide
 * staleness data, not learner-scoped state.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSectionStaleness } from "@/lib/compose/section-staleness";

export const runtime = "nodejs";

/**
 * @api GET /api/courses/:courseId/section-staleness
 * @visibility internal
 * @scope courses:read
 * @auth session (OPERATOR+)
 * @description Returns the section-grain staleness map for the course.
 *   One entry per `ComposeSectionKey` that has been bumped at least once;
 *   sections never bumped are omitted (treat as fresh). Decoupled from the
 *   page-level `Playbook.composeInputsUpdatedAt` clock.
 * @response 200 { ok: true, sections: Array<{ sectionKey: string, sectionHash: string, staleSince: string, affectedCallerCount: number }>, capped: boolean }
 * @response 403 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "Course not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { courseId } = await params;
    if (!courseId) {
      return NextResponse.json(
        { ok: false, error: "courseId is required" },
        { status: 400 },
      );
    }

    // Confirm the course exists before reading staleness — mirrors the
    // 404 contract of the sibling staleness-aggregate route.
    const exists = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    const { sections, capped } = await getSectionStaleness(courseId);

    return NextResponse.json({
      ok: true,
      sections: sections.map((row) => ({
        sectionKey: row.sectionKey,
        sectionHash: row.sectionHash,
        staleSince: row.staleSince.toISOString(),
        affectedCallerCount: row.affectedCallerCount,
      })),
      capped,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

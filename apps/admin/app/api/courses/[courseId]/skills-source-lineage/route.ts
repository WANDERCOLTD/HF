/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * Course-scoped route. The rule's path-param-IDOR class fires on the
 * `[courseId]` segment because the path bracket matches the heuristic,
 * but Course is the educator-owned authoring surface, not a per-learner
 * read. OPERATOR+ gate at requireAuth is the right boundary; there is
 * no STUDENT-readable shape of this data.
 */
/**
 * @api GET /api/courses/[courseId]/skills-source-lineage
 *
 * Sprint 3 SP3-B — Source Lineage lens data source. Returns the
 * COURSE_REFERENCE sources currently feeding the Skills Framework
 * projection for this course, with provenance + last-touched
 * timestamps so the educator can answer "where did this rubric come
 * from?" without leaving the page.
 *
 * Companion to `POST /api/courses/[courseId]/reproject-skills` (the
 * "Re-project" button on the lens). The GET surface is read-only —
 * fetches `PlaybookSource` rows + the Source rows they link to, with
 * `ContentAssertion.length` so the educator can see "how many
 * statements did this source produce".
 *
 * Auth: OPERATOR+ only. Authoring-side surface, not learner-readable.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

export interface SourceLineageEntry {
  /** Source.id — useful for follow-up actions or deep-links. */
  id: string;
  name: string;
  /** "COURSE_REFERENCE" / "COURSE_REFERENCE_CANONICAL" / "COURSE_REFERENCE_TUTOR_BRIEFING". */
  documentType: string;
  /** ISO timestamp of the most recent Source.updatedAt — the educator's
   *  signal that the source changed since the last projection. */
  updatedAt: string;
  /** Number of ContentAssertion rows produced from this source. */
  assertionCount: number;
}

export interface SkillsSourceLineageResponse {
  courseId: string;
  /** Playbook this course resolves to (single playbook per course in the
   *  current model; multi-variant courses get the most-recent active). */
  playbookId: string | null;
  sources: SourceLineageEntry[];
  /** True when no COURSE_REFERENCE source is linked — projection has
   *  nothing to work from. UI flips to the "link a course reference"
   *  empty state. */
  empty: boolean;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;

  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  // `courseId` is the Playbook UUID in the URL convention used across
  // the rest of /x/courses/*. Confirm the Playbook exists so a typo'd
  // URL gives a 404 not a misleading empty result.
  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!playbook) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  // Same filter as `runProjectionForPlaybook` — these are the document
  // types the projection layer consumes. Keeps the lineage in sync with
  // what re-projection will actually re-read.
  const links = await prisma.playbookSource.findMany({
    where: {
      playbookId: courseId,
      source: {
        documentType: {
          in: [
            "COURSE_REFERENCE",
            "COURSE_REFERENCE_CANONICAL",
            "COURSE_REFERENCE_TUTOR_BRIEFING",
          ],
        },
      },
    },
    select: {
      source: {
        select: {
          id: true,
          name: true,
          documentType: true,
          updatedAt: true,
          _count: { select: { assertions: true } },
        },
      },
    },
  });

  const sources: SourceLineageEntry[] = links
    .map((l) => l.source)
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      documentType: s.documentType,
      updatedAt: s.updatedAt.toISOString(),
      assertionCount: s._count.assertions,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    courseId,
    playbookId: courseId,
    sources,
    empty: sources.length === 0,
  } satisfies SkillsSourceLineageResponse);
}

/* eslint-disable hf-security/no-unscoped-caller-id-route --
 * Course-scoped write. OPERATOR+ gate at requireAuth. Not a per-learner
 * read; rule's path-param-IDOR heuristic doesn't apply.
 */
/**
 * @api POST /api/courses/[courseId]/reproject-skills
 *
 * Sprint 3 SP3-B — Re-project button on the Source Lineage lens.
 * Triggers `runProjectionForPlaybook(courseId)` so the educator can
 * pull the latest COURSE_REFERENCE content through projection without
 * leaving the page.
 *
 * The projection layer already handles all the side effects:
 *   - Idempotent upsert of `Parameter` + `BehaviorTarget` + `Goal` rows
 *   - `bumpPlaybookComposeTimestamp` post-tx (apply-projection.ts:866)
 *     so Preview re-renders staleness
 *   - Cascade fan-out to sibling playbooks sharing the curriculum
 *
 * This route is a thin wrapper — auth gate, course-exists check,
 * delegate, return counts.
 *
 * Auth: OPERATOR+ only. Mutates `Parameter`, `BehaviorTarget`, `Goal`,
 * and `CurriculumModule` for the playbook.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { runProjectionForPlaybook } from "@/lib/wizard/run-projection-for-playbook";

export interface ReprojectSkillsResponse {
  ok: true;
  courseId: string;
  appliedSourcesCount: number;
  skippedSourcesCount: number;
  /** Per-source result narrative — short summary the UI shows in a toast. */
  summary: string;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;

  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true },
  });
  if (!playbook) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const result = await runProjectionForPlaybook(courseId);

  const summary =
    result.appliedSources.length > 0
      ? `Re-projected from ${result.appliedSources.length} source${
          result.appliedSources.length === 1 ? "" : "s"
        }.`
      : "No sources were applied — see skipped reasons.";

  return NextResponse.json({
    ok: true as const,
    courseId,
    appliedSourcesCount: result.appliedSources.length,
    skippedSourcesCount: result.skippedSources.length,
    summary,
  } satisfies ReprojectSkillsResponse);
}

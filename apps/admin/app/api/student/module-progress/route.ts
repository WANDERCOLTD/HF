/**
 * @api GET /api/student/module-progress
 * @visibility internal
 * @scope student:read
 * @auth STUDENT (own caller) | OPERATOR+ (with ?callerId=)
 * @description Returns the resolved caller's `CallerModuleProgress` rows joined
 *   with `CurriculumModule` (id, slug, title). Used by the learner module
 *   picker (#242 Slice 3) to derive `completedModuleIds` and
 *   `inProgressModuleIds`.
 *
 *   Optional `?courseId=` filter scopes results to a specific course
 *   (Playbook). Without the filter, returns progress across ALL curricula
 *   the caller has touched — risk: same module slug across two courses
 *   bleeds completion state. Pass `courseId` whenever the caller is on a
 *   single-course context.
 *
 *   Mirror of `/api/callers/[callerId]/module-progress` for the student-
 *   scoped path family — STUDENT users have no path callerId, so they fetch
 *   via the session-resolving helper.
 *
 * @query courseId? — Playbook id; when present, results filtered to modules
 *   whose Curriculum's `playbookId` matches.
 * @response 200 { ok, progress: [{ moduleId, status, completedAt, module: { id, slug, title, sortOrder } }] }
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const { callerId } = auth;
  const courseId = request.nextUrl.searchParams.get("courseId");

  // #1177 Slice 6 — canonical PlaybookCurriculum join (variant-aware).
  const where: Prisma.CallerModuleProgressWhereInput = courseId
    ? {
        callerId,
        module: {
          curriculum: {
            playbookLinks: { some: { playbookId: courseId, role: "primary" } },
          },
        },
      }
    : { callerId };

  const progress = await prisma.callerModuleProgress.findMany({
    where,
    include: {
      module: {
        select: {
          id: true,
          slug: true,
          title: true,
          sortOrder: true,
        },
      },
    },
    orderBy: { module: { sortOrder: "asc" } },
  });

  return NextResponse.json({ ok: true, progress });
}

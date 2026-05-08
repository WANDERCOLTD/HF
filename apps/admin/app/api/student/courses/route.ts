/**
 * @api GET /api/student/courses
 * @visibility public
 * @scope student:read
 * @auth STUDENT | OPERATOR+ (with callerId param)
 * @tags student, courses
 * @description List all course enrollments for the authenticated student. Returns playbook metadata, status, session count, and active goal count.
 * @response 200 { ok: true, enrollments: Enrollment[] }
 * @response 401/403 auth error
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentOrAdmin, isStudentAuthError } from "@/lib/student-access";

export async function GET(request: NextRequest) {
  const auth = await requireStudentOrAdmin(request);
  if (isStudentAuthError(auth)) return auth.error;

  const { callerId } = auth;

  const enrollments = await prisma.callerPlaybook.findMany({
    where: { callerId },
    include: {
      playbook: {
        select: {
          id: true,
          name: true,
          domain: {
            select: { name: true },
          },
        },
      },
    },
    orderBy: [
      { status: "asc" }, // ACTIVE first
      { enrolledAt: "desc" },
    ],
  });

  // Get call counts and active goal counts per playbook in parallel
  const playbookIds = enrollments.map((e) => e.playbookId);

  const [callCounts, goalCounts] = await Promise.all([
    prisma.call.groupBy({
      by: ["playbookId"],
      where: { callerId, playbookId: { in: playbookIds } },
      _count: { id: true },
    }),
    prisma.goal.groupBy({
      by: ["playbookId"],
      where: { callerId, playbookId: { in: playbookIds }, status: "ACTIVE" },
      _count: { id: true },
    }),
  ]);

  const callCountMap = new Map(callCounts.map((c) => [c.playbookId, c._count.id]));
  const goalCountMap = new Map(goalCounts.map((g) => [g.playbookId!, g._count.id]));

  const result = enrollments.map((e) => ({
    id: e.id,
    playbookId: e.playbookId,
    courseName: e.playbook.name || "Untitled Course",
    institutionName: e.playbook.domain?.name || null,
    status: e.status,
    isDefault: e.isDefault,
    enrolledAt: e.enrolledAt.toISOString(),
    completedAt: e.completedAt?.toISOString() || null,
    sessionCount: callCountMap.get(e.playbookId) || 0,
    activeGoals: goalCountMap.get(e.playbookId) || 0,
  }));

  return NextResponse.json({ ok: true, enrollments: result });
}

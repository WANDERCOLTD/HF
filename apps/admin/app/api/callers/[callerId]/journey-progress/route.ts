import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

type Params = { params: Promise<{ callerId: string }> };

/**
 * @api GET /api/callers/:callerId/journey-progress
 * @visibility internal
 * @scope callers:read
 * @auth session (VIEWER+)
 * @tags callers, journey, progress
 * @description Returns per-enrollment journey progress for a caller. Scheduler owns pacing —
 *   sessions array is empty (deprecated), callCount tracks total calls per enrollment.
 * @response 200 { ok: true, enrollments: EnrollmentJourney[] }
 * @response 404 { ok: false, error: "Caller not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;


  // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
  // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
  // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }
  // 1. Verify caller exists
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json({ ok: false, error: "Caller not found" }, { status: 404 });
  }

  // 2. Get active enrollments with playbook → subjects → curriculum
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { callerId },
    select: {
      id: true,
      playbookId: true,
      status: true,
      playbook: {
        select: {
          id: true,
          name: true,
          domainId: true,
          subjects: {
            select: { subjectId: true },
          },
        },
      },
    },
    orderBy: { enrolledAt: "asc" },
  });

  if (enrollments.length === 0) {
    return NextResponse.json({ ok: true, enrollments: [] });
  }

  // 3. Get call count per playbook for progress display
  const callCounts = await prisma.call.groupBy({
    by: ["playbookId"],
    where: {
      callerId,
      playbookId: { in: enrollments.map((e) => e.playbookId) },
    },
    _count: true,
  });
  const countByPlaybook = new Map(callCounts.map((c) => [c.playbookId, c._count]));

  // 4. Assemble response — sessions array empty (scheduler owns pacing)
  const result = enrollments.map((enr) => ({
    enrollmentId: enr.id,
    playbookId: enr.playbookId,
    playbookName: enr.playbook.name,
    status: enr.status,
    sessions: [], // deprecated — scheduler owns pacing
    currentSession: null, // deprecated
    totalSessions: 0, // deprecated
    callCount: countByPlaybook.get(enr.playbookId) ?? 0,
  }));

  return NextResponse.json({ ok: true, enrollments: result });
}

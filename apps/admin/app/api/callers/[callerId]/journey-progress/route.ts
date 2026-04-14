import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

type Params = { params: Promise<{ callerId: string }> };

/**
 * @api GET /api/callers/:callerId/journey-progress
 * @visibility internal
 * @scope callers:read
 * @auth session (VIEWER+)
 * @tags callers, journey, progress
 * @description Returns per-enrollment journey progress for a caller: lesson plan sessions +
 *   current session position. Used by the Guide lens ProgressStackCard and Explore lens
 *   enrollment rows to show DotRail progress.
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

  // 3. For each enrollment, resolve subjects → curriculum → lesson plan
  //    Batch: collect all subject IDs, fetch all curricula at once
  const allSubjectIds = new Set<string>();
  const enrollmentSubjectMap = new Map<string, string[]>();

  for (const enr of enrollments) {
    const subjectIds = enr.playbook.subjects.map((ps) => ps.subjectId);
    if (subjectIds.length > 0) {
      enrollmentSubjectMap.set(enr.playbookId, subjectIds);
      for (const id of subjectIds) allSubjectIds.add(id);
    }
  }

  // Also handle domain fallback for enrollments with no PlaybookSubject
  const enrollmentsNeedingFallback = enrollments.filter(
    (e) => !enrollmentSubjectMap.has(e.playbookId),
  );
  if (enrollmentsNeedingFallback.length > 0) {
    const domainIds = [...new Set(enrollmentsNeedingFallback.map((e) => e.playbook.domainId).filter(Boolean))] as string[];
    if (domainIds.length > 0) {
      const domainSubjects = await prisma.subjectDomain.findMany({
        where: { domainId: { in: domainIds } },
        select: { subjectId: true, domainId: true },
      });
      for (const enr of enrollmentsNeedingFallback) {
        const sids = domainSubjects
          .filter((ds) => ds.domainId === enr.playbook.domainId)
          .map((ds) => ds.subjectId);
        if (sids.length > 0) {
          enrollmentSubjectMap.set(enr.playbookId, sids);
          for (const id of sids) allSubjectIds.add(id);
        }
      }
    }
  }

  // 4. Batch fetch all curricula with lesson plans
  const curricula = allSubjectIds.size > 0
    ? await prisma.curriculum.findMany({
        where: { subjectId: { in: [...allSubjectIds] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          subjectId: true,
          deliveryConfig: true,
        },
      })
    : [];

  // Index: subjectId → first curriculum with a lesson plan
  const curriculumBySubject = new Map<string, { id: string; entries: Record<string, unknown>[] }>();
  for (const c of curricula) {
    if (curriculumBySubject.has(c.subjectId)) continue; // first wins (newest)
    const dc = c.deliveryConfig as Record<string, unknown> | null;
    const plan = dc?.lessonPlan as Record<string, unknown> | undefined;
    const entries = plan?.entries as Record<string, unknown>[] | undefined;
    if (entries?.length) {
      curriculumBySubject.set(c.subjectId, {
        id: c.id,
        entries,
      });
    }
  }

  // 5. Get current_session CallerAttribute for this caller
  const sessionAttrs = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      key: { contains: ":current_session" },
      scope: "CURRICULUM",
    },
    select: { key: true, numberValue: true },
  });

  // key pattern: "curriculum:{specSlug}:current_session"
  const currentSessionByKey = new Map<string, number>();
  for (const attr of sessionAttrs) {
    if (attr.numberValue !== null) {
      currentSessionByKey.set(attr.key, Math.round(attr.numberValue));
    }
  }

  // 6. Assemble response
  const result = enrollments.map((enr) => {
    const subjectIds = enrollmentSubjectMap.get(enr.playbookId) || [];

    // Find the first subject that has a curriculum with a lesson plan
    let sessions: Array<{
      session: number;
      type: string;
      label: string;
      moduleLabel: string;
      estimatedDurationMins: number | null;
    }> = [];
    for (const sid of subjectIds) {
      const curr = curriculumBySubject.get(sid);
      if (curr) {
        sessions = curr.entries.map((e) => ({
          session: Number(e.session),
          type: String(e.type ?? ""),
          label: String(e.label || e.title || `Session ${e.session}`),
          moduleLabel: String(e.moduleLabel ?? ""),
          estimatedDurationMins: e.estimatedDurationMins != null ? Number(e.estimatedDurationMins) : e.durationMins != null ? Number(e.durationMins) : null,
        }));
        break;
      }
    }

    // Resolve currentSession — match any key for this caller
    // The key pattern is "curriculum:{specSlug}:current_session" but we don't know the specSlug
    // So we take the first matching session attribute (callers typically have one active curriculum)
    let currentSession: number | null = null;
    for (const [, value] of currentSessionByKey) {
      currentSession = value;
      break;
    }

    return {
      enrollmentId: enr.id,
      playbookId: enr.playbookId,
      playbookName: enr.playbook.name,
      status: enr.status,
      sessions,
      currentSession,
      totalSessions: sessions.length,
    };
  });

  return NextResponse.json({ ok: true, enrollments: result });
}

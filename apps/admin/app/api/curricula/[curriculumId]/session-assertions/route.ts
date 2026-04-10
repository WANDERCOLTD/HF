import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";
import { assertionMatchesAnyLoRef } from "@/lib/lesson-plan/lo-ref-match";

type Params = { params: Promise<{ curriculumId: string }> };

// ── Types ──────────────────────────────────────────────

interface AssertionSummary {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  topicSlug: string | null;
  depth: number | null;
}

interface SessionGroup {
  session: number;
  label: string;
  type: string;
  assertions: AssertionSummary[];
}

// ── GET — Assertions grouped by lesson plan session ────

/**
 * @api GET /api/curricula/:curriculumId/session-assertions
 * @visibility internal
 * @scope curricula:read
 * @auth session (VIEWER+)
 * @tags curricula, lesson-plan, assertions
 * @description Returns content assertions grouped by lesson plan session.
 *   Uses explicit assertionIds (educator-curated) when available,
 *   falls back to learningOutcomeRefs matching (AI-assigned).
 *   Unassigned assertions are returned separately.
 * @query courseId string - Optional: playbook ID for robust source resolution via getSubjectsForPlaybook
 * @response 200 { ok, sessions, unassigned, total }
 * @response 404 { ok: false, error: "Curriculum not found" }
 */
export async function GET(
  req: NextRequest,
  { params }: Params,
) {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { curriculumId } = await params;
    const courseId = new URL(req.url).searchParams.get("courseId");

    // Load curriculum with lesson plan and subject link
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: {
        id: true,
        deliveryConfig: true,
        subjectId: true,
      },
    });

    if (!curriculum) {
      return NextResponse.json({ ok: false, error: "Curriculum not found" }, { status: 404 });
    }

    // Extract lesson plan entries
    const dc = (curriculum.deliveryConfig && typeof curriculum.deliveryConfig === "object")
      ? curriculum.deliveryConfig as Record<string, any>
      : {};
    const lessonPlan = dc.lessonPlan;
    const entries: any[] = lessonPlan?.entries || [];

    if (entries.length === 0) {
      return NextResponse.json({
        ok: true,
        sessions: {},
        unassigned: [],
        total: 0,
      });
    }

    // ── Resolve source IDs ──────────────────────────────
    // Use getSubjectsForPlaybook (same path as content-breakdown) when courseId is provided.
    // Falls back to direct SubjectSource query via curriculum.subjectId.
    const sourceIds = await resolveSourceIds(courseId, curriculum.subjectId);

    if (sourceIds.length === 0) {
      return NextResponse.json({
        ok: true,
        sessions: Object.fromEntries(
          entries.map((e: any) => [e.session, {
            session: e.session,
            label: e.label,
            type: e.type,
            assertions: [],
          }]),
        ),
        unassigned: [],
        total: 0,
      });
    }

    const assertions = await prisma.contentAssertion.findMany({
      where: { sourceId: { in: sourceIds } },
      select: {
        id: true,
        assertion: true,
        category: true,
        teachMethod: true,
        learningOutcomeRef: true,
        topicSlug: true,
        depth: true,
      },
      orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    });

    if (assertions.length === 0) {
      return NextResponse.json({
        ok: true,
        sessions: Object.fromEntries(
          entries.map((e: any) => [e.session, {
            session: e.session,
            label: e.label,
            type: e.type,
            assertions: [],
          }]),
        ),
        unassigned: [],
        total: 0,
      });
    }

    // Build assertion lookup
    const assertionMap = new Map(assertions.map((a) => [a.id, a]));
    const assignedIds = new Set<string>();
    const sessions: Record<number, SessionGroup> = {};

    for (const entry of entries) {
      const sessionGroup: SessionGroup = {
        session: entry.session,
        label: entry.label || `Session ${entry.session}`,
        type: entry.type || "introduce",
        assertions: [],
      };

      // Priority 1: Explicit assertionIds (educator-curated)
      if (Array.isArray(entry.assertionIds) && entry.assertionIds.length > 0) {
        for (const id of entry.assertionIds) {
          const a = assertionMap.get(id);
          if (a) {
            sessionGroup.assertions.push(toSummary(a));
            assignedIds.add(id);
          }
        }
      }
      // Priority 2: Match via learningOutcomeRefs (AI-assigned)
      else if (Array.isArray(entry.learningOutcomeRefs) && entry.learningOutcomeRefs.length > 0) {
        const loRefs = entry.learningOutcomeRefs as string[];
        for (const a of assertions) {
          if (assignedIds.has(a.id)) continue;
          if (assertionMatchesAnyLoRef(a.learningOutcomeRef, loRefs)) {
            sessionGroup.assertions.push(toSummary(a));
            assignedIds.add(a.id);
          }
        }
      }

      sessions[entry.session] = sessionGroup;
    }

    // Collect unassigned
    const unassigned: AssertionSummary[] = assertions
      .filter((a) => !assignedIds.has(a.id))
      .map(toSummary);

    return NextResponse.json({
      ok: true,
      sessions,
      unassigned,
      total: assertions.length,
    });
  } catch (error: any) {
    console.error("[curricula/:id/session-assertions] GET error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────

function toSummary(a: {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  topicSlug: string | null;
  depth: number | null;
}): AssertionSummary {
  return {
    id: a.id,
    assertion: a.assertion.length > 120 ? a.assertion.slice(0, 117) + "..." : a.assertion,
    category: a.category,
    teachMethod: a.teachMethod,
    learningOutcomeRef: a.learningOutcomeRef,
    topicSlug: a.topicSlug,
    depth: a.depth,
  };
}

/**
 * Resolve content source IDs with 2-tier lookup:
 * 1. Course-scoped: PlaybookSubject → Subject → SubjectSource (precise)
 * 2. Direct SubjectSource via curriculum.subjectId (original behavior)
 *
 * If both return empty, that's the correct answer — the data needs fixing
 * (SubjectSource rows missing for the course's linked subject).
 */
async function resolveSourceIds(
  courseId: string | null,
  subjectId: string | null,
): Promise<string[]> {
  // Tier 1: Course-aware resolution (PlaybookSubject → Subject → SubjectSource)
  if (courseId) {
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { domainId: true },
    });
    if (playbook?.domainId) {
      const { subjects } = await getSubjectsForPlaybook(courseId, playbook.domainId);
      const ids = [...new Set(subjects.flatMap((s) => s.sources.map((ss) => ss.sourceId)))];
      if (ids.length > 0) return ids;
    }
  }

  // Tier 2: Direct SubjectSource query (original behavior)
  if (subjectId) {
    const subjectSources = await prisma.subjectSource.findMany({
      where: { subjectId },
      select: { sourceId: true },
    });
    return subjectSources.map((ss) => ss.sourceId);
  }

  return [];
}

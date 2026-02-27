import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

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
 * @response 200 { ok, sessions, unassigned, total }
 * @response 404 { ok: false, error: "Curriculum not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: Params,
) {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { curriculumId } = await params;

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

    // Load all assertions for this curriculum's subject
    if (!curriculum.subjectId) {
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
      where: {
        source: {
          subjects: { some: { subjectId: curriculum.subjectId } },
        },
      },
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
          if (!a.learningOutcomeRef) continue;
          const matches = loRefs.some((ref) => a.learningOutcomeRef!.includes(ref));
          if (matches) {
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";
import {
  assertionMatchesAnyLoRef,
  loRefsMatch,
} from "@/lib/lesson-plan/lo-ref-match";
import { isContentBearingSession } from "@/lib/lesson-plan/session-ui";

type Params = { params: Promise<{ courseId: string; sessionNum: string }> };

// ── Response shape ─────────────────────────────────────

interface LOShort {
  ref: string;
  description: string;
}

interface DeepDetailTP {
  id: string;
  assertion: string; // full text, no truncation
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  reviewedAt: string | null;
  reviewer: { id: string; name: string | null; email: string } | null;
  source: { id: string; name: string };
  questionCount: number;
}

interface DeepDetailQuestion {
  id: string;
  questionText: string;
  questionType: string;
  bloomLevel: string | null;
  difficulty: number | null;
  options: { label?: string; text: string; isCorrect?: boolean }[] | null;
  correctAnswer: string | null;
  assertionId: string | null;
}

interface DeepDetailSession {
  number: number;
  type: string;
  label: string;
  notes: string | null;
  moduleLabel: string | null;
  estimatedDurationMins: number | null;
  learningOutcomeRefs: string[];
}

interface DeepDetailData {
  session: DeepDetailSession;
  learningObjectives: LOShort[];
  tps: DeepDetailTP[];
  questions: DeepDetailQuestion[];
  reviewed: number;
  total: number;
}

// ── GET — Deep detail for a single lesson plan session ─

/**
 * @api GET /api/courses/:courseId/sessions/:sessionNum/deep-detail
 * @visibility internal
 * @scope courses:read
 * @auth session (VIEWER+)
 * @tags courses, lesson-plan, sessions, assertions, questions
 * @description Returns rich detail for a single lesson plan session — full teaching
 *   point text, linked questions (MCQs / short answer / vocab), parent learning objective
 *   descriptions, and review status. Used by the Journey rail's inline session expand to
 *   "unpack" deep content without opening an overlay. Only returns data for content-bearing
 *   session types (not surveys / onboarding / offboarding). LO matching uses word-boundary
 *   matcher to avoid LO1/LO10 collisions.
 * @pathParam courseId string - Playbook UUID
 * @pathParam sessionNum string - 1-based session index within the lesson plan
 * @response 200 { ok, data }
 * @response 400 { ok: false, error: "Invalid session number" }
 * @response 404 { ok: false, error: "Course not found" | "Session not found" | "Not a content-bearing session" }
 */
export async function GET(
  _req: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  try {
    const auth = await requireAuth("VIEWER");
    if (isAuthError(auth)) return auth.error;

    const { courseId, sessionNum } = await params;
    const sessionNumber = Number(sessionNum);
    if (!Number.isFinite(sessionNumber) || sessionNumber < 1) {
      return NextResponse.json(
        { ok: false, error: "Invalid session number" },
        { status: 400 },
      );
    }

    // 1. Course + domain
    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: { id: true, domainId: true },
    });
    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 },
      );
    }

    // 2. Find the curriculum with a lesson plan for this course
    const { subjects } = await getSubjectsForPlaybook(courseId, playbook.domainId);
    const subjectIds = [...new Set(subjects.map((s) => s.id))];
    const sourceIds = [...new Set(subjects.flatMap((s) => s.sources.map((ss) => ss.sourceId)))];

    if (subjectIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 },
      );
    }

    const curricula = await prisma.curriculum.findMany({
      where: { subjectId: { in: subjectIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deliveryConfig: true,
        modules: {
          where: { isActive: true },
          select: {
            id: true,
            slug: true,
            title: true,
            learningObjectives: {
              select: { ref: true, description: true },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    // Find the first curriculum with a lesson plan that contains this session
    type LessonPlanEntryRaw = {
      session: number;
      type: string;
      label?: string;
      notes?: string | null;
      moduleLabel?: string | null;
      estimatedDurationMins?: number | null;
      learningOutcomeRefs?: string[];
      assertionIds?: string[];
    };
    let entry: LessonPlanEntryRaw | null = null;
    const moduleMap = new Map<string, { slug: string; title: string; learningObjectives: LOShort[] }>();
    for (const c of curricula) {
      const dc = c.deliveryConfig as Record<string, unknown> | null;
      const lessonPlan = dc?.lessonPlan as { entries?: LessonPlanEntryRaw[] } | undefined;
      const entries: LessonPlanEntryRaw[] = lessonPlan?.entries ?? [];
      const found = entries.find((e) => e.session === sessionNumber);
      if (found) {
        entry = found;
        for (const m of c.modules) {
          moduleMap.set(m.id, {
            slug: m.slug,
            title: m.title,
            learningObjectives: m.learningObjectives.map((lo) => ({
              ref: lo.ref,
              description: lo.description,
            })),
          });
        }
        break;
      }
    }

    if (!entry) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 },
      );
    }

    if (!isContentBearingSession(entry.type)) {
      return NextResponse.json(
        { ok: false, error: "Not a content-bearing session" },
        { status: 404 },
      );
    }

    // 3. Resolve parent LO descriptions for this session
    const sessionLoRefs: string[] = Array.isArray(entry.learningOutcomeRefs)
      ? entry.learningOutcomeRefs
      : [];

    // Join session's loRefs against the module's LearningObjective list,
    // using word-boundary match so "LO2" matches "R04-LO2-AC2.3" but not "LO20".
    const learningObjectives: LOShort[] = [];
    const seenLoRefs = new Set<string>();
    for (const [, mod] of moduleMap) {
      for (const lo of mod.learningObjectives) {
        if (seenLoRefs.has(lo.ref)) continue;
        if (sessionLoRefs.some((ref) => loRefsMatch(lo.ref, ref))) {
          learningObjectives.push(lo);
          seenLoRefs.add(lo.ref);
        }
      }
    }

    // 4. Load TPs for this session (by assertionIds or LO ref match)
    if (sourceIds.length === 0) {
      return NextResponse.json({
        ok: true,
        data: buildEmptyData(sessionNumber, entry, learningObjectives),
      });
    }

    const allAssertions = await prisma.contentAssertion.findMany({
      where: { sourceId: { in: sourceIds } },
      select: {
        id: true,
        assertion: true,
        category: true,
        teachMethod: true,
        learningOutcomeRef: true,
        reviewedAt: true,
        sourceId: true,
        source: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true, email: true } },
        _count: { select: { questions: true } },
      },
      orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    });

    let sessionAssertions: typeof allAssertions = [];
    if (Array.isArray(entry.assertionIds) && entry.assertionIds.length > 0) {
      const idSet = new Set<string>(entry.assertionIds);
      sessionAssertions = allAssertions.filter((a) => idSet.has(a.id));
    } else if (sessionLoRefs.length > 0) {
      sessionAssertions = allAssertions.filter((a) =>
        assertionMatchesAnyLoRef(a.learningOutcomeRef, sessionLoRefs),
      );
    }

    // 5. Load questions for those TPs
    const tpIds = sessionAssertions.map((a) => a.id);
    const questions = tpIds.length > 0
      ? await prisma.contentQuestion.findMany({
          where: { assertionId: { in: tpIds } },
          select: {
            id: true,
            questionText: true,
            questionType: true,
            bloomLevel: true,
            difficulty: true,
            options: true,
            correctAnswer: true,
            assertionId: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: "asc" }],
        })
      : [];

    // 6. Build response
    const tps: DeepDetailTP[] = sessionAssertions.map((a) => ({
      id: a.id,
      assertion: a.assertion,
      category: a.category,
      teachMethod: a.teachMethod,
      learningOutcomeRef: a.learningOutcomeRef,
      reviewedAt: a.reviewedAt ? a.reviewedAt.toISOString() : null,
      reviewer: a.reviewer
        ? { id: a.reviewer.id, name: a.reviewer.name, email: a.reviewer.email }
        : null,
      source: a.source,
      questionCount: a._count.questions,
    }));

    const responseQuestions: DeepDetailQuestion[] = questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      bloomLevel: q.bloomLevel ?? null,
      difficulty: q.difficulty,
      options: normalizeOptions(q.options),
      correctAnswer: q.correctAnswer,
      assertionId: q.assertionId,
    }));

    const reviewed = tps.filter((t) => t.reviewedAt !== null).length;

    const data: DeepDetailData = {
      session: {
        number: entry.session,
        type: entry.type,
        label: entry.label || `Session ${entry.session}`,
        notes: entry.notes || null,
        moduleLabel: entry.moduleLabel || null,
        estimatedDurationMins: entry.estimatedDurationMins ?? null,
        learningOutcomeRefs: sessionLoRefs,
      },
      learningObjectives,
      tps,
      questions: responseQuestions,
      reviewed,
      total: tps.length,
    };

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error(
      "[courses/:id/sessions/:sessionNum/deep-detail] GET error:",
      error,
    );
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────

interface LessonPlanEntryLike {
  session: number;
  type: string;
  label?: string;
  notes?: string | null;
  moduleLabel?: string | null;
  estimatedDurationMins?: number | null;
  learningOutcomeRefs?: string[];
  assertionIds?: string[];
}

function buildEmptyData(
  sessionNumber: number,
  entry: LessonPlanEntryLike,
  learningObjectives: LOShort[],
): DeepDetailData {
  return {
    session: {
      number: sessionNumber,
      type: entry.type,
      label: entry.label || `Session ${sessionNumber}`,
      notes: entry.notes || null,
      moduleLabel: entry.moduleLabel || null,
      estimatedDurationMins: entry.estimatedDurationMins ?? null,
      learningOutcomeRefs: Array.isArray(entry.learningOutcomeRefs)
        ? entry.learningOutcomeRefs
        : [],
    },
    learningObjectives,
    tps: [],
    questions: [],
    reviewed: 0,
    total: 0,
  };
}

/**
 * ContentQuestion.options is stored as Prisma JSON. Normalise to the runtime shape
 * the UI expects. Returns null when no options (non-MCQ types).
 */
function normalizeOptions(
  raw: unknown,
): { label?: string; text: string; isCorrect?: boolean }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { label?: string; text: string; isCorrect?: boolean }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text : null;
    if (text === null) continue;
    out.push({
      label: typeof rec.label === "string" ? rec.label : undefined,
      text,
      isCorrect: rec.isCorrect === true ? true : undefined,
    });
  }
  return out.length > 0 ? out : null;
}

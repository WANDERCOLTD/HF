import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { generateLessonPlan, consolidateSessions, type LessonPlan, type LessonSession, type SessionSource } from "@/lib/content-trust/lesson-planner";
import { getLessonPlanModel } from "@/lib/lesson-plan/models";

/**
 * @api POST /api/lesson-plan/generate
 * @visibility internal
 * @scope lesson-plan:write
 * @auth OPERATOR
 * @tags lesson-plan, content-trust
 * @description Generate a multi-subject lesson plan using the content trust lesson planner.
 *   Resolves sourceIds from subjects, generates per-source plans in parallel,
 *   then merges sessions sequentially with assessment + review at the end.
 * @body { subjectIds: string[], sessionLength?: number, lessonPlanModel?: string, targetSessionCount?: number }
 * @response 200 { ok, plan: LessonPlan }
 * @response 400 { ok: false, error: "..." }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await req.json();
    const { subjectIds, sessionLength = 30, lessonPlanModel, targetSessionCount } = body;
    const modelConfig = getLessonPlanModel(lessonPlanModel);

    if (!Array.isArray(subjectIds) || subjectIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "subjectIds must be a non-empty array" },
        { status: 400 },
      );
    }

    // Resolve sourceIds from subjects via SubjectSource join
    const subjectSources = await prisma.subjectSource.findMany({
      where: { subjectId: { in: subjectIds } },
      select: { sourceId: true },
    });

    const sourceIds = [...new Set(subjectSources.map((ss) => ss.sourceId))];

    if (sourceIds.length === 0) {
      return NextResponse.json({
        ok: true,
        plan: {
          totalSessions: 0,
          estimatedMinutesPerSession: sessionLength,
          sessions: [],
          prerequisites: [],
          generatedAt: new Date().toISOString(),
        },
      });
    }

    // Apply model's cognitive load cap: maxTpsPerSession × ~3min/TP, capped at sessionLength
    const maxTpsPerSession = modelConfig.defaults.maxTpsPerSession ?? 10;
    const effectiveSessionLength = Math.min(sessionLength, maxTpsPerSession * 3);

    // Look up source metadata for timeline display (doc icons + names)
    const sourceMetaRows = await prisma.contentSource.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, name: true, documentType: true },
    });
    const sourceMeta = new Map<string, SessionSource>(
      sourceMetaRows.map((s) => [s.id, { id: s.id, name: s.name, documentType: s.documentType ?? "TEXTBOOK" }]),
    );

    // Generate per-source plans in parallel — catch per-source so partial results merge
    const warnings: string[] = [];
    const perSourcePlans = await Promise.all(
      sourceIds.map(async (sourceId) => {
        try {
          const plan = await generateLessonPlan(sourceId, {
            sessionLength: effectiveSessionLength,
            includeAssessment: false,
            includeReview: false,
          });
          // Stamp source info onto each session for timeline display
          const src = sourceMeta.get(sourceId);
          if (src) {
            for (const session of plan.sessions) {
              session.sources = [src];
            }
          }
          return plan;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          warnings.push(`Source ${sourceId}: ${msg}`);
          return null;
        }
      }),
    );

    // Merge sessions from all successful plans
    const allSessions: LessonSession[] = [];
    let sessionNumber = 1;

    for (const plan of perSourcePlans) {
      if (!plan || plan.sessions.length === 0) continue;
      for (const session of plan.sessions) {
        allSessions.push({
          ...session,
          sessionNumber,
          // Map "practice" → "deepen" for curriculum persistence compatibility
          sessionType: session.sessionType === "practice"
            ? "introduce" // practice maps to introduce for now; deepen isn't a valid lesson-planner type
            : session.sessionType,
        });
        sessionNumber++;
      }
    }

    if (allSessions.length === 0) {
      // All sources failed
      if (warnings.length > 0) {
        return NextResponse.json(
          { ok: false, error: `All sources failed: ${warnings.join("; ")}` },
          { status: 500 },
        );
      }
      return NextResponse.json({
        ok: true,
        plan: {
          totalSessions: 0,
          estimatedMinutesPerSession: sessionLength,
          sessions: [],
          prerequisites: [],
          generatedAt: new Date().toISOString(),
        },
      });
    }

    // Consolidate small sessions into session-length blocks
    const consolidated = consolidateSessions(allSessions, {
      sessionLength: effectiveSessionLength,
      targetSessionCount: targetSessionCount ?? undefined,
    });
    allSessions.length = 0;
    allSessions.push(...consolidated);
    sessionNumber = allSessions.length + 1;

    // Append combined assessment session
    const allQuestionIds = allSessions.flatMap((s) => s.questionIds);
    if (allQuestionIds.length > 0) {
      allSessions.push({
        sessionNumber,
        title: "Assessment",
        objectives: ["Review and assess understanding of all topics"],
        assertionIds: [],
        questionIds: allQuestionIds,
        vocabularyIds: [],
        estimatedMinutes: Math.min(effectiveSessionLength, allQuestionIds.length * 3),
        sessionType: "assess",
      });
      sessionNumber++;
    }

    // Append review session if enough content
    if (allSessions.length > 2) {
      const allAssertionIds = allSessions.flatMap((s) => s.assertionIds);
      const allVocabIds = allSessions.flatMap((s) => s.vocabularyIds);
      allSessions.push({
        sessionNumber,
        title: "Review & Consolidation",
        objectives: ["Review key concepts", "Address gaps and misconceptions"],
        assertionIds: allAssertionIds.slice(0, 50), // cap to avoid huge payloads
        questionIds: [],
        vocabularyIds: allVocabIds,
        estimatedMinutes: effectiveSessionLength,
        sessionType: "review",
      });
    }

    // Build prerequisite links
    const prerequisites = allSessions
      .filter((s) => s.sessionNumber > 1)
      .map((s) => ({
        sessionNumber: s.sessionNumber,
        requiresSession: s.sessionNumber - 1,
        reason: "Sequential topic progression",
      }));

    const plan: LessonPlan = {
      totalSessions: allSessions.length,
      estimatedMinutesPerSession: effectiveSessionLength,
      sessions: allSessions,
      prerequisites,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json({
      ok: true,
      plan,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error: unknown) {
    console.error("[lesson-plan/generate] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to generate lesson plan" },
      { status: 500 },
    );
  }
}

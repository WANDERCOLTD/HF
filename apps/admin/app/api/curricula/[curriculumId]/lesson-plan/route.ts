import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { Prisma } from "@prisma/client";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
} from "@/lib/ai/task-guidance";

type Params = { params: Promise<{ curriculumId: string }> };

// ── Types ──────────────────────────────────────────────

const VALID_SESSION_TYPES = [
  "onboarding",
  "introduce",
  "deepen",
  "review",
  "assess",
  "consolidate",
] as const;

interface LessonPlanMediaRef {
  mediaId: string;
  fileName?: string;
  captionText?: string | null;
  figureRef?: string | null;
  mimeType?: string;
}

interface LessonPlanEntry {
  session: number;
  type: string;
  moduleId: string | null;
  moduleLabel: string;
  label: string;
  notes?: string;
  estimatedDurationMins?: number;
  assertionCount?: number;
  assertionIds?: string[];
  learningOutcomeRefs?: string[];
  vocabularyIds?: string[];
  questionIds?: string[];
  /** Images linked to this session (auto-resolved or manually assigned) */
  media?: LessonPlanMediaRef[];
}

interface LessonPlan {
  estimatedSessions: number;
  entries: LessonPlanEntry[];
  generatedAt?: string;
  generatedFrom?: string;
}

// ── Helpers ────────────────────────────────────────────

function getDeliveryConfig(curriculum: { deliveryConfig: any }): Record<string, any> {
  if (curriculum.deliveryConfig && typeof curriculum.deliveryConfig === "object") {
    return curriculum.deliveryConfig as Record<string, any>;
  }
  return {};
}

function getLessonPlan(curriculum: { deliveryConfig: any }): LessonPlan | null {
  const dc = getDeliveryConfig(curriculum);
  return dc.lessonPlan || null;
}

function validateEntries(entries: any[]): string | null {
  if (!Array.isArray(entries) || entries.length === 0) {
    return "entries must be a non-empty array";
  }
  if (entries.length > 100) {
    return "Maximum 100 sessions in a lesson plan";
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.session !== i + 1) {
      return `Session numbers must be sequential starting at 1 (got ${e.session} at position ${i})`;
    }
    if (!VALID_SESSION_TYPES.includes(e.type)) {
      return `Invalid session type "${e.type}" at session ${e.session}. Valid: ${VALID_SESSION_TYPES.join(", ")}`;
    }
    if (!e.label || typeof e.label !== "string") {
      return `Missing label at session ${e.session}`;
    }
  }
  return null;
}

// ── GET — Read lesson plan ─────────────────────────────

/**
 * @api GET /api/curricula/:curriculumId/lesson-plan
 * @visibility public
 * @scope curricula:read
 * @auth session (VIEWER+)
 * @tags curricula, lesson-plan
 * @description Get the lesson plan for a curriculum. Returns null if no plan exists.
 * @response 200 { ok: true, plan: LessonPlan | null }
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

    const curriculum = await prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: { id: true, deliveryConfig: true },
    });

    if (!curriculum) {
      return NextResponse.json({ ok: false, error: "Curriculum not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, plan: getLessonPlan(curriculum) });
  } catch (error: any) {
    console.error("[curricula/:id/lesson-plan] GET error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// ── PUT — Save lesson plan ─────────────────────────────

/**
 * @api PUT /api/curricula/:curriculumId/lesson-plan
 * @visibility public
 * @scope curricula:write
 * @auth session (OPERATOR+)
 * @tags curricula, lesson-plan
 * @description Save or update the lesson plan. Validates session numbers and types.
 * @body { entries: LessonPlanEntry[] }
 * @response 200 { ok: true, plan: LessonPlan }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Curriculum not found" }
 */
export async function PUT(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { curriculumId } = await params;
    const body = await request.json();
    const { entries } = body;

    // Validate
    const validationError = validateEntries(entries);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    const curriculum = await prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: { id: true, deliveryConfig: true },
    });

    if (!curriculum) {
      return NextResponse.json({ ok: false, error: "Curriculum not found" }, { status: 404 });
    }

    // Merge lesson plan into existing deliveryConfig
    const existingDC = getDeliveryConfig(curriculum);
    const plan: LessonPlan = {
      estimatedSessions: entries.length,
      entries: entries.map((e: any, i: number) => ({
        session: i + 1,
        type: e.type,
        moduleId: e.moduleId || null,
        moduleLabel: e.moduleLabel || "",
        label: e.label,
        notes: e.notes || undefined,
        estimatedDurationMins: e.estimatedDurationMins || undefined,
        assertionCount: e.assertionCount || undefined,
        assertionIds: Array.isArray(e.assertionIds) ? e.assertionIds : undefined,
        learningOutcomeRefs: Array.isArray(e.learningOutcomeRefs) ? e.learningOutcomeRefs : undefined,
        phases: Array.isArray(e.phases) ? e.phases : undefined,
        questionCount: e.questionCount || undefined,
        vocabularyCount: e.vocabularyCount || undefined,
        vocabularyIds: Array.isArray(e.vocabularyIds) ? e.vocabularyIds : undefined,
        questionIds: Array.isArray(e.questionIds) ? e.questionIds : undefined,
        media: Array.isArray(e.media)
          ? e.media.filter((m: any) => m && typeof m.mediaId === "string").slice(0, 50)
          : undefined,
      })),
      generatedFrom: "manual",
    };

    await prisma.curriculum.update({
      where: { id: curriculumId },
      data: {
        deliveryConfig: { ...existingDC, lessonPlan: plan } as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ok: true, plan });
  } catch (error: any) {
    console.error("[curricula/:id/lesson-plan] PUT error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// ── Background: AI-generate lesson plan ────────────────

async function runBackgroundLessonPlanGeneration(
  curriculumId: string,
  taskId: string,
  totalSessionTarget: number | null,
  durationMins: number | null,
  emphasis: string,
  includeAssessments: string,
) {
  try {
    // Load curriculum with modules
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: {
        id: true,
        name: true,
        description: true,
        notableInfo: true,
        subjectId: true,
      },
    });

    if (!curriculum) {
      await updateTaskProgress(taskId, {
        context: { error: "Curriculum not found" },
      });
      return;
    }

    // Extract modules from notableInfo, falling back to CurriculumModule records
    const notableInfo = (curriculum.notableInfo as Record<string, any>) || {};
    let modules: any[] = notableInfo.modules || [];

    if (modules.length === 0) {
      // Fallback: load first-class CurriculumModule records from DB
      const dbModules = await prisma.curriculumModule.findMany({
        where: { curriculumId, isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          sortOrder: true,
          estimatedDurationMinutes: true,
          keyTerms: true,
          learningObjectives: {
            select: { description: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      modules = dbModules.map((m) => ({
        id: m.slug,
        title: m.title,
        description: m.description,
        sortOrder: m.sortOrder,
        estimatedDurationMinutes: m.estimatedDurationMinutes,
        keyTerms: m.keyTerms,
        learningOutcomes: m.learningObjectives.map((lo) => lo.description),
      }));
    }

    if (modules.length === 0) {
      await updateTaskProgress(taskId, {
        context: { error: "Curriculum has no modules. Generate the curriculum first." },
      });
      return;
    }

    // Count assertions per module topic (if we have subject linkage)
    const assertionCounts: Record<string, number> = {};
    if (curriculum.subjectId) {
      const assertions = await prisma.contentAssertion.groupBy({
        by: ["topicSlug"],
        where: {
          source: {
            subjects: { some: { subjectId: curriculum.subjectId } },
          },
          topicSlug: { not: null },
        },
        _count: true,
      });
      for (const group of assertions) {
        if (group.topicSlug) {
          assertionCounts[group.topicSlug] = group._count;
        }
      }
    }

    // Build module summary for AI
    const moduleSummary = modules.map((m: any, i: number) => {
      const count = assertionCounts[m.id] || assertionCounts[m.topicSlug] || 0;
      return `Module ${i + 1}: "${m.title}" (${m.learningOutcomes?.length || 0} LOs, ${count} assertions)`;
    }).join("\n");

    const targetHint = totalSessionTarget
      ? `The educator has requested EXACTLY ${totalSessionTarget} sessions total. You MUST return exactly ${totalSessionTarget} entries.${
          totalSessionTarget <= 4
            ? " With this few sessions, skip onboarding/consolidate/review — use only introduce and deepen types. Combine multiple modules into single sessions if needed."
            : totalSessionTarget <= 6
              ? " With few sessions, skip separate onboarding — fold the welcome into the first introduce session. Skip consolidate unless there are enough sessions."
              : ""
        }`
      : "Propose a reasonable number of sessions based on the content depth.";

    const durationHint = durationMins
      ? `Target session duration: ${durationMins} minutes. Adjust content density per session accordingly — shorter sessions need less content per session, longer sessions can cover more.`
      : "";

    const emphasisHint = emphasis === "breadth"
      ? "Teaching emphasis: BREADTH-FIRST. Cover all topics at surface level first with \"introduce\" sessions, then circle back with \"deepen\" sessions."
      : emphasis === "depth"
        ? "Teaching emphasis: DEPTH-FIRST. Go deep on each module before moving to the next — pair each \"introduce\" immediately with \"deepen\" sessions."
        : "Teaching emphasis: BALANCED. Mix breadth and depth as you see fit per module.";

    const assessmentHint = includeAssessments === "formal"
      ? "Include formal \"assess\" sessions — at least one mid-course assessment and one final assessment."
      : includeAssessments === "none"
        ? "Do NOT include any \"assess\" sessions. Skip formal assessments entirely."
        : "Include light assessment checks — one \"assess\" session near the end is sufficient.";

    const systemPrompt = `You are a curriculum planning assistant. Given a set of teaching modules, propose a structured lesson plan — an ordered sequence of call sessions that covers all modules effectively.

Rules:
- Each session has a type: onboarding (first session), introduce (first exposure to module), deepen (revisit module for mastery), review (consolidate multiple modules), assess (test knowledge), consolidate (final synthesis)
- ${targetHint}
- The session count target is the MOST IMPORTANT constraint. All other rules below are secondary and should be relaxed if they conflict with the target count.
- When sessions allow: first session should be onboarding, end with consolidate, include periodic review sessions every 3-4 modules
- Each module should have at least an "introduce" session, and larger modules (more assertions) should also have "deepen" sessions. If there are fewer sessions than modules, combine related modules into single sessions.
- ${durationHint}
- ${emphasisHint}
- ${assessmentHint}

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "reasoning": "Brief explanation of your plan structure",
  "entries": [
    { "session": 1, "type": "onboarding", "moduleId": null, "moduleLabel": "", "label": "Welcome + Background Probe" },
    { "session": 2, "type": "introduce", "moduleId": "MOD-1", "moduleLabel": "Module Name", "label": "Introduction to Module Name", "estimatedDurationMins": 30, "assertionCount": 23 },
    ...
  ]
}`;

    const userMessage = `Curriculum: "${curriculum.name}"
${curriculum.description ? `Description: ${curriculum.description}` : ""}

Modules:
${moduleSummary}

Total modules: ${modules.length}`;

    // @ai-call lesson-plan.generate — Generate structured lesson plan from curriculum modules | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion({
      callPoint: "lesson-plan.generate",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      maxTokens: 4000,
    });

    // Parse response
    const content = typeof result === "string" ? result : result?.content || "";
    let parsed: any;
    try {
      // Strip markdown fences if present
      const cleaned = content.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[lesson-plan] Failed to parse AI response:", content?.slice(0, 200));
      await updateTaskProgress(taskId, {
        context: { error: "AI did not return valid JSON. Try again." },
      });
      return;
    }

    // Build moduleId → learningOutcomes lookup from source modules
    const moduleLOMap: Record<string, string[]> = {};
    for (const m of modules) {
      if (m.id && Array.isArray(m.learningOutcomes)) {
        moduleLOMap[m.id] = m.learningOutcomes;
      }
    }

    const entries: LessonPlanEntry[] = (parsed.entries || []).map((e: any, i: number) => ({
      session: i + 1,
      type: VALID_SESSION_TYPES.includes(e.type) ? e.type : "introduce",
      moduleId: e.moduleId || null,
      moduleLabel: e.moduleLabel || "",
      label: e.label || `Session ${i + 1}`,
      notes: e.notes || undefined,
      estimatedDurationMins: e.estimatedDurationMins || undefined,
      assertionCount: e.assertionCount || undefined,
      assertionIds: [] as string[],
      // Set learningOutcomeRefs from module data so session-assertions can match via LO path
      learningOutcomeRefs: e.moduleId && moduleLOMap[e.moduleId]
        ? moduleLOMap[e.moduleId]
        : undefined,
    }));

    // Distribute content assertions across sessions (round-robin)
    // Use course-aware resolution (PlaybookSubject → Subject → SubjectSource),
    // falling back to direct SubjectSource via curriculum.subjectId
    const sourceIds = await resolveSourceIdsForGeneration(curriculumId, curriculum.subjectId);

    if (sourceIds.length > 0) {
      const assertions = await prisma.contentAssertion.findMany({
        where: { sourceId: { in: sourceIds } },
        select: { id: true },
        orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
      });

      if (assertions.length > 0) {
        const teachingSessions = entries.filter((e) => !["onboarding"].includes(e.type));
        const target = teachingSessions.length > 0 ? teachingSessions : entries;
        for (let i = 0; i < assertions.length; i++) {
          target[i % target.length].assertionIds!.push(assertions[i].id);
        }
      }
    }

    // Save result to task context
    await updateTaskProgress(taskId, {
      context: {
        plan: entries,
        estimatedSessions: entries.length,
        reasoning: parsed.reasoning || "",
      },
    });

    await completeTask(taskId);
  } catch (error: any) {
    console.error("[lesson-plan background] Error:", error);
    await failTask(taskId, error.message);
  }
}

/**
 * Resolve content source IDs for lesson plan generation.
 * Tier 1: Course-aware (PlaybookSubject → Subject → SubjectSource)
 * Tier 2: Direct SubjectSource via curriculum.subjectId
 */
async function resolveSourceIdsForGeneration(
  curriculumId: string,
  subjectId: string | null,
): Promise<string[]> {
  // Tier 1: Find playbook via curriculum → subject → playbookSubject
  const playbookSubject = await prisma.playbookSubject.findFirst({
    where: { subject: { curricula: { some: { id: curriculumId } } } },
    select: { playbookId: true, playbook: { select: { domainId: true } } },
  });
  if (playbookSubject?.playbook?.domainId) {
    const { subjects } = await getSubjectsForPlaybook(
      playbookSubject.playbookId,
      playbookSubject.playbook.domainId,
    );
    const ids = [...new Set(subjects.flatMap((s) => s.sources.map((ss) => ss.sourceId)))];
    if (ids.length > 0) return ids;
  }

  // Tier 2: Direct SubjectSource
  if (subjectId) {
    const subjectSources = await prisma.subjectSource.findMany({
      where: { subjectId },
      select: { sourceId: true },
    });
    return subjectSources.map((ss) => ss.sourceId);
  }

  return [];
}

// ── POST — AI-generate lesson plan (async) ─────────────

/**
 * @api POST /api/curricula/:curriculumId/lesson-plan
 * @visibility public
 * @scope curricula:write
 * @auth session (OPERATOR+)
 * @tags curricula, lesson-plan
 * @description Start AI-generation of a lesson plan from curriculum modules. Returns 202 with taskId to poll for progress.
 * @body { totalSessionTarget?: number, durationMins?: number, emphasis?: "breadth"|"depth"|"balanced", includeAssessments?: "formal"|"light"|"none" }
 * @response 202 { ok: true, taskId: string }
 * @response 400 { ok: false, error: "..." }
 * @response 404 { ok: false, error: "Curriculum not found" }
 */
export async function POST(
  request: NextRequest,
  { params }: Params,
) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const { curriculumId } = await params;
    const body = await request.json().catch(() => ({}));
    let emphasis: string = body.emphasis || "";
    let includeAssessments: string = body.includeAssessments || "";

    // Verify curriculum exists
    const curriculum = await prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: { id: true, notableInfo: true, subjectId: true },
    });

    if (!curriculum) {
      return NextResponse.json({ ok: false, error: "Curriculum not found" }, { status: 404 });
    }

    // If no explicit params in body, fall back to playbook config
    // (the "Regenerate Plan" button may send {} — read saved educator preferences)
    let totalSessionTarget: number | null = body.totalSessionTarget || null;
    let durationMins: number | null = body.durationMins || null;
    if ((!totalSessionTarget || !durationMins || !emphasis || !includeAssessments) && curriculum.subjectId) {
      const playbookSubject = await prisma.playbookSubject.findFirst({
        where: { subject: { curricula: { some: { id: curriculumId } } } },
        select: { playbook: { select: { config: true } } },
      });
      const config = (playbookSubject?.playbook?.config as Record<string, any>) || {};
      if (!totalSessionTarget && config.sessionCount) totalSessionTarget = Number(config.sessionCount);
      if (!durationMins && config.durationMins) durationMins = Number(config.durationMins);
      if (!emphasis && config.emphasis) emphasis = String(config.emphasis);
      if (!includeAssessments && config.assessments) includeAssessments = String(config.assessments);
    }
    // Final defaults
    if (!emphasis) emphasis = "balanced";
    if (!includeAssessments) includeAssessments = "light";

    // Check curriculum has modules
    const notableInfo = (curriculum.notableInfo as Record<string, any>) || {};
    const modules: any[] = notableInfo.modules || [];

    if (modules.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Curriculum has no modules. Generate the curriculum first." },
        { status: 400 },
      );
    }

    // Create task
    const taskId = await startTaskTracking(auth.session.user.id, "lesson_plan", {
      curriculumId,
      totalSessionTarget,
      durationMins,
      emphasis,
      includeAssessments,
    });

    // Fire background generation (no await)
    runBackgroundLessonPlanGeneration(
      curriculumId,
      taskId,
      totalSessionTarget,
      durationMins,
      emphasis,
      includeAssessments,
    ).catch(async (err) => {
      console.error("[lesson-plan] Background error:", err);
      await failTask(taskId, err.message);
    });

    return NextResponse.json(
      { ok: true, taskId },
      { status: 202 }
    );
  } catch (error: any) {
    console.error("[curricula/:id/lesson-plan] POST error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

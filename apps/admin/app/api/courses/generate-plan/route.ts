import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { generateCurriculumFromGoals } from "@/lib/content-trust/extract-curriculum";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
} from "@/lib/ai/task-guidance";
import { syncModulesToDB } from "@/lib/curriculum/sync-modules";

// ── Types ──────────────────────────────────────────────

const VALID_SESSION_TYPES = [
  "onboarding",
  "introduce",
  "deepen",
  "review",
  "assess",
  "consolidate",
] as const;

interface LessonPlanEntry {
  session: number;
  type: string;
  moduleId: string | null;
  moduleLabel: string;
  label: string;
  notes?: string;
  estimatedDurationMins?: number;
  assertionCount?: number;
}

// ── Background job ─────────────────────────────────────

const INTERACTION_PATTERN_SESSION_HINTS: Record<string, string> = {
  directive:    "Teaching style: DIRECTIVE. Prefer clear introduce → deepen → review progressions. Fewer open-ended sessions.",
  socratic:     "Teaching style: SOCRATIC. Include more deepen sessions for debate and exploration. Fewer rote introduce sessions; pair each topic introduction with a deeper questioning session.",
  advisory:     "Teaching style: ADVISORY. Structure sessions around case studies and compliance scenarios. Include assess sessions to verify understanding of rules.",
  coaching:     "Teaching style: COACHING. Include reflection and practice sessions. Fewer formal assess sessions; prefer consolidate sessions that integrate skills.",
  companion:    "Teaching style: COMPANION. Sessions should feel exploratory, not assessed. Prefer introduce and deepen over assess. End with consolidate not assess.",
  facilitation: "Teaching style: FACILITATION. Sessions should be collaborative and discussion-based. Include review sessions that bring multiple topics together.",
  reflective:   "Teaching style: REFLECTIVE. Sessions should build inward — start broad then move toward personal application. Include deepen sessions with reflective prompts.",
  open:         "Teaching style: OPEN. No fixed structure preference. Propose a plan that fits the content naturally.",
};

async function runGeneratePlan(
  taskId: string,
  courseName: string,
  learningOutcomes: string[],
  teachingStyle: string,
  interactionPattern: string | null,
  sessionCount: number | null,
  durationMins: number | null,
  emphasis: string,
  assessments: string,
  sourceId: string | null,
) {
  try {
    // 0. If sourceId provided, read document text from uploaded file
    let documentText: string | null = null;
    if (sourceId) {
      try {
        await updateTaskProgress(taskId, {
          context: { phase: "reading", message: "Reading uploaded document...", stepIndex: 0, totalSteps: 4 },
        });

        const source = await prisma.contentSource.findUnique({
          where: { id: sourceId },
          select: {
            textSample: true,
            mediaAssets: {
              take: 1,
              select: { storageKey: true, fileName: true },
            },
          },
        });

        if (source?.mediaAssets[0]) {
          const { getStorageAdapter } = await import("@/lib/storage");
          const { extractTextFromBuffer } = await import("@/lib/content-trust/extract-assertions");
          const storage = getStorageAdapter();
          const buffer = await storage.download(source.mediaAssets[0].storageKey);
          const extracted = await extractTextFromBuffer(buffer, source.mediaAssets[0].fileName);
          documentText = extracted?.text || null;
        } else if (source?.textSample) {
          documentText = source.textSample;
        }
      } catch (err: any) {
        console.warn("[courses/generate-plan] Failed to read document, proceeding without:", err.message);
      }
    }

    // 1. Generate curriculum from goals (enriched with document text if available)
    await updateTaskProgress(taskId, {
      context: { phase: "curriculum", message: documentText ? "Generating curriculum from your goals and document..." : "Generating curriculum from your goals...", stepIndex: 1, totalSteps: 4 },
    });

    // Inject document context into learning outcomes to enrich AI generation
    // (avoids changing generateCurriculumFromGoals signature which is shared)
    let enrichedOutcomes = learningOutcomes;
    if (documentText) {
      const truncatedDoc = documentText.substring(0, 8000);
      enrichedOutcomes = [
        ...learningOutcomes,
        `[DOCUMENT CONTEXT — the educator uploaded a document with this content. Use it to inform the curriculum structure and ensure modules cover the document's topics:]\n${truncatedDoc}`,
      ];
    }

    const curriculum = await generateCurriculumFromGoals(
      courseName,
      teachingStyle,
      enrichedOutcomes,
      undefined, // no qualificationRef
    );

    if (!curriculum.ok || curriculum.modules.length === 0) {
      await failTask(taskId, curriculum.error || "Curriculum generation produced no modules");
      return;
    }

    // 2. Create temporary Subject + Curriculum records (transactional — no orphans)
    await updateTaskProgress(taskId, {
      context: { phase: "persist", message: "Saving curriculum..." },
    });

    const slug = `draft-${courseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now()}`;

    const { subject, curriculumRecord } = await prisma.$transaction(async (tx) => {
      const subject = await tx.subject.create({
        data: {
          slug,
          name: courseName,
          isActive: true,
        },
      });

      const curriculumRecord = await tx.curriculum.create({
        data: {
          name: `${courseName} Curriculum`,
          description: curriculum.description || `AI-generated curriculum for ${courseName}`,
          subjectId: subject.id,
          notableInfo: {
            modules: curriculum.modules,
            generatedFrom: "goals",
            generatedAt: new Date().toISOString(),
          },
          deliveryConfig: curriculum.deliveryConfig || {},
        },
      });

      return { subject, curriculumRecord };
    });

    // 2b. Sync modules to first-class DB models
    try {
      await syncModulesToDB(curriculumRecord.id, curriculum.modules);
    } catch (err: any) {
      console.warn("[courses/generate-plan] Module sync failed (non-fatal):", err.message);
    }

    // 2c. Emit skeleton plan so frontend can show session cards while AI refines
    const skeletonPlan: LessonPlanEntry[] = [
      { session: 1, type: "onboarding", moduleId: null, moduleLabel: "", label: "Welcome & Background" },
      ...curriculum.modules.map((m, i) => ({
        session: i + 2,
        type: "introduce" as const,
        moduleId: `MOD-${i + 1}`,
        moduleLabel: m.title,
        label: `Introduction to ${m.title}`,
      })),
    ];

    await updateTaskProgress(taskId, {
      context: {
        phase: "skeleton",
        message: "Modules ready — generating detailed session plan...",
        stepIndex: 2,
        totalSteps: 4,
        skeletonReady: true,
        skeletonPlan,
        subjectId: subject.id,
        curriculumId: curriculumRecord.id,
        estimatedSessions: skeletonPlan.length,
      },
    });

    // 3. Generate lesson plan from curriculum modules
    await updateTaskProgress(taskId, {
      context: { phase: "plan", message: "Generating lesson plan...", stepIndex: 3, totalSteps: 4 },
    });

    const moduleSummary = curriculum.modules
      .map(
        (m, i) =>
          `Module ${i + 1}: "${m.title}" (${m.learningOutcomes?.length || 0} LOs)`,
      )
      .join("\n");

    const targetHint = sessionCount
      ? `The educator has requested approximately ${sessionCount} sessions total.`
      : "Propose a reasonable number of sessions based on the content depth.";

    const durationHint = durationMins
      ? `Target session duration: ${durationMins} minutes. Adjust content density per session accordingly.`
      : "";

    const emphasisHint =
      emphasis === "breadth"
        ? 'Teaching emphasis: BREADTH-FIRST. Cover all topics at surface level first with "introduce" sessions, then circle back with "deepen" sessions.'
        : emphasis === "depth"
          ? 'Teaching emphasis: DEPTH-FIRST. Go deep on each module before moving to the next — pair each "introduce" immediately with "deepen" sessions.'
          : "Teaching emphasis: BALANCED. Mix breadth and depth as you see fit per module.";

    const assessmentHint =
      assessments === "formal"
        ? 'Include formal "assess" sessions — at least one mid-course assessment and one final assessment.'
        : assessments === "none"
          ? 'Do NOT include any "assess" sessions. Skip formal assessments entirely.'
          : 'Include light assessment checks — one "assess" session near the end is sufficient.';

    const patternHint = interactionPattern
      ? (INTERACTION_PATTERN_SESSION_HINTS[interactionPattern] || "")
      : "";

    const systemPrompt = `You are a curriculum planning assistant. Given a set of teaching modules, propose a structured lesson plan — an ordered sequence of call sessions that covers all modules effectively.

Rules:
- Each session has a type: onboarding (first session), introduce (first exposure to module), deepen (revisit module for mastery), review (consolidate multiple modules), assess (test knowledge), consolidate (final synthesis)
- First session should always be onboarding
- Each module should have at least an "introduce" session, and larger modules should also have "deepen" sessions
- Include periodic "review" sessions every 3-4 modules
- End with a "consolidate" session
- ${targetHint}
- ${durationHint}
- ${emphasisHint}
- ${assessmentHint}${patternHint ? `\n- ${patternHint}` : ""}

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "reasoning": "Brief explanation of your plan structure",
  "entries": [
    { "session": 1, "type": "onboarding", "moduleId": null, "moduleLabel": "", "label": "Welcome + Background Probe" },
    { "session": 2, "type": "introduce", "moduleId": "MOD-1", "moduleLabel": "Module Name", "label": "Introduction to Module Name", "estimatedDurationMins": 30 },
    ...
  ]
}`;

    const documentExcerpt = documentText
      ? `\n\nUploaded Document Excerpt (use to inform session content and depth):\n${documentText.substring(0, 4000)}`
      : "";

    const userMessage = `Curriculum: "${courseName}"
${curriculum.description ? `Description: ${curriculum.description}` : ""}

Modules:
${moduleSummary}

Total modules: ${curriculum.modules.length}${documentExcerpt}`;

    // @ai-call lesson-plan.generate — Generate structured lesson plan for course wizard | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion({
      callPoint: "lesson-plan.generate",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      maxTokens: 4000,
    });

    const content = typeof result === "string" ? result : result?.content || "";
    let parsed: any;
    try {
      const cleaned = content
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/```\s*$/m, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      await failTask(taskId, "AI did not return valid JSON. Try again.");
      return;
    }

    const entries: LessonPlanEntry[] = (parsed.entries || []).map(
      (e: any, i: number) => ({
        session: i + 1,
        type: VALID_SESSION_TYPES.includes(e.type) ? e.type : "introduce",
        moduleId: e.moduleId || null,
        moduleLabel: e.moduleLabel || "",
        label: e.label || `Session ${i + 1}`,
        notes: e.notes || undefined,
        estimatedDurationMins: e.estimatedDurationMins || undefined,
        assertionCount: e.assertionCount || undefined,
      }),
    );

    // Save result to task context
    await updateTaskProgress(taskId, {
      context: {
        subjectId: subject.id,
        curriculumId: curriculumRecord.id,
        plan: entries,
        estimatedSessions: entries.length,
        reasoning: parsed.reasoning || "",
      },
    });

    await completeTask(taskId);
  } catch (error: any) {
    console.error("[courses/generate-plan] Background error:", error);
    await failTask(taskId, error.message);
  }
}

// ── POST — Generate lesson plan for course wizard ──────

/**
 * @api POST /api/courses/generate-plan
 * @visibility internal
 * @scope courses:write
 * @auth session (OPERATOR+)
 * @tags courses, lesson-plan
 * @description Generate a curriculum + lesson plan from course intent (name, outcomes, style).
 * Creates temporary Subject + Curriculum, generates lesson plan via AI.
 * Returns taskId to poll for progress. Used by Course Setup Wizard eager generation.
 * Task context reports phases: reading(0) → curriculum(1) → skeleton(2) → plan(3).
 * Skeleton phase emits skeletonReady + skeletonPlan for progressive UI display.
 * @body { courseName: string, learningOutcomes: string[], teachingStyle: string, sessionCount?: number, durationMins?: number, emphasis?: string, assessments?: string, sourceId?: string }
 * @response 202 { ok: true, taskId: string }
 * @response 400 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;

    const body = await request.json();
    const {
      courseName,
      learningOutcomes,
      teachingStyle,
      interactionPattern,
      sessionCount,
      durationMins,
      emphasis,
      assessments,
      sourceId,
    } = body;

    if (!courseName || typeof courseName !== "string") {
      return NextResponse.json(
        { ok: false, error: "courseName is required" },
        { status: 400 },
      );
    }

    if (!Array.isArray(learningOutcomes)) {
      return NextResponse.json(
        { ok: false, error: "learningOutcomes must be an array" },
        { status: 400 },
      );
    }

    const taskId = await startTaskTracking(
      auth.session.user.id,
      "course_plan_generation",
      {
        courseName,
        sessionCount,
        durationMins,
        emphasis: emphasis || "balanced",
        assessments: assessments || "light",
      },
    );

    // Fire background generation (no await)
    runGeneratePlan(
      taskId,
      courseName,
      learningOutcomes,
      teachingStyle || "tutor",
      interactionPattern || null,
      sessionCount || null,
      durationMins || null,
      emphasis || "balanced",
      assessments || "light",
      sourceId || null,
    ).catch(async (err) => {
      console.error("[courses/generate-plan] Unhandled error:", err);
      await failTask(taskId, err.message);
    });

    return NextResponse.json({ ok: true, taskId }, { status: 202 });
  } catch (error: any) {
    console.error("[courses/generate-plan] POST error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}

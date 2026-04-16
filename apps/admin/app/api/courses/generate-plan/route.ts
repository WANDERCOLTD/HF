import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { generateCurriculumFromGoals, extractCurriculumFromAssertions, type ExtractedCurriculum } from "@/lib/content-trust/extract-curriculum";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
} from "@/lib/ai/task-guidance";
import { syncModulesToDB } from "@/lib/curriculum/sync-modules";
import { getLessonPlanModel } from "@/lib/lesson-plan/models";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { interpolateTemplate } from "@/lib/prompts/interpolate";
import { config } from "@/lib/config";
import { logAI } from "@/lib/logger";

// ── Types ──────────────────────────────────────────────

const VALID_SESSION_TYPES = [
  "pre_survey",
  "onboarding",
  "introduce",
  "deepen",
  "review",
  "assess",
  "consolidate",
  "offboarding",
  "post_survey",
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
  /** Per-session phases from pedagogical model */
  phases?: Array<{
    id: string;
    label: string;
    durationMins?: number;
    teachMethods?: string[];
    learningOutcomeRefs?: string[];
    guidance?: string;
  }>;
  /** Which learning outcomes this session covers */
  learningOutcomeRefs?: string[];
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

const LESSON_PLAN_GENERATE_FALLBACK = `You are a curriculum planning assistant. Given a set of teaching modules, propose a structured lesson plan — an ordered sequence of call sessions that covers all modules effectively.

You are using the "{{modelLabel}}" pedagogical framework.
{{modelDescription}}

Session sequencing rules for this model:
{{sessionPatternRules}}{{sessionCountOverride}}

Phase structure:
Each session MUST include a "phases" array — ordered activities within the session.
Use the model's phase templates as a starting point, then customise labels and guidance for the specific content.
{{tpDistributionHints}}

General rules:
- Valid session types: onboarding, introduce, deepen, review, assess, consolidate
- First session should always be onboarding
- Cognitive load limit: max {{maxTpsPerSession}} new teaching points per session — split larger modules across multiple sessions
- {{targetHint}}
- {{durationHint}}
- {{emphasisHint}}
- {{assessmentHint}}{{patternHintLine}}

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "reasoning": "Brief explanation of your plan structure and how the {{modelLabel}} model shapes it",
  "entries": [
    {
      "session": 1, "type": "onboarding", "moduleId": null, "moduleLabel": "", "label": "Welcome + Background Probe",
      "phases": [
        { "id": "welcome", "label": "Welcome & Introductions", "durationMins": 5, "guidance": "Warm greeting, set expectations" },
        { "id": "probe", "label": "Background Probe", "durationMins": 15, "teachMethods": ["guided_discussion"], "guidance": "Explore prior knowledge and learning goals" },
        { "id": "preview", "label": "Course Preview", "durationMins": 10, "guidance": "Overview of what they'll learn" }
      ]
    },
    {
      "session": 2, "type": "introduce", "moduleId": "MOD-1", "moduleLabel": "Module Name", "label": "Introduction to Module Name",
      "estimatedDurationMins": 30,
      "learningOutcomeRefs": ["LO1", "LO2"],
      "phases": [
        { "id": "hook", "label": "Hook — Real-world scenario", "durationMins": 3, "teachMethods": ["guided_discussion"], "guidance": "Connect topic to learner's experience" },
        { "id": "direct_instruction", "label": "Key Concepts", "durationMins": 12, "teachMethods": ["definition_matching", "recall_quiz"], "learningOutcomeRefs": ["LO1"], "guidance": "Present definitions and core facts" },
        { "id": "guided_practice", "label": "Practice Together", "durationMins": 10, "teachMethods": ["worked_example"], "learningOutcomeRefs": ["LO2"], "guidance": "Work through examples with scaffolding" },
        { "id": "check", "label": "Quick Check", "durationMins": 5, "teachMethods": ["recall_quiz"], "guidance": "Verify understanding before closing" }
      ]
    }
  ]
}`;

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
  lessonPlanModel: string | null,
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

    // 1. Generate curriculum
    // Prefer the assertion-based path when the uploaded source has already
    // been extracted — extractCurriculumFromAssertions uses the real assertion
    // list as context AND emits assertionTags so the tag-on-extract pipeline
    // can wire LO refs back to the source assertions in one pass.
    // Fall back to generateCurriculumFromGoals when there are no assertions
    // (or too few for a meaningful curriculum).
    await updateTaskProgress(taskId, {
      context: { phase: "curriculum", message: documentText ? "Generating curriculum from your goals and document..." : "Generating curriculum from your goals...", stepIndex: 1, totalSteps: 4 },
    });

    // Load pre-extracted assertions for this source (if any). These are the
    // rows produced by course-pack/ingest before generate-plan was invoked.
    let sourceAssertions: Array<{ id: string; assertion: string; category: string; chapter: string | null; section: string | null; tags: string[] }> = [];
    if (sourceId) {
      const rows = await prisma.contentAssertion.findMany({
        where: {
          sourceId,
          // Exclude instruction categories — we want student-facing teaching points
          category: { notIn: ["course_overview", "tutor_guidance", "session_metadata"] },
        },
        select: { id: true, assertion: true, category: true, chapter: true, section: true, tags: true },
        orderBy: [{ chapter: "asc" }, { section: "asc" }, { createdAt: "asc" }],
      });
      sourceAssertions = rows.map((r) => ({
        id: r.id,
        assertion: r.assertion,
        category: r.category || "fact",
        chapter: r.chapter,
        section: r.section,
        tags: (r.tags as string[]) || [],
      }));
    }

    const MIN_ASSERTIONS_FOR_EXTRACTOR_PATH = 10;
    const useAssertionPath = sourceAssertions.length >= MIN_ASSERTIONS_FOR_EXTRACTOR_PATH;

    // Build index→id map in the same order as the assertion list we're about
    // to pass to the extractor. extractCurriculumFromAssertions indexes
    // starting at 1 (matches the "[i]" prefix in the prompt).
    const assertionIdByIndex = new Map<number, string>();
    if (useAssertionPath) {
      sourceAssertions.forEach((a, i) => assertionIdByIndex.set(i + 1, a.id));
    }

    let curriculum: ExtractedCurriculum;
    if (useAssertionPath) {
      console.log(
        `[courses/generate-plan] Using assertion-based extraction path (${sourceAssertions.length} assertions available)`,
      );
      curriculum = await extractCurriculumFromAssertions(
        sourceAssertions,
        courseName,
        undefined, // no qualificationRef
        {
          sessionCount: sessionCount ?? undefined,
          durationMins: durationMins ?? undefined,
          emphasis,
          assessments,
        },
      );
    } else {
      // Inject document context into learning outcomes to enrich AI generation
      let enrichedOutcomes = learningOutcomes;
      if (documentText) {
        const truncatedDoc = documentText.substring(0, 8000);
        enrichedOutcomes = [
          ...learningOutcomes,
          `[DOCUMENT CONTEXT — the educator uploaded a document with this content. Use it to inform the curriculum structure and ensure modules cover the document's topics:]\n${truncatedDoc}`,
        ];
      }
      curriculum = await generateCurriculumFromGoals(
        courseName,
        teachingStyle,
        enrichedOutcomes,
        undefined, // no qualificationRef
        sessionCount,
      );
    }

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
          slug: `${slug}-curriculum`,
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

      // Link uploaded document to the new subject so content is scoped to this course
      if (sourceId) {
        await tx.subjectSource.create({
          data: { subjectId: subject.id, sourceId, tags: ["content"] },
        });
      }

      return { subject, curriculumRecord };
    });

    // 2b. Sync modules to first-class DB models. When we used the assertion
    // path, pass the tags + index map so LO refs get written back to the
    // source assertions inside the same transaction as the LO upsert.
    try {
      await syncModulesToDB(curriculumRecord.id, curriculum.modules, {
        assertionTags: useAssertionPath ? curriculum.assertionTags : undefined,
        assertionIdByIndex: useAssertionPath ? assertionIdByIndex : undefined,
        // First-time course creation — explicit opt-in so the AI retag pass
        // catches orphan assertions from the pre-curriculum extraction run.
        runAiRetagPass: true,
      });
    } catch (err: any) {
      console.warn("[courses/generate-plan] Module sync failed (non-fatal):", err.message);
    }
    // NOTE: MCQ retag (#163 Phase 2) does not fire from this route because
    // generate-plan creates a subject + curriculum but does not own a
    // playbook id — MCQ reconcile is scoped per course. MCQ reconcile fires
    // from /regenerate-curriculum, the /reconcile-mcqs route, and the silent
    // background auto-run on scorecard load. Courses created fresh via this
    // route will pick up MCQ linkage on their first Curriculum-tab load.

    // 2c. Emit skeleton plan so frontend can show session cards while AI refines
    const skeletonPlan: LessonPlanEntry[] = [
      { session: 1, type: "onboarding", moduleId: null, moduleLabel: "", label: "Welcome & Background" },
      ...curriculum.modules.map((m, i) => ({
        session: i + 2,
        type: "introduce" as const,
        moduleId: `MOD-${i + 1}`,
        moduleLabel: m.title,
        label: `Introduction to ${m.title}`,
        learningOutcomeRefs: m.learningOutcomes?.map((_: any, j: number) => `LO${j + 1}`) || undefined,
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
      ? `HARD LIMIT: The educator has requested exactly ${sessionCount} sessions. You MUST produce exactly ${sessionCount} sessions — no more, no fewer. If there are more modules than sessions allow, merge multiple modules into single sessions. If there are fewer modules, split larger modules across sessions. The session count of ${sessionCount} is NON-NEGOTIABLE.`
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

    // Load pedagogical model definition
    const modelDef = getLessonPlanModel(lessonPlanModel);

    const sessionCountOverride = sessionCount
      ? `\n\nCRITICAL SESSION COUNT CONSTRAINT:
The educator has set a HARD LIMIT of ${sessionCount} sessions. This overrides the model's default expansion rules above.
- You MUST output EXACTLY ${sessionCount} entries in the "entries" array.
- If there are more modules than available sessions, MERGE related modules into combined sessions (e.g. "Origins & Spread + Human Impact").
- DO NOT add extra deepen, review, or assess sessions beyond what fits in ${sessionCount} total.
- Session 1 is always onboarding. The remaining ${sessionCount - 1} sessions must cover all modules plus any review/assess/consolidate.
- Prioritise coverage over depth — every module must appear in at least one session, even if merged.`
      : "";

    const template = await getPromptSpec(config.specs.lessonPlanGenerator, LESSON_PLAN_GENERATE_FALLBACK);
    const systemPrompt = interpolateTemplate(template, {
      modelLabel: modelDef.label,
      modelDescription: modelDef.description,
      sessionPatternRules: modelDef.sessionPatternRules,
      sessionCountOverride,
      tpDistributionHints: modelDef.tpDistributionHints,
      maxTpsPerSession: String(modelDef.defaults.maxTpsPerSession),
      targetHint,
      durationHint,
      emphasisHint,
      assessmentHint,
      patternHintLine: patternHint ? `\n- ${patternHint}` : "",
    });

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

    let entries: LessonPlanEntry[] = (parsed.entries || []).map(
      (e: any, i: number) => ({
        session: i + 1,
        type: VALID_SESSION_TYPES.includes(e.type) ? e.type : "introduce",
        moduleId: e.moduleId || null,
        moduleLabel: e.moduleLabel || "",
        label: e.label || `Session ${i + 1}`,
        notes: e.notes || undefined,
        estimatedDurationMins: e.estimatedDurationMins || undefined,
        assertionCount: e.assertionCount || undefined,
        phases: Array.isArray(e.phases) ? e.phases.map((p: any) => ({
          id: p.id || "unknown",
          label: p.label || p.id || "Phase",
          durationMins: p.durationMins || undefined,
          teachMethods: Array.isArray(p.teachMethods) ? p.teachMethods : undefined,
          learningOutcomeRefs: Array.isArray(p.learningOutcomeRefs) ? p.learningOutcomeRefs : undefined,
          guidance: p.guidance || undefined,
        })) : undefined,
        learningOutcomeRefs: Array.isArray(e.learningOutcomeRefs) ? e.learningOutcomeRefs : undefined,
      }),
    );

    // Hard-cap: if AI still exceeded session count, truncate to fit
    if (sessionCount && entries.length > sessionCount) {
      console.warn(`[courses/generate-plan] AI returned ${entries.length} sessions but limit is ${sessionCount} — truncating`);
      entries = entries.slice(0, sessionCount);
      // Re-number sessions
      entries = entries.map((e, i) => ({ ...e, session: i + 1 }));
    }

    // Save result to task context
    await updateTaskProgress(taskId, {
      context: {
        subjectId: subject.id,
        curriculumId: curriculumRecord.id,
        plan: entries,
        estimatedSessions: entries.length,
        reasoning: parsed.reasoning || "",
        lessonPlanModel: lessonPlanModel || "direct_instruction",
      },
    });

    await completeTask(taskId);
  } catch (error: any) {
    console.error("[courses/generate-plan] Background error:", error);
    logAI("courses.generate-plan:error", "Lesson plan generation failed", error.message, { level: "error", taskId });
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
 * @body { courseName: string, learningOutcomes: string[], teachingStyle: string, sessionCount?: number, durationMins?: number, emphasis?: string, assessments?: string, sourceId?: string, lessonPlanModel?: string }
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
      lessonPlanModel,
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
      lessonPlanModel || null,
    ).catch(async (err) => {
      console.error("[courses/generate-plan] Unhandled error:", err);
      await failTask(taskId, err.message);
    });

    return NextResponse.json({ ok: true, taskId }, { status: 202 });
  } catch (error: any) {
    console.error("[courses/generate-plan] POST error:", error);
    logAI("courses.generate-plan:error", "POST failed", error.message, { level: "error" });
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}

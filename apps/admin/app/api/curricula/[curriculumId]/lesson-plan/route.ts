import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { Prisma } from "@prisma/client";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import { canonicaliseRef } from "@/lib/lesson-plan/lo-ref-match";
import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
  failTask,
} from "@/lib/ai/task-guidance";

type Params = { params: Promise<{ curriculumId: string }> };

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
  /** Educator sets — learners can skip this stop */
  isOptional?: boolean;
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
    let { entries } = body;
    const { surveys } = body as { surveys?: import("@/lib/lesson-plan/apply-auto-include-stops").SurveyConfig };

    // If surveys config provided, re-apply auto-include stops to reflect toggle changes
    if (surveys) {
      const { applyAutoIncludeStops } = await import("@/lib/lesson-plan/apply-auto-include-stops");
      entries = await applyAutoIncludeStops(entries, surveys);
    }

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
      estimatedSessions: entries.filter((e: any) => !["pre_survey", "post_survey", "onboarding", "offboarding"].includes(e.type)).length,
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

    // ── Fix #6: Validate assertionIds exist in DB before saving ──
    const allIds = plan.entries.flatMap((e) => e.assertionIds || []);
    let staleWarning: string | undefined;
    if (allIds.length > 0) {
      const existing = await prisma.contentAssertion.findMany({
        where: { id: { in: allIds } },
        select: { id: true },
      });
      const existingSet = new Set(existing.map((a) => a.id));
      const staleIds = allIds.filter((id) => !existingSet.has(id));
      if (staleIds.length > 0) {
        staleWarning = `${staleIds.length} of ${allIds.length} assertionIds reference deleted assertions`;
        console.warn(`[lesson-plan PUT] ${staleWarning} in curriculum ${curriculumId}`);
        // Strip stale IDs rather than saving dead references
        for (const entry of plan.entries) {
          if (Array.isArray(entry.assertionIds)) {
            entry.assertionIds = entry.assertionIds.filter((id) => existingSet.has(id));
            if (entry.assertionIds.length === 0) entry.assertionIds = undefined;
            entry.assertionCount = entry.assertionIds?.length;
          }
        }
      }
    }

    await prisma.curriculum.update({
      where: { id: curriculumId },
      data: {
        deliveryConfig: { ...existingDC, lessonPlan: plan } as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ok: true, plan, entries: plan.entries, ...(staleWarning ? { warning: staleWarning } : {}) });
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
      // Third fallback: deliveryConfig.lessonPlan.entries (from wizard plan preview)
      const dc = (curriculum.deliveryConfig as Record<string, any>) || {};
      const planEntries = dc?.lessonPlan?.entries as any[] | undefined;
      if (planEntries?.length) {
        modules = planEntries.map((e: any, i: number) => ({
          id: e.moduleId || `MOD-${i + 1}`,
          title: e.label || e.moduleLabel || `Session ${i + 1}`,
          description: `${e.type || "lesson"} session`,
          sortOrder: i,
          learningOutcomes: e.learningOutcomes || [],
        }));
      }
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

    // totalSessionTarget = number of TEACHING sessions the educator wants.
    // Structural stops (onboarding, offboarding, surveys) are auto-injected after generation.
    const targetHint = totalSessionTarget
      ? `The educator has requested EXACTLY ${totalSessionTarget} TEACHING sessions. You MUST return exactly ${totalSessionTarget} entries. Do NOT include onboarding, offboarding, pre_survey, or post_survey — those are auto-injected separately. Only use: introduce, deepen, review, assess, consolidate.${
          totalSessionTarget <= 2
            ? " With only 1-2 sessions, use only introduce and deepen types. Combine multiple modules into single sessions if needed."
            : totalSessionTarget <= 4
              ? " Use introduce and deepen for most sessions. Include one assess near the end if appropriate. Combine related modules if needed."
              : " Include periodic review sessions every 3-4 modules. Include assess sessions as appropriate."
        }`
      : "Propose a reasonable number of TEACHING sessions based on the content depth. Do NOT include onboarding, offboarding, or survey sessions — those are auto-injected separately. Only use: introduce, deepen, review, assess, consolidate.";

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

    const systemPrompt = `You are a curriculum planning assistant. Given a set of teaching modules, propose a structured lesson plan — an ordered sequence of TEACHING call sessions that covers all modules effectively.

IMPORTANT: You are generating ONLY the teaching sessions. Onboarding, offboarding, and survey stops are auto-injected by the system — do NOT include them.

Rules:
- Valid session types: introduce (first exposure to module), deepen (revisit module for mastery), review (consolidate multiple modules), assess (test knowledge), consolidate (final synthesis)
- Do NOT use: onboarding, offboarding, pre_survey, post_survey
- ${targetHint}
- The session count target is the MOST IMPORTANT constraint. All other rules below are secondary and should be relaxed if they conflict with the target count.
- When sessions allow (n > 4): include periodic review sessions every 3-4 modules. Use consolidate for pre-final synthesis.
- Each module should have at least an "introduce" session, and larger modules (more assertions) should also have "deepen" sessions. If there are fewer sessions than modules, combine related modules into single sessions.
- ${durationHint}
- ${emphasisHint}
- ${assessmentHint}

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "reasoning": "Brief explanation of your plan structure",
  "entries": [
    { "session": 1, "type": "introduce", "moduleId": "MOD-1", "moduleLabel": "Module Name", "label": "Introduction to Module Name", "estimatedDurationMins": 30, "assertionCount": 23 },
    { "session": 2, "type": "deepen", "moduleId": "MOD-1", "moduleLabel": "Module Name", "label": "Deep Dive: Module Name", "estimatedDurationMins": 30, "assertionCount": 15 },
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

    // ── Auto-inject structural + survey stops from SESSION_TYPES_V1 contract ──
    const playbookForSurvey = await prisma.playbook.findFirst({
      where: { subjects: { some: { subject: { curricula: { some: { id: curriculumId } } } } } },
      select: { config: true },
    });
    const pbSurveys = (playbookForSurvey?.config as Record<string, any>)?.surveys as
      import("@/lib/lesson-plan/apply-auto-include-stops").SurveyConfig | undefined;

    const { applyAutoIncludeStops } = await import("@/lib/lesson-plan/apply-auto-include-stops");
    const expandedEntries = await applyAutoIncludeStops(entries, pbSurveys);
    // Replace entries in-place so downstream code (assertion distribution) uses expanded list
    entries.length = 0;
    entries.push(...expandedEntries);

    // ── Fix #2: Resolve actual LO refs from DB (not synthetic LO1/LO2) ──
    // The moduleLOMap has raw text strings. Replace with actual LearningObjective.ref values.
    const dbModules = await prisma.curriculumModule.findMany({
      where: { curriculumId, isActive: true },
      select: {
        slug: true,
        learningObjectives: { select: { ref: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    const moduleToLORefs: Record<string, string[]> = {};
    for (const m of dbModules) {
      if (m.learningObjectives.length > 0) {
        moduleToLORefs[m.slug] = m.learningObjectives.map((lo) => lo.ref);
      }
    }
    // Update entries with real LO refs from DB
    for (const entry of entries) {
      if (entry.moduleId && moduleToLORefs[entry.moduleId]) {
        entry.learningOutcomeRefs = moduleToLORefs[entry.moduleId];
      }
    }

    // ── Fix #3: Assessment/consolidate inherit LO refs from all prior teaching sessions ──
    for (const entry of entries) {
      if (entry.type === "assess" || entry.type === "consolidate") {
        const priorLORefs = new Set<string>();
        for (const prior of entries) {
          if (prior.session >= entry.session) break;
          if (Array.isArray(prior.learningOutcomeRefs)) {
            prior.learningOutcomeRefs.forEach((ref: string) => priorLORefs.add(ref));
          }
        }
        if (priorLORefs.size > 0) {
          entry.learningOutcomeRefs = [...priorLORefs];
        }
      }
    }

    // ── Fix #1: Module-aware assertion distribution (replaces round-robin) ──
    const sourceIds = await resolveSourceIdsForGeneration(curriculumId, curriculum.subjectId);

    if (sourceIds.length > 0) {
      const assertions = await prisma.contentAssertion.findMany({
        where: { sourceId: { in: sourceIds }, category: { notIn: [...INSTRUCTION_CATEGORIES] } },
        select: { id: true, learningOutcomeRef: true, learningObjectiveId: true, topicSlug: true, chapter: true, contentHash: true },
        orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
      });

      if (assertions.length > 0) {
        // ── Fix #4: Cross-doc dedup by contentHash ──
        const seen = new Set<string>();
        const deduped = assertions.filter((a) => {
          if (!a.contentHash) return true;
          if (seen.has(a.contentHash)) return false;
          seen.add(a.contentHash);
          return true;
        });
        if (deduped.length < assertions.length) {
          console.log(`[lesson-plan] Deduped ${assertions.length - deduped.length} cross-source duplicate assertions`);
        }

        // Initialize empty assertionIds on teaching entries
        for (const entry of entries) {
          if (!["onboarding", "offboarding", "pre_survey", "post_survey"].includes(entry.type)) {
            entry.assertionIds = [];
          }
        }

        // Use shared module-aware distribution
        // Build LO ref→id map for FK-based matching
        const loRows = await prisma.learningObjective.findMany({
          where: { module: { curriculumId, isActive: true } },
          select: { id: true, ref: true },
        });
        const loMap = new Map<string, string>();
        for (const lo of loRows) {
          loMap.set(canonicaliseRef(lo.ref), lo.id);
          loMap.set(lo.ref, lo.id);
        }
        const { distributeAssertionsByModule } = await import("@/lib/lesson-plan/refresh-assertion-ids");
        const distResult = distributeAssertionsByModule(entries, deduped, curriculumId, loMap);
        console.log(`[lesson-plan] Distributed assertions: ${distResult.refilled} entries filled, ${distResult.orphaned} orphaned`);
      }
    }

    // Save result to task context
    await updateTaskProgress(taskId, {
      context: {
        plan: entries,
        // estimatedSessions = teaching sessions only (what the educator controls)
        estimatedSessions: entries.filter((e) => !["pre_survey", "post_survey", "onboarding", "offboarding"].includes(e.type)).length,
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
      select: { id: true, notableInfo: true, deliveryConfig: true, subjectId: true },
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

    // Check curriculum has modules — same 3-source fallback as the background task
    const notableInfo = (curriculum.notableInfo as Record<string, any>) || {};
    let modules: any[] = notableInfo.modules || [];

    if (modules.length === 0) {
      // Fallback: first-class CurriculumModule records from DB
      const dbModules = await prisma.curriculumModule.findMany({
        where: { curriculumId, isActive: true },
        select: { id: true },
        take: 1,
      });
      if (dbModules.length > 0) modules = dbModules;
    }

    if (modules.length === 0) {
      // Fallback: deliveryConfig.lessonPlan.entries (from wizard plan preview)
      const dc = (curriculum.deliveryConfig as Record<string, any>) || {};
      const planEntries = dc?.lessonPlan?.entries as any[] | undefined;
      if (planEntries?.length) modules = planEntries;
    }

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

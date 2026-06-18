/**
 * Module & Curriculum Transforms
 *
 * Contract-driven module extraction - uses CURRICULUM_PROGRESS_V1 contract.
 * NO HARDCODED MODULE PATHS - specs define where modules are via metadata.moduleSelector
 *
 * computeSharedState() is the CRITICAL function — it computes
 * shared module state used by _quickStart, curriculum, session_pedagogy,
 * and curriculum_guidance. Called once during executor setup.
 */

import { registerTransform } from "../TransformRegistry";
import { buildLoMasteryMap } from "../lo-mastery-map";
import { getAttributeValue } from "../types";
import type {
  LoadedDataContext,
  ResolvedSpecs,
  SharedComputedState,
  ModuleData,
  AssembledContext,
  CallerAttributeData,
} from "../types";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import {
  resolveMasteryThreshold,
  MASTERY_THRESHOLD_FALLBACK,
} from "@/lib/tolerance/resolve-tolerance";
import { getCourseStyle, type CourseStyle } from "@/lib/pipeline/course-style";

// =============================================================================
// DB-FIRST MODULE LOADING (CurriculumModule model)
// =============================================================================

/**
 * Load modules from first-class CurriculumModule + LearningObjective records.
 * Returns ModuleData[] if records exist, null to fall back to JSON/spec paths.
 */
async function loadModulesFromDB(
  curriculumId: string,
  resolvedMasteryThreshold: number,
): Promise<{ modules: ModuleData[]; loRefToIdMap: Map<string, string> } | null> {
  try {
    const dbModules = await prisma.curriculumModule.findMany({
      where: { curriculumId, isActive: true },
      include: { learningObjectives: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    if (dbModules.length === 0) return null;
    // #142: Build LO ref → id map for FK-based filtering in teaching-content
    // Keys canonicalized (uppercase, hyphen-stripped) so "LO1" and "LO-1" both resolve
    const { canonicaliseRef } = await import("@/lib/lesson-plan/lo-ref-match");
    const loRefToIdMap = new Map<string, string>();
    for (const m of dbModules) {
      for (const lo of m.learningObjectives) {
        const canon = canonicaliseRef(lo.ref);
        if (!loRefToIdMap.has(canon)) loRefToIdMap.set(canon, lo.id);
        if (!loRefToIdMap.has(lo.ref)) loRefToIdMap.set(lo.ref, lo.id);
      }
    }
    const modules = dbModules.map((m) => {
      // #317 — split LOs by audience. learnerOutcomes feeds the learner
      // conversation; assessorOutcomes feeds the scoring / item-gen prompts.
      // The split here is what keeps rubric content out of the student chat
      // and what surfaces it inside the assessor system prompt.
      const learnerOutcomes: string[] = [];
      const rubric: string[] = [];
      const itemGenSpec: string[] = [];
      const scoreExplainer: string[] = [];
      const teachingInstruction: string[] = [];
      for (const lo of m.learningObjectives) {
        if (lo.learnerVisible) {
          // performanceStatement (when present) is the polished learner-facing
          // version; description is the verbatim authoring text.
          learnerOutcomes.push(lo.performanceStatement ?? lo.description);
        } else {
          switch (lo.systemRole) {
            case "ASSESSOR_RUBRIC": rubric.push(lo.description); break;
            case "ITEM_GENERATOR_SPEC": itemGenSpec.push(lo.description); break;
            case "SCORE_EXPLAINER": scoreExplainer.push(lo.description); break;
            case "TEACHING_INSTRUCTION": teachingInstruction.push(lo.description); break;
            default: /* NONE on a hidden row is incoherent — drop silently */ break;
          }
        }
      }
      return {
        id: m.id,
        slug: m.slug,
        name: m.title,
        description: m.description,
        sortOrder: m.sortOrder,
        sequence: m.sortOrder,
        masteryThreshold: m.masteryThreshold ?? resolvedMasteryThreshold,
        prerequisites: m.prerequisites,
        concepts: m.keyTerms,
        learningOutcomes: learnerOutcomes,
        assessorOutcomes: { rubric, itemGenSpec, scoreExplainer, teachingInstruction },
      };
    });
    return { modules, loRefToIdMap };
  } catch (err: any) {
    console.warn("[modules] DB module load failed, falling back to JSON:", err.message);
    return null;
  }
}

/**
 * Try to find curriculum info from the loaded data context.
 * Looks in subjectSources → subjects → curriculum.
 */
/** Exported for regression tests — see tests/lib/composition/modules.test.ts. */
export function findCurriculumInfo(data: LoadedDataContext): { id: string; name: string | null; slug: string | null } | null {
  const subjects = data.subjectSources?.subjects;
  if (!subjects?.length) return null;
  for (const subject of subjects) {
    if (subject.curriculum?.id) {
      return {
        id: subject.curriculum.id,
        name: (subject.curriculum as any).name || null,
        slug: (subject.curriculum as any).slug || null,
      };
    }
  }
  return null;
}

/**
 * Filter curriculum assertions down to those that are eligible to enter the
 * working-set selector. Excludes COURSE_REFERENCE assertions, which are tutor
 * rules / operator instructions (e.g. "Do NOT summarise the passage") rather
 * than student-facing teaching points. Tutor rules are surfaced via the
 * separate course-instructions transform.
 *
 * Exported for regression tests — see tests/lib/composition/modules.test.ts.
 */
export function filterTeachableAssertions<T extends { sourceDocumentType?: string | null }>(
  assertions: T[],
): T[] {
  return assertions.filter((a) => a.sourceDocumentType !== "COURSE_REFERENCE");
}

// resolveLessonPlanMode() deleted — all courses now use scheduler-driven
// continuous pacing. Session-based structured mode is removed.
// See ADR: docs/decisions/2026-04-14-outcome-graph-pacing.md

// =============================================================================
// CURRICULUM METADATA TYPES (from CURRICULUM_PROGRESS_V1 contract)
// =============================================================================

interface CurriculumMetadata {
  type: 'sequential' | 'branching' | 'open-ended';
  trackingMode: 'module-based' | 'competency-based';
  moduleSelector: string;  // e.g., "section=content"
  moduleOrder: string;     // e.g., "sortBySequence"
  progressKey: string;     // e.g., "current_module"
  masteryThreshold: number;
}

// =============================================================================
// MODULE EXTRACTION - Contract-driven, no hardcoding
// =============================================================================

/**
 * Extract curriculum metadata from content spec config.
 * Falls back to legacy paths for backward compatibility.
 */
function extractCurriculumMetadata(
  contentSpec: any,
  resolvedMasteryThreshold: number,
): CurriculumMetadata | null {
  const config = contentSpec?.config as Record<string, any> | null;
  if (!config) return null;

  // Primary: metadata.curriculum (contract-compliant)
  const meta = config.metadata?.curriculum;
  if (meta) {
    return {
      type: meta.type || 'sequential',
      trackingMode: meta.trackingMode || 'module-based',
      moduleSelector: meta.moduleSelector || 'section=content',
      moduleOrder: meta.moduleOrder || 'sortBySequence',
      progressKey: meta.progressKey || 'current_module',
      masteryThreshold: meta.masteryThreshold ?? resolvedMasteryThreshold,
    };
  }

  // No metadata - return null (will use legacy fallback)
  return null;
}

/**
 * Extract modules from spec using metadata selector.
 * This is the CONTRACT-DRIVEN approach - modules are identified by a selector pattern.
 *
 * Example: moduleSelector="section=content" finds all parameters where section="content"
 */
function extractModulesFromParameters(
  contentSpec: any,
  metadata: CurriculumMetadata
): ModuleData[] {
  const config = contentSpec?.config as Record<string, any> | null;
  const params = config?.parameters || [];

  // Parse selector (e.g., "section=content" → filter by section="content")
  const [selectorKey, selectorValue] = metadata.moduleSelector.split('=');
  if (!selectorKey || !selectorValue) {
    console.warn(`[modules] Invalid moduleSelector format: ${metadata.moduleSelector}`);
    return [];
  }

  // Filter parameters that match selector
  const moduleParams = params.filter((p: any) => p[selectorKey] === selectorValue);

  // Transform parameters into modules
  const modules: ModuleData[] = moduleParams.map((p: any, index: number) => ({
    id: p.id,
    slug: p.id, // Use id as slug for consistency
    name: p.name || p.config?.chapterTitle || p.id,
    description: p.description || p.config?.description || '',
    content: p.config || {},
    sequence: p.sequence ?? p.config?.sequence ?? index,
    sortOrder: p.sequence ?? p.config?.sequence ?? index,
    prerequisites: p.config?.prerequisites || [],
    masteryThreshold: metadata.masteryThreshold,
  }));

  // Sort modules based on metadata.moduleOrder
  return sortModules(modules, metadata.moduleOrder);
}

/**
 * Sort modules according to spec-defined ordering rule.
 */
function sortModules(modules: ModuleData[], orderRule: string): ModuleData[] {
  switch (orderRule) {
    case 'sortBySequence':
      return modules.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    case 'sortBySectionThenId':
      return modules.sort((a, b) => (a.id || '').localeCompare(b.id || ''));

    case 'explicit':
      // Spec provides explicit order - already ordered
      return modules;

    default:
      return modules.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }
}

/**
 * Legacy module extraction - for backward compatibility with specs that
 * use direct modules array instead of contract-driven parameters.
 */
function extractLegacyModules(
  contentSpec: any,
  resolvedMasteryThreshold: number,
): ModuleData[] {
  const config = contentSpec?.config as Record<string, any> | null;
  if (!config) return [];

  // Try various legacy paths
  const rawModules = config.modules || config.curriculum?.modules || [];

  return rawModules.map((m: any, index: number) => ({
    id: m.id || m.slug,
    slug: m.slug || m.id,
    name: m.name || m.title,
    description: m.description || '',
    content: m.content || m,
    sequence: m.sequence ?? m.sortOrder ?? index,
    sortOrder: m.sortOrder ?? m.sequence ?? index,
    prerequisites: m.prerequisites || [],
    masteryThreshold: m.masteryThreshold ?? resolvedMasteryThreshold,
  }));
}

/**
 * Extract modules from content spec - uses contract-driven approach first,
 * falls back to legacy paths for backward compatibility.
 */
function extractModules(
  contentSpec: any,
  resolvedMasteryThreshold: number,
): { modules: ModuleData[]; metadata: CurriculumMetadata | null } {
  // Try contract-driven extraction first
  const metadata = extractCurriculumMetadata(contentSpec, resolvedMasteryThreshold);

  if (metadata) {
    const modules = extractModulesFromParameters(contentSpec, metadata);
    if (modules.length > 0) {
      console.log(`[modules] Contract-driven extraction: found ${modules.length} modules via selector "${metadata.moduleSelector}"`);
      return { modules, metadata };
    }
  }

  // Fallback to legacy direct modules array
  const legacyModules = extractLegacyModules(contentSpec, resolvedMasteryThreshold);
  if (legacyModules.length > 0) {
    console.log(`[modules] Legacy extraction: found ${legacyModules.length} modules from direct array`);
  }

  return { modules: legacyModules, metadata };
}

// =============================================================================
// SUBJECT CURRICULUM FALLBACK
// =============================================================================

/**
 * Extract modules from Subject-based curriculum (Curriculum.notableInfo.modules).
 * Used when no CONTENT spec modules are found — bridges Subject system to composition pipeline.
 */
function extractSubjectCurriculumModules(
  data: LoadedDataContext,
  resolvedMasteryThreshold: number,
): { modules: ModuleData[]; specSlug: string } | null {
  const subjects = data.subjectSources?.subjects;
  if (!subjects?.length) return null;

  for (const subject of subjects) {
    const curriculum = subject.curriculum;
    if (!curriculum?.notableInfo) continue;

    const rawModules = (curriculum.notableInfo as Record<string, any>)?.modules;
    if (!Array.isArray(rawModules) || rawModules.length === 0) continue;

    const modules: ModuleData[] = rawModules.map((m: any, idx: number) => ({
      id: m.id,
      slug: m.id,
      name: m.title || m.name || m.id,
      description: m.description || "",
      content: m,
      sequence: m.sortOrder ?? idx,
      sortOrder: m.sortOrder ?? idx,
      prerequisites: [],
      learningOutcomes: m.learningOutcomes || [],
      assessmentCriteria: m.assessmentCriteria || [],
      keyTerms: m.keyTerms || [],
      masteryThreshold: resolvedMasteryThreshold,
    }));

    return { modules, specSlug: curriculum.slug };
  }

  return null;
}

// =============================================================================
// SHARED STATE COMPUTATION
// =============================================================================

/**
 * Compute shared module state from loaded data.
 * Called once in executor setup, stored in AssembledContext.sharedState.
 */
export async function computeSharedState(
  data: LoadedDataContext,
  resolvedSpecs: ResolvedSpecs,
  specConfig: Record<string, any>,
  triggerType?: string,
  requestedModuleIdArg?: string | null,
): Promise<SharedComputedState> {
  const channel: 'text' | 'voice' = triggerType === 'sim' ? 'text' : 'voice';
  // DB-first: try CurriculumModule records before JSON paths
  const curriculumInfo = findCurriculumInfo(data);
  const curriculumId = curriculumInfo?.id || null;
  let modules: ModuleData[] = [];
  let metadata: CurriculumMetadata | null = null;
  let specSlug = '';

  // #142: LO ref → id map for FK-based assertion filtering
  let loRefToIdMap = new Map<string, string>();

  // #598 Slice 1 — resolve the mastery threshold once via the 7-layer cascade
  // (`lib/tolerance/resolve-tolerance.ts`). Used as the per-module fallback
  // when a CurriculumModule has no explicit override and threaded through to
  // the scheduler call below. Replaces the previous bare `0.7` literals.
  const playbookForResolve = data.playbooks?.[0];
  const resolvedMasteryThreshold = await resolveMasteryThreshold({
    callerId: data.caller?.id ?? null,
    playbookId: playbookForResolve?.id ?? null,
    playbookConfig: (playbookForResolve?.config as Record<string, unknown>) ?? null,
    specConfig,
  });

  // #1259 — Default-deny course-style gate. Absence of an explicit
  // `lessonPlanMode === "structured"` resolves to CONTINUOUS, in which
  // case the module-sequencing block (CallerModuleProgress reads,
  // estimatedProgress heuristic, scheduler) is skipped. CONTINUOUS
  // courses produce SharedComputedState with empty-safe defaults so
  // downstream transforms (quickstart, pedagogy, retrieval-practice)
  // don't crash on missing module data.
  const courseStyle: CourseStyle = getCourseStyle(
    (playbookForResolve?.config as any) ?? null,
  );

  if (curriculumId) {
    const dbResult = await loadModulesFromDB(curriculumId, resolvedMasteryThreshold);
    if (dbResult && dbResult.modules.length > 0) {
      modules = dbResult.modules;
      loRefToIdMap = dbResult.loRefToIdMap;
      // Propagate the curriculum slug so the continuous branch's specSlug guard passes.
      // Without this, DB-first-loaded curricula silently fall through to structured mode.
      specSlug = curriculumInfo?.slug || '';
      console.log(`[modules] DB-first: loaded ${modules.length} modules from CurriculumModule records (slug=${specSlug || '(none)'})`);
    }
  }

  // Fallback: Subject-based curriculum (JSON in notableInfo)
  if (modules.length === 0) {
    const subjectResult = extractSubjectCurriculumModules(data, resolvedMasteryThreshold);
    if (subjectResult && subjectResult.modules.length > 0) {
      modules = subjectResult.modules;
      specSlug = subjectResult.specSlug;
      // Create default metadata for Subject curriculum
      if (!metadata) {
        metadata = {
          type: 'sequential',
          trackingMode: 'module-based',
          moduleSelector: 'subject-curriculum',
          moduleOrder: 'sortBySequence',
          progressKey: 'current_module',
          masteryThreshold: resolvedMasteryThreshold,
        };
      }
      console.log(`[modules] Subject curriculum fallback: ${modules.length} modules from "${specSlug}"`);
    } else if (curriculumId) {
      // Composition transforms audit follow-up: when a Curriculum row exists
      // but BOTH the relational CurriculumModule rows AND the legacy
      // notableInfo.modules JSON are empty, the prompt loses its module
      // structure silently. Warn loudly so operators can spot half-projected
      // courses instead of letting them ship a degraded learning experience.
      console.warn(
        `[modules] Curriculum ${curriculumId} has neither CurriculumModule rows nor notableInfo.modules — prompt will render without module structure. Likely a half-completed projection or seed.`,
      );
    }
  }

  // #598 Slice 1 — metadata.masteryThreshold is already populated from the
  // resolved cascade above; fall back to the resolved value if metadata is
  // null (e.g., no curriculum loaded for this composition).
  const masteryThreshold = metadata?.masteryThreshold ?? resolvedMasteryThreshold;

  const isFirstCall = specConfig.forceFirstCall || data.recentCalls.length === 0;

  // Check if this is first call in current domain (for domain-switch re-onboarding)
  const onboardingSession = data.onboardingSession;
  const isFirstCallInDomain = specConfig.forceFirstCall || !onboardingSession || !onboardingSession.isComplete;

  if (specConfig.forceFirstCall) {
    console.log("[modules] forceFirstCall override: treating as first call for preview");
  }

  const lastCall = data.recentCalls[0];
  const daysSinceLastCall = lastCall
    ? Math.floor((Date.now() - new Date(lastCall.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Track completed modules.
  // #494 Slice 2.1 — CallerModuleProgress.mastery is the canonical store
  // (written by Slice 2.2). Build the completed-set primarily from those
  // rows; fall through to the legacy CallerAttribute scan only when
  // LEGACY_MASTERY_FALLBACK_ENABLED=true (default off).
  const completedModules = new Set<string>();
  const progressKeyPrefix = metadata?.progressKey
    ? `curriculum:${specSlug}:mastery:`
    : '';

  // Primary path — read from CallerModuleProgress when we have a
  // curriculumId in scope. Keyed by slug to match the rest of the transform
  // (downstream `completedModules.has(m.slug || m.id)` lookups).
  //
  // #1259 — CONTINUOUS courses skip the read entirely. They have no
  // module-mastery semantic (no fixed sequence) and the topic-pool
  // composition emits no module section.
  let masteryFromDb = false;
  if (courseStyle === "structured" && curriculumId && data.caller?.id) {
    try {
      const progressRows = await prisma.callerModuleProgress.findMany({
        where: {
          callerId: data.caller.id,
          module: { curriculumId },
          mastery: { gte: masteryThreshold },
        },
        select: {
          mastery: true,
          module: { select: { slug: true, id: true } },
        },
      });
      for (const row of progressRows) {
        const key = row.module.slug || row.module.id;
        if (key) completedModules.add(key);
      }
      masteryFromDb = true;
    } catch (err) {
      console.warn(
        "[modules] CallerModuleProgress completed-set query failed (non-blocking):",
        err,
      );
    }
  }

  // Legacy fallback — only when DB read above didn't happen AND fallback
  // flag is on. Keeps the door open for emergency rollback during the
  // CallerAttribute → CallerModuleProgress migration window.
  if (!masteryFromDb && process.env.LEGACY_MASTERY_FALLBACK_ENABLED === "true") {
    data.callerAttributes
      .filter(a =>
        a.key.includes("mastery_") ||
        a.key.includes("completed_") ||
        (progressKeyPrefix && a.key.startsWith(progressKeyPrefix))
      )
      .forEach(a => {
        const val = getAttributeValue(a);
        if (val === true || (typeof val === "number" && val >= masteryThreshold)) {
          // Extract module ID from various key formats
          const moduleId = a.key
            .replace("mastery_", "")
            .replace("completed_", "")
            .replace(progressKeyPrefix, "");
          completedModules.add(moduleId);
        }
      });
  }

  // ── #266 Slice 1 + #554 Fix 2: per-learner module attempt data ──
  // Hoisted above the moduleToReview gate so `hasAttemptData` can short-circuit
  // the modules[0] fallback for true zero-progress learners. Without this gate,
  // a brand-new caller (zero CallerModuleProgress, zero recentCalls) would have
  // moduleToReview resolve to modules[0] and downstream pedagogy emits a
  // "review your baseline work" block before any call exists.
  // `pbConfig` is also consumed by isFinalSession logic further down — declare
  // once at function scope, reuse.
  const pbConfig = (data.playbooks?.[0]?.config || {}) as Record<string, any>;
  const sessionCount = pbConfig.sessionCount as number | undefined;
  let moduleAttemptCounts: SharedComputedState["moduleAttemptCounts"] = undefined;
  let hasAttemptData = false;
  // #1008 (I-C5) — pre-fix, this branch was gated on `pbConfig.modulesAuthored === true`,
  // which silently downgraded every course without that authoring-era flag to
  // the `estimatedProgress = recentCalls.length / 2` heuristic below — even
  // when CallerModuleProgress rows existed. Courses created via the
  // quickstart/analyze lane (and any pre-mirror courses) never had the flag
  // set, so the actual learner state was invisible to the composer. Now reads
  // whenever a curriculumId is in scope; the heuristic at line ~558 stays as
  // debug-only state.
  //
  // #1259 — CONTINUOUS courses skip this read; no per-module attempt tracking
  // for topic-pool conversations.
  if (courseStyle === "structured" && curriculumId && data.caller?.id) {
    try {
      const rows = await prisma.callerModuleProgress.findMany({
        where: {
          callerId: data.caller.id,
          module: { curriculumId },
        },
        select: {
          moduleId: true,
          callCount: true,
          status: true,
          completedAt: true,
        },
      });
      moduleAttemptCounts = {};
      for (const row of rows) {
        moduleAttemptCounts[row.moduleId] = {
          callCount: row.callCount,
          status: (row.status as "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED") ?? "NOT_STARTED",
          completedAt: row.completedAt,
        };
        if (row.callCount > 0) hasAttemptData = true;
      }
      console.log(
        `[modules] #266 + #1008: loaded ${rows.length} CallerModuleProgress rows; hasAttemptData=${hasAttemptData}`,
      );
    } catch (err) {
      console.warn("[modules] #266: callerModuleProgress query failed (non-blocking):", err);
    }
  }

  // #1008 (I-C5) — `estimatedProgress` is the legacy call-count heuristic.
  // Retained for trace-debugging and the `coveredModules` legacy consumer in
  // computeModuleProgress, but it is NO LONGER the primary driver of
  // `lastCompletedIndex`. The Maya case (#1006) is exactly the failure:
  // 2 prior calls → estimatedProgress=1 → lastCompletedIndex=0 → modules[0]
  // = Part 1, even though her single CallerModuleProgress row is on Part 2.
  //
  // #1259 — CONTINUOUS courses force estimatedProgress=0. The call-count
  // → module-index heuristic is meaningless without a fixed module
  // sequence; allowing it to fire for CONTINUOUS courses was the bug
  // class #1252 closes.
  const estimatedProgress = courseStyle === "continuous"
    ? 0
    : (completedModules.size > 0
        ? completedModules.size
        : Math.min(Math.floor(data.recentCalls.length / 2), modules.length - 1));

  // #1008 — three-layer derivation, in priority order:
  //   1. If any module passed the mastery gate (`completedModules`), pick the
  //      highest such index. Same as before.
  //   2. Else if `moduleAttemptCounts` has any row with callCount > 0, pick
  //      the highest index among modules the learner has actually touched —
  //      irrespective of whether that row hit the mastery threshold yet.
  //      This is the Maya path: she has a CallerModuleProgress on part2
  //      (mastery 0.59, callCount 6) below threshold but the lock must point
  //      there, not back to part1.
  //   3. Else fall through to the heuristic (legacy behaviour for callers
  //      with no DB rows at all).
  let lastCompletedIndex: number;
  if (completedModules.size > 0) {
    lastCompletedIndex = Math.max(...modules.map((m: ModuleData, i: number) =>
      completedModules.has(m.slug || m.id || '') ? i : -1
    ));
  } else if (moduleAttemptCounts) {
    const touchedIndex = Math.max(...modules.map((m: ModuleData, i: number) => {
      const key = m.slug || m.id || '';
      const counts = moduleAttemptCounts?.[key];
      return counts && counts.callCount > 0 ? i : -1;
    }));
    lastCompletedIndex = touchedIndex >= 0 ? touchedIndex : Math.max(0, estimatedProgress - 1);
  } else {
    lastCompletedIndex = Math.max(0, estimatedProgress - 1);
  }

  // Module to review — gated on real evidence of prior activity (any of:
  // a completed module, a CallerModuleProgress row with callCount > 0, or any
  // prior call in this caller's history). Without this gate, lastCompletedIndex
  // defaults to 0 so `modules[lastCompletedIndex]` ALWAYS resolves to modules[0]
  // and downstream pedagogy emits a "review your baseline work" block before
  // any call exists. See #554 Fix 2.
  const hasAnyPriorActivity =
    completedModules.size > 0 || hasAttemptData || data.recentCalls.length > 0;
  const moduleToReview = hasAnyPriorActivity
    ? (modules[lastCompletedIndex] || modules[0] || null)
    : null;

  // Next module = one after last completed
  const nextModuleIndex = lastCompletedIndex + 1;
  let nextModule = nextModuleIndex < modules.length ? modules[nextModuleIndex] : null;

  // =========================================================================
  // SCHEDULER-DRIVEN PACING — all courses use the scheduler
  // Session-based structured mode removed. See ADR: outcome-graph-pacing.md
  // =========================================================================
  let lessonPlanEntry: SharedComputedState['lessonPlanEntry'] = null;
  let workingSet: SharedComputedState['workingSet'] = null;
  let schedulerDecision: SharedComputedState['schedulerDecision'] = null;
  let schedulerPolicy: SharedComputedState['schedulerPolicy'] = null;
  let schedulerTotalMastered = 0;
  let schedulerTotalLOs = 0;

  // ── #274 Slice A: locked-module resolution ────────────────────────────
  // When the learner picked a specific module via the Module Picker, the
  // scheduler MUST be bypassed at compose time — otherwise selectNextExchange
  // overwrites `nextModule` with its frontier choice and downstream transforms
  // narrate the wrong module. Symmetric to the pipeline-side override at
  // pipeline/route.ts:108 (mastery scoring for end-of-call).
  let lockedModule: ModuleData | null = null;

  // #492 Slice 3.1 — DB-id route. `requestedModuleIdArg` is a
  // `CurriculumModule.id` threaded from `Call.curriculumModuleId` via
  // executeComposition. It is the most explicit signal (the pipeline
  // resolved the slug → id at call-create) so it wins over the
  // authored-id specConfig path. Match against the loaded `modules[]`
  // (which are CurriculumModule rows for DB-curricula and
  // notableInfo.modules for the subject-fallback path) by `id` or `slug`.
  if (requestedModuleIdArg) {
    const matchById = modules.find(
      (m) => m.id === requestedModuleIdArg || m.slug === requestedModuleIdArg,
    );
    if (matchById) {
      lockedModule = matchById;
      nextModule = matchById;
      console.log(
        `[modules] #492 Slice 3.1: locked to CurriculumModule "${matchById.slug || matchById.id}" (id="${requestedModuleIdArg}") — scheduler BYPASSED.`,
      );
    } else {
      console.warn(
        `[modules] #492 Slice 3.1: requestedModuleIdArg "${requestedModuleIdArg}" does not resolve to any CurriculumModule in the active curriculum — falling through to specConfig / scheduler.`,
      );
    }
  }

  const requestedModuleId = (specConfig.requestedModuleId as string | undefined) || undefined;
  if (!lockedModule && requestedModuleId) {
    // Match against Playbook.config.modules (the authored shape). The picker
    // emits the AuthoredModule.id as ?requestedModuleId=… so we match on id.
    // `pbConfig` is now declared earlier (just before moduleToReview) but kept
    // as a local `lockedPbConfig` here for the `unknown`-typed cast — the
    // authored-module shape is more permissive than the `any`-cast pbConfig.
    const lockedPbConfig = (data.playbooks?.[0]?.config || {}) as Record<string, unknown>;
    const authored = (Array.isArray(lockedPbConfig.modules) ? lockedPbConfig.modules : []) as Array<{
      id?: string;
      label?: string;
      outcomesPrimary?: unknown;
      prerequisites?: unknown;
      content?: Record<string, unknown>;
    }>;
    const match = authored.find((m) => m?.id === requestedModuleId);
    if (match) {
      // #554 Fix 1: outcomesPrimary holds bare refs ("OUT-01"). Resolve each
      // through lockedPbConfig.outcomes (Record<ref,text>) so the composed
      // prompt narrates the human statement, not the opaque ref id. Missing
      // entries fall back to the bare ref + console.warn — never silently
      // drop, so authoring mistakes are visible in logs.
      const outcomesMap = lockedPbConfig.outcomes as Record<string, string> | undefined;
      const resolveOutcome = (ref: string): string => {
        const text = outcomesMap?.[ref];
        if (!text) {
          console.warn(
            `[modules] #554 Fix 1: outcome ref "${ref}" not found in Playbook.config.outcomes — passing through bare ref`,
          );
          return ref;
        }
        return text;
      };
      lockedModule = {
        id: match.id,
        slug: match.id || "",
        // AuthoredModule has `label` not `name`; map for downstream `ModuleData` consumers.
        name: match.label || match.id || requestedModuleId,
        description: null,
        learningOutcomes: Array.isArray(match.outcomesPrimary)
          ? (match.outcomesPrimary as string[]).map(resolveOutcome)
          : undefined,
        prerequisites: Array.isArray(match.prerequisites) ? (match.prerequisites as string[]) : undefined,
        content: match.content,
      };
      // Force `nextModule` so quickstart's existing this_session / first_line
      // logic narrates the locked choice (Slice B will add explicit branches).
      nextModule = lockedModule;
      console.log(
        `[modules] #274 Slice A: locked to module "${requestedModuleId}" (label="${lockedModule.name}") — scheduler BYPASSED.`,
      );
    } else {
      // Fallback to scheduler — same behaviour as pipeline route's miss path.
      console.warn(
        `[modules] #274: requestedModuleId "${requestedModuleId}" not found in Playbook.config.modules — falling back to scheduler.`,
      );
    }
  }

  // #1008 (I-C1) — Module-lock honoured.
  // When `lockedModule` is set (either DB-id or authored-id path above), it
  // MUST drive every downstream "what session is this?" decision — including
  // `moduleToReview`. Pre-fix, `moduleToReview` was assigned 100 lines above
  // from `modules[lastCompletedIndex]` and never re-evaluated against the
  // lock. Maya's #1006 hallucination is exactly that: lockedModule=part2 but
  // moduleToReview still pointed at modules[0]=part1, so pedagogy.flow told
  // the AI to spaced-retrieve a module the learner had never touched.
  let moduleToReviewFinal: ModuleData | null = moduleToReview;
  if (lockedModule) {
    moduleToReviewFinal = lockedModule;
  }

  // Run scheduler ONLY when no locked module is in effect.
  // #1259 — Scheduler is STRUCTURED-only. CONTINUOUS courses get FREE_FLOW
  // at preset-resolution time (#1257); they don't run selectNextExchange.
  if (
    courseStyle === "structured" &&
    modules.length > 0 &&
    specSlug &&
    curriculumId &&
    !lockedModule
  ) {
    try {
      const { getTpProgressBatch } = await import("@/lib/curriculum/track-progress");
      const { selectNextExchange } = await import("@/lib/pipeline/scheduler");
      const { getPresetForPlaybook } = await import("@/lib/pipeline/scheduler-presets");
      const { readSchedulerDecision, persistSchedulerDecision } = await import("@/lib/pipeline/scheduler-decision");

      // Load all assertions for this curriculum (from loaded data) and
      // filter out non-teachable types (COURSE_REFERENCE = tutor rules).
      // See filterTeachableAssertions docstring + diagnosis 2026-04-14.
      const allAssertionsRaw = data.curriculumAssertions || [];
      const allAssertions = filterTeachableAssertions(allAssertionsRaw);
      const excludedCourseRefCount = allAssertionsRaw.length - allAssertions.length;
      if (excludedCourseRefCount > 0) {
        console.log(
          `[modules] Continuous mode: excluded ${excludedCourseRefCount} COURSE_REFERENCE assertions from working-set candidates (rendered separately by course-instructions transform)`
        );
      }

      // Load LOs from DB — include per-LO masteryThreshold override (#155)
      const dbLOs = await prisma.learningObjective.findMany({
        where: { module: { curriculumId, isActive: true } },
        select: { id: true, ref: true, moduleId: true, sortOrder: true, description: true, masteryThreshold: true },
        orderBy: [{ module: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      });

      // Get assertion IDs for progress lookup
      const assertionIds = allAssertions.map((a) => a.id);
      const callerId = data.caller?.id;

      if (callerId && assertionIds.length > 0 && dbLOs.length > 0) {
        const tpProgress = await getTpProgressBatch(callerId, specSlug, assertionIds);

        // Build LO mastery map from existing CallerAttributes — scoped to the
        // current curriculum spec slug to prevent cross-course bleed (#928).
        // The `specSlug` local is guaranteed truthy here by the enclosing
        // `modules.length > 0 && specSlug && curriculumId && !lockedModule`
        // gate (~line 684). Behaviour contract + grace-window rationale live
        // in `lib/prompt/composition/lo-mastery-map.ts`.
        const loMasteryMap = buildLoMasteryMap(data.callerAttributes, specSlug);

        const pbConfig = (data.playbooks?.[0]?.config || {}) as Record<string, any>;
        // #598 Slice 1 — call-1 may override duration via firstCall.durationMinsOverride.
        // Calls 2+ ignore the override and use the regular config.
        const firstCallDurationOverride =
          isFirstCall && typeof pbConfig.firstCall?.durationMinsOverride === "number"
            ? (pbConfig.firstCall.durationMinsOverride as number)
            : null;
        const callDurationMins =
          firstCallDurationOverride ?? (pbConfig.durationMins as number) ?? 15;
        // #598 Slice 1 — was `specConfig.thresholds?.masteryComplete ?? 0.7`,
        // now uses the resolved cascade (which incorporates that spec-config
        // layer at layer 5 and falls through to 0.7 at layer 7). The local
        // const is kept for readability at the scheduler call below.
        const threshold = resolvedMasteryThreshold;

        // Scheduler v1 Slice 2 (#155) — selectNextExchange replaces the
        // placeholder SchedulerDecision write from Slice 1. It delegates
        // candidate-pool selection to selectWorkingSet (via the runner) and
        // adds mode/outcome picking with explicit policy weights.
        const policy = getPresetForPlaybook(data.playbooks?.[0]);

        // Read prior decision to compute cadence counter. First call: null.
        const priorDecision = await readSchedulerDecision(callerId).catch(() => null);
        let pendingCount =
          priorDecision == null
            ? 0
            : priorDecision.mode === "assess"
              ? 1
              : (priorDecision.callsSinceAssess ?? 0) + 1;

        // #598 Slice 1 — `firstCallMode === "teach_immediately"` says "skip the
        // ONBOARDING-style opening and start teaching at call 1". The scheduler
        // shouldn't fire `mode: assess` on that same call just because the
        // cadence counter would have ticked over — clamp the counter at the
        // read site so the first call is always allowed to teach. Read-time
        // only: we DO NOT mutate the stored CallerAttribute.
        if (isFirstCall && pbConfig.firstCallMode === "teach_immediately") {
          if (pendingCount !== 0) {
            console.log(
              `[modules] #598 Slice 1: firstCallMode=teach_immediately — clamping callsSinceLastAssess ${pendingCount} → 0 for first call (read-time only).`,
            );
          }
          pendingCount = 0;
        }

        // #918 — Carry-forward planned-but-uncovered TPs.
        //
        // Diff the prior call's `workingSetAssertionIds` (what the scheduler
        // planned) against the post-pipeline `tpProgress` (what EXTRACT/AGGREGATE
        // moved off `not_started`). The result is the set of TPs the prior call
        // committed to teaching but never reached — typically because the
        // learner hung up early, ran out of time, or skipped ahead.
        //
        // Suppression: when prior decision was picker-locked (workingSetAssertionIds
        // is empty by design at modules.ts:929+), the diff is empty and no
        // boost fires. That lane is educator/learner-driven and shouldn't
        // blend with the system's autonomous catch-up.
        const priorPlannedAssertionIds: string[] =
          priorDecision?.workingSetAssertionIds
            ?.filter((tpId) => {
              const status = tpProgress[tpId]?.status;
              // "uncovered" = still not_started after the prior pipeline run.
              // in_progress / mastered means the learner did see it (we have
              // some signal, even partial), so carry-forward is unnecessary.
              return status === undefined || status === "not_started";
            }) ?? [];

        // #918 — Course-level boost magnitude. Cascades through the
        // Playbook.config.tolerances block per the #598 tolerance-placement ADR.
        // `selectWorkingSet` applies its own DEFAULT_CARRY_FORWARD_BOOST when
        // this is undefined AND the set is non-empty.
        const carryForwardBoost = pbConfig.tolerances?.carryForwardBoost;
        if (priorPlannedAssertionIds.length > 0) {
          console.log(
            `[modules] #918 carry-forward: ${priorPlannedAssertionIds.length} planned-but-uncovered TP(s) from prior call. ` +
            `boost=${carryForwardBoost ?? "default"}, suppressed=${priorDecision?.workingSetAssertionIds?.length === 0}`,
          );
        }

        const { decision, workingSet: wsResult } = selectNextExchange(
          {
            workingSetInput: {
              assertions: allAssertions.map((a) => ({
                id: a.id,
                learningObjectiveId: a.learningObjectiveId || null,
                learningOutcomeRef: a.learningOutcomeRef || null,
                depth: a.depth ?? null,
                orderIndex: a.orderIndex ?? 0,
              })),
              learningObjectives: dbLOs.map((lo) => ({
                id: lo.id,
                ref: lo.ref,
                moduleId: lo.moduleId,
                sortOrder: lo.sortOrder,
                description: lo.description,
                // Per-LO override (#155): nullable, falls back to input-level
                masteryThreshold: lo.masteryThreshold,
              })),
              modules: modules.map((m) => ({
                id: m.id || m.slug,
                slug: m.slug,
                name: m.name,
                sortOrder: m.sortOrder ?? m.sequence ?? 0,
                prerequisites: (m.prerequisites || []) as string[],
              })),
              tpMasteryMap: tpProgress,
              loMasteryMap,
              callDurationMins,
              masteryThreshold: threshold,
              // #918 — pass carry-forward signal into the candidate-pool layer
              priorPlannedAssertionIds,
              carryForwardBoost,
            },
            priorDecision,
            callsSinceLastAssess: pendingCount,
          },
          policy,
        );

        workingSet = {
          assertionIds: wsResult.assertionIds,
          reviewIds: wsResult.reviewIds,
          newIds: wsResult.newIds,
          selectedLOs: wsResult.selectedLOs,
        };

        // #164 — expose scheduler decision + policy so the retrieval-practice
        // transform can read the current mode and preset question counts
        // without doing its own DB lookups.
        schedulerDecision = {
          mode: decision.mode,
          outcomeId: decision.outcomeId,
        };
        schedulerPolicy = {
          name: policy.name,
          retrievalQuestions: policy.retrievalQuestions,
          retrievalBloomFloor: policy.retrievalBloomFloor,
          retrievalCadence: policy.retrievalCadence,
        };

        // Build synthetic lessonPlanEntry from working set.
        // `frontierModuleId` preserved verbatim to keep curriculum_guidance
        // and session_pedagogy rendering anchored to the same module the
        // scheduler picked from — the frontierModuleId contract flagged in #155.
        lessonPlanEntry = {
          session: 1,
          type: 'continuous',
          moduleId: wsResult.frontierModuleId || null,
          moduleLabel: 'Learning Programme',
          label: 'Adaptive session',
          phases: null,
          learningOutcomeRefs: null,
          assertionIds: wsResult.assertionIds,
          vocabularyIds: null,
          questionIds: null,
          media: null,
        };
        // Capture totals for isFinalSession calculation
        schedulerTotalMastered = wsResult.totalMastered;
        schedulerTotalLOs = wsResult.totalLOs;

        // Override nextModule to the frontier module
        if (wsResult.frontierModuleId) {
          const frontier = modules.find((m) => (m.id || m.slug) === wsResult.frontierModuleId);
          if (frontier) nextModule = frontier;
        }

        console.log(
          `[modules] Scheduler ${policy.name}: ${decision.mode} | ${wsResult.selectedLOs.length} LOs, ` +
          `${wsResult.assertionIds.length} TPs (${wsResult.reviewIds.length} review, ${wsResult.newIds.length} new). ` +
          `Progress: ${wsResult.totalMastered}/${wsResult.totalLOs} LOs mastered. | ${decision.reason}`
        );

        // Persist the real decision. EXTRACT on the next call reads this via
        // event-gate.ts to decide whether caller-skill scoring is allowed.
        try {
          const nextCallsSinceAssess = decision.mode === "assess" ? 0 : pendingCount;
          await persistSchedulerDecision(callerId, {
            mode: decision.mode,
            outcomeId: decision.outcomeId,
            contentSourceId: decision.contentSourceId,
            workingSetAssertionIds: decision.workingSetAssertionIds,
            reason: decision.reason,
            callsSinceAssess: nextCallsSinceAssess,
          });
        } catch (persistErr) {
          console.warn('[modules] Failed to persist SchedulerDecision (non-blocking):', persistErr);
        }
      }
    } catch (err) {
      console.error('[modules] Scheduler failed — composition will proceed without working set:', err);
    }
  }

  // #538 — when a module is locked (picker pick or SIM --module), the
  // scheduler block above is bypassed AND no SchedulerDecision is written.
  // event-gate.ts then keeps reading the prior decision, which often holds
  // `mode: "teach"` from earlier auto-cadence calls — so caller-level
  // skill aggregation stays gated off forever on courses that use the
  // picker. Persist a "practice" decision here so picker-driven calls
  // pass the gate (event-gate allows `assess`/`practice` per
  // config.scheduler.assessmentModes).
  //
  // "practice" is the right semantic: the learner explicitly chose a
  // module and is actively practising it. We deliberately do not run the
  // full pickMode() cadence — picker-driven calls sit outside the
  // teach→practice→assess→review cycle that pickMode() drives.
  if (lockedModule && data.caller?.id) {
    try {
      const { persistSchedulerDecision } = await import("@/lib/pipeline/scheduler-decision");
      const { SCHEDULER_REASONS } = await import("@/lib/pipeline/scheduler-reasons");
      await persistSchedulerDecision(data.caller.id, {
        mode: "practice",
        outcomeId: null,
        contentSourceId: null,
        workingSetAssertionIds: [],
        reason: SCHEDULER_REASONS.pickerLockedModule,
        callsSinceAssess: 0,
      });
      console.log(
        `[modules] #538: persisted SchedulerDecision mode=practice for locked module "${lockedModule.slug || lockedModule.id}" — caller scoring gate will allow.`,
      );
    } catch (err) {
      console.warn('[modules] #538: failed to persist locked-module SchedulerDecision (non-blocking):', err);
    }
  }

  // Determine review intensity based on time gap
  // Thresholds from specConfig (default: 14/7/3 days for reintroduce/deep_review/application)
  const reviewSchedule = specConfig.reviewSchedule || { reintroduce: 14, deepReview: 7, application: 3 };
  let reviewType = "quick_recall";
  let reviewReason = "Brief recall to activate prior knowledge";
  if (daysSinceLastCall >= reviewSchedule.reintroduce) {
    reviewType = "reintroduce";
    reviewReason = `${daysSinceLastCall} days since last session - rebuild understanding`;
  } else if (daysSinceLastCall >= reviewSchedule.deepReview) {
    reviewType = "deep_review";
    reviewReason = `${daysSinceLastCall} days gap - full review with new example`;
  } else if (daysSinceLastCall >= reviewSchedule.application) {
    reviewType = "application";
    reviewReason = `${daysSinceLastCall} days gap - application question to check retention`;
  }

  const thresholds = specConfig.thresholds || { high: 0.65, low: 0.35 };

  // pbConfig + sessionCount + moduleAttemptCounts + hasAttemptData are all
  // hoisted above moduleToReview (see #554 Fix 2). Reused here for
  // isFinalSession + returned shared state.

  // 1-based: this is the Nth call about to be composed.
  //
  // #1344 Slice 4 — single-counter cutover. Reads from the new
  // `nextLearnerFacingNumber` loader which sources from
  // `Session.learnerFacingNumber` (via createSession's
  // CallerSequenceCounter). Replaces the legacy `data.callCount + 1`
  // shape that counted ENDED Call rows with `prisma.call.count({endedAt:
  // not null})`. Two counters previously drifted (Bertie's hf_sandbox
  // case 2026-06-08: callCount-based reader said "(call #4)" while the
  // canonical Call.callSequence was 3). Class-rules (epic #1338) gate
  // which Sessions bump the number — sim drops / ghosts / short voice
  // calls do not.
  const callNumber = data.nextLearnerFacingNumber;
  const isFinalByBudget = !!(sessionCount && sessionCount > 0 && callNumber >= sessionCount);
  const isFinalByScheduler = schedulerTotalLOs > 0 && schedulerTotalMastered >= schedulerTotalLOs;
  const isFinalByModules = modules.length > 0 && completedModules.size >= modules.length;
  const isFinalSession = isFinalByBudget || isFinalByScheduler || isFinalByModules;

  return {
    channel,
    modules,
    isFirstCall,
    isFirstCallInDomain,
    isFinalSession,
    daysSinceLastCall,
    completedModules,
    estimatedProgress,
    lastCompletedIndex,
    // #1008 (I-C1) — emit the lock-aware value, not the heuristic-driven one.
    moduleToReview: moduleToReviewFinal,
    nextModule,
    reviewType,
    reviewReason,
    thresholds,
    curriculumMetadata: metadata,
    curriculumName: curriculumInfo?.name || null,
    curriculumSpecSlug: specSlug || undefined,
    // Scheduler-driven pacing
    callNumber,
    lessonPlanEntry,
    workingSet,
    // #142: LO ref → id map for FK-based assertion filtering in teaching-content
    loRefToIdMap,
    // #155 + #164: scheduler decision + policy for downstream transforms
    schedulerDecision,
    schedulerPolicy,
    // #266 Slice 1: per-learner module progress (authored courses only)
    moduleAttemptCounts,
    hasAttemptData,
    // #274 Slice A: locked module from picker (null when not picked or unmatched)
    lockedModule,
    // #598 Slice 1: resolved mastery threshold (7-layer cascade winner)
    resolvedMasteryThreshold,
  };
}

// =============================================================================
// CURRICULUM SECTION TRANSFORM
// =============================================================================

/**
 * Build the curriculum section for llmPrompt.
 */
registerTransform("computeModuleProgress", (
  _rawData: any,
  context: AssembledContext,
) => {
  const { sharedState, loadedData, resolvedSpecs } = context;
  const { modules, completedModules, estimatedProgress, lastCompletedIndex, nextModule } = sharedState;
  const callerAttributes = loadedData.callerAttributes;
  // #1344 Slice 4 — `totalCallCount` is the count of qualifying prior
  // learner sessions = `nextLearnerFacingNumber - 1`. Replaces the
  // legacy `loadedData.callCount` field.
  const totalCallCount = Math.max(0, loadedData.nextLearnerFacingNumber - 1);
  // #598 Slice 1 — read the resolved cascade winner stored by
  // computeSharedState. curriculumMetadata.masteryThreshold tracks the same
  // value but staying on the sharedState field keeps the read explicit when
  // the metadata is null. Fall back to the hardcoded default for legacy
  // test fixtures that build sharedState without the field.
  const masteryThreshold =
    sharedState.resolvedMasteryThreshold ?? MASTERY_THRESHOLD_FALLBACK;
  // #492 Slice 3.7: when the courseComplete loader reports a positive
  // verdict, EVERY module renders thin (titles only) and `nextModule` clears
  // — there is no "next" to push toward. The celebration section (priority 5)
  // carries the celebratory directive; this transform's job is to stop
  // pumping module bodies into a prompt that no longer needs them.
  const courseComplete =
    (loadedData as any).courseComplete?.courseComplete === true;
  // #492 Slice 3.2: identify the CURRENT module for this call so siblings can
  // be emitted with a thin shape (no `description` / `content` body). The
  // tutor only needs full TP/LO text for the module being taught right now —
  // sibling bodies bloat the prompt by ~6–12KB on a 4-module course. Current
  // module = lockedModule (picker pick) | nextModule (scheduler choice).
  // Slice 3.7: no current module when the course is complete.
  const lockedModule = (sharedState as Record<string, any>).lockedModule as ModuleData | null;
  const currentModuleKey: string | null = courseComplete
    ? null
    : (lockedModule && (lockedModule.slug || lockedModule.id || '')) ||
      (nextModule && (nextModule.slug || nextModule.id || '')) ||
      null;

  const curriculumAttrs = callerAttributes.filter((a: CallerAttributeData) =>
    a.key.includes("module") ||
    a.key.includes("curriculum") ||
    a.key.includes("mastery") ||
    a.key.includes("comprehension") ||
    a.key.includes("progress") ||
    a.sourceSpecSlug?.includes("CURR")
  );

  const nextContentAttrs = callerAttributes.filter((a: CallerAttributeData) =>
    a.key.includes("next_") ||
    a.key.includes("ready_for") ||
    a.key.includes("prerequisite")
  );

  const completedModulesList = Array.from(completedModules);
  const coveredModules = completedModulesList.length > 0
    ? completedModulesList
    : modules.slice(0, Math.max(0, estimatedProgress)).map((m: ModuleData) => m.slug || m.id || '');

  const getModuleKey = (m: ModuleData): string => m.slug || m.id || '';

  // #1010 follow-up (I-C1) — when a `lockedModule` is set, ONLY that module
  // is "in_progress". Other modules get their natural status (completed if
  // mastered, otherwise not_started). Pre-fix, the call-count heuristic
  // marked everything up to lastCompletedIndex as "in_progress" — which
  // meant Part 1 AND Part 2 both rendered as in_progress, and
  // renderPromptSummary's `.find(m => m.status === "in_progress")` picked
  // the FIRST in catalogue order (Part 1) for the "Current" line.
  const lockedKey = lockedModule ? getModuleKey(lockedModule) : null;
  const getModuleStatus = (m: ModuleData, idx: number): "completed" | "in_progress" | "not_started" => {
    if (completedModules.has(getModuleKey(m))) return "completed";
    if (lockedKey) {
      return getModuleKey(m) === lockedKey ? "in_progress" : "not_started";
    }
    if (idx <= lastCompletedIndex && totalCallCount > 0) return "in_progress";
    return "not_started";
  };

  // #266 Slice 1: per-learner attempt counts, when available
  const moduleAttemptCounts = sharedState.moduleAttemptCounts;
  const hasAttemptData = sharedState.hasAttemptData === true;
  const STATUS_LABEL: Record<"NOT_STARTED" | "IN_PROGRESS" | "COMPLETED", string> = {
    NOT_STARTED: "not started",
    IN_PROGRESS: "in progress",
    COMPLETED: "done",
  };

  // #492 Slice 3.4 — surface the current module's TEACHING_INSTRUCTION LOs
  // as a top-level first-class field. Per `loadModulesFromDB` they're parked
  // inside `assessorOutcomes.teachingInstruction[]` for every module, and
  // post-Slice-3.2 sibling thinning strips that body from non-current modules.
  // Hoisting the current module's instructions to the top means the tutor
  // can find per-module guidance in <1 second of context scanning — instead
  // of digging through the modules array. Empty array when no current module
  // resolves, when the module has no instructions, or when the module isn't
  // DB-loaded (Subject-fallback path doesn't populate assessorOutcomes).
  const currentModule = currentModuleKey
    ? modules.find((m: ModuleData) => (m.slug || m.id || '') === currentModuleKey)
    : null;
  const currentModuleTeachingInstructions: string[] =
    currentModule?.assessorOutcomes?.teachingInstruction ?? [];

  // #1906 — Module-content bundle. Pre-#1906 the composed prompt carried
  // full description+content ONLY for the current module; siblings were
  // pruned to thin shapes (id/slug/name/status). That meant a mid-call
  // module switch couldn't surface sibling content — the LLM proxy would
  // have to recompose against the new module before the next turn.
  //
  // Bundle approach: include description+content for ALL modules when
  // the prospective bundle fits within `PROMPT_MODULE_BUNDLE_BUDGET_CHARS`.
  // The Anthropic ephemeral prompt cache (`cache_control: ephemeral`,
  // threshold 4096 chars at `lib/voice/llm-proxy/translate-request.ts:146`)
  // amortises the cost after the first turn — bundle bytes don't change
  // across turns, so cache hit rate stays high.
  //
  // When the bundle would exceed budget (e.g. 20-module course with heavy
  // content), we fall back to the legacy current-only shape and log
  // `compose.module_bundle.budget_exceeded` so the operator can see the
  // skip happened.
  const PROMPT_MODULE_BUNDLE_BUDGET_CHARS = 80_000;
  // Description is a plain string; content is structured data (the
  // module's teachingPlan/passages/etc. shape). Both feed into the
  // composed-prompt JSON, so we estimate the bundle size using
  // JSON.stringify byte counts — a rough proxy for what the LLM proxy
  // ships to Anthropic.
  const projectedBundleSize = modules.reduce((sum: number, m: ModuleData) => {
    const descSize = m.description ? m.description.length : 0;
    let contentSize = 0;
    if (m.content !== undefined && m.content !== null) {
      try {
        contentSize = JSON.stringify(m.content).length;
      } catch {
        // Circular / non-serialisable content — treat as small. The
        // downstream JSON.stringify in the renderer would handle the
        // failure separately.
        contentSize = 0;
      }
    }
    return sum + descSize + contentSize;
  }, 0);
  const bundleAllModuleContent =
    projectedBundleSize <= PROMPT_MODULE_BUNDLE_BUDGET_CHARS;
  if (!bundleAllModuleContent && modules.length > 1) {
    console.warn(
      `[transforms/modules] bundle budget exceeded: ${projectedBundleSize} chars across ${modules.length} modules (budget ${PROMPT_MODULE_BUNDLE_BUDGET_CHARS}); falling back to current-only`,
    );
  }

  return {
    name: (sharedState as Record<string, any>).curriculumName || null,
    hasData: curriculumAttrs.length > 0 || modules.length > 0,
    totalModules: modules.length,
    completedModules: completedModulesList,
    coveredModules,
    completedCount: completedModules.size,
    estimatedProgress,
    masteryThreshold,
    // #266 Slice 1: gates module-aware opening line in _quickStart.first_line
    hasAttemptData,
    // #492 Slice 3.4 — top-level tutor guidance for the active module.
    currentModuleSlug: currentModuleKey,
    currentModuleTeachingInstructions,
    // #492 Slice 3.7 — phase + tutor note so downstream consumers know the
    // modules list is for context only when the course is done.
    coursePhase: courseComplete ? "complete" : "active",
    moduleListNote: courseComplete
      ? "(Course complete — this list is for context only.)"
      : null,
    modules: modules.map((m: ModuleData, idx: number) => {
      const learnerProgress = m.id ? moduleAttemptCounts?.[m.id] : undefined;
      const callCount = learnerProgress?.callCount ?? 0;
      const learnerStatus = learnerProgress?.status;
      // Prefer authored learner status when present; otherwise fall back to the
      // attribute-derived status used by every existing course.
      const renderedStatus: "completed" | "in_progress" | "not_started" =
        learnerStatus === "COMPLETED" ? "completed"
          : learnerStatus === "IN_PROGRESS" ? "in_progress"
          : learnerStatus === "NOT_STARTED" ? "not_started"
          : getModuleStatus(m, idx);
      const moduleKey = m.slug || m.id || '';
      // #1906 — Bundle mode: include `description` + `content` for ALL
      // modules when `bundleAllModuleContent` is true. Legacy (#492
      // Slice 3.2) thin-shape behaviour preserved when the bundle budget
      // would be exceeded, so a 20-module heavy-content course doesn't
      // balloon the prompt unboundedly. The LLM proxy's per-turn
      // CURRENT FOCUS directive (`lib/voice/llm-proxy/`) tells the tutor
      // which module is active; the bundle just keeps every module's
      // content reachable without a recompose on switch.
      const isCurrentModule = currentModuleKey !== null && moduleKey === currentModuleKey;
      const includeFullBody = bundleAllModuleContent || isCurrentModule;
      return {
        id: m.id,
        slug: moduleKey,
        name: m.name,
        ...(includeFullBody ? { description: m.description } : {}),
        order: m.sortOrder ?? m.sequence,
        prerequisites: m.prerequisites,
        masteryThreshold: m.masteryThreshold ?? masteryThreshold,
        isCompleted: renderedStatus === "completed",
        isCurrent: isCurrentModule,
        status: renderedStatus,
        // #266 Slice 1: per-learner attempt count (0 when no progress row, or when modulesAuthored !== true)
        callCount,
        statusLabel: STATUS_LABEL[
          learnerStatus
            ?? (renderedStatus === "completed" ? "COMPLETED" : renderedStatus === "in_progress" ? "IN_PROGRESS" : "NOT_STARTED")
        ],
        // Module content for LLM context. Bundle mode = all modules;
        // budget-exceeded fallback = current only (legacy behaviour).
        ...(includeFullBody ? { content: m.content } : {}),
      };
    }),
    // #492 Slice 3.7: clear `nextModule` once the course is complete — there
    // is no "next" to teach toward; the celebration section drives the call.
    nextModule: courseComplete
      ? null
      : nextModule
        ? {
            id: nextModule.id,
            slug: nextModule.slug || nextModule.id,
            name: nextModule.name,
            description: nextModule.description,
            content: nextModule.content,
          }
        : null,
    currentProgress: curriculumAttrs.map((a: CallerAttributeData) => ({
      key: a.key,
      value: getAttributeValue(a),
      confidence: a.confidence,
      source: a.sourceSpecSlug,
    })),
    nextContent: nextContentAttrs.map((a: CallerAttributeData) => ({
      key: a.key,
      value: getAttributeValue(a),
    })),
  };
});

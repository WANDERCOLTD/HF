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

// =============================================================================
// DB-FIRST MODULE LOADING (CurriculumModule model)
// =============================================================================

/**
 * Load modules from first-class CurriculumModule + LearningObjective records.
 * Returns ModuleData[] if records exist, null to fall back to JSON/spec paths.
 */
async function loadModulesFromDB(curriculumId: string): Promise<{ modules: ModuleData[]; loRefToIdMap: Map<string, string> } | null> {
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
    const modules = dbModules.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.title,
      description: m.description,
      sortOrder: m.sortOrder,
      sequence: m.sortOrder,
      masteryThreshold: m.masteryThreshold ?? 0.7,
      prerequisites: m.prerequisites,
      concepts: m.keyTerms,
      learningOutcomes: m.learningObjectives.map((lo) => lo.description),
    }));
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
 * Resolve the effective `lessonPlanMode` for a course given its curriculum
 * delivery config and playbook config.
 *
 * Explicit `deliveryConfig.lessonPlanMode === 'continuous'` wins. Otherwise,
 * `playbookConfig.teachingMode === 'comprehension'` also routes to continuous,
 * because comprehension courses are inherently linear reading courses that
 * interleave skills over a shared passage rather than sequencing through
 * discrete sessions. Everything else defaults to 'structured'.
 *
 * Exported for regression tests — see tests/lib/composition/modules.test.ts.
 */
export function resolveLessonPlanMode(
  deliveryConfig: Record<string, unknown> | null | undefined,
  playbookConfig: Record<string, unknown> | null | undefined,
): 'continuous' | 'structured' {
  if ((deliveryConfig?.lessonPlanMode as string) === 'continuous') return 'continuous';
  if ((playbookConfig?.teachingMode as string) === 'comprehension') return 'continuous';
  return 'structured';
}

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
function extractCurriculumMetadata(contentSpec: any): CurriculumMetadata | null {
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
      masteryThreshold: meta.masteryThreshold ?? 0.7,
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
function extractLegacyModules(contentSpec: any): ModuleData[] {
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
    masteryThreshold: m.masteryThreshold ?? 0.7,
  }));
}

/**
 * Extract modules from content spec - uses contract-driven approach first,
 * falls back to legacy paths for backward compatibility.
 */
function extractModules(contentSpec: any): { modules: ModuleData[]; metadata: CurriculumMetadata | null } {
  // Try contract-driven extraction first
  const metadata = extractCurriculumMetadata(contentSpec);

  if (metadata) {
    const modules = extractModulesFromParameters(contentSpec, metadata);
    if (modules.length > 0) {
      console.log(`[modules] Contract-driven extraction: found ${modules.length} modules via selector "${metadata.moduleSelector}"`);
      return { modules, metadata };
    }
  }

  // Fallback to legacy direct modules array
  const legacyModules = extractLegacyModules(contentSpec);
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
  data: LoadedDataContext
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
      masteryThreshold: 0.7,
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

  if (curriculumId) {
    const dbResult = await loadModulesFromDB(curriculumId);
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
    const subjectResult = extractSubjectCurriculumModules(data);
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
          masteryThreshold: 0.7,
        };
      }
      console.log(`[modules] Subject curriculum fallback: ${modules.length} modules from "${specSlug}"`);
    }
  }

  const masteryThreshold = metadata?.masteryThreshold ?? 0.7;

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

  // Track completed modules from callerAttributes
  // Use contract-defined storage pattern if available
  const completedModules = new Set<string>();
  const progressKeyPrefix = metadata?.progressKey
    ? `curriculum:${specSlug}:mastery:`
    : '';

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
        let moduleId = a.key
          .replace("mastery_", "")
          .replace("completed_", "")
          .replace(progressKeyPrefix, "");
        completedModules.add(moduleId);
      }
    });

  // Estimate progress: if no explicit tracking, assume ~1 module per 2 calls
  const estimatedProgress = completedModules.size > 0
    ? completedModules.size
    : Math.min(Math.floor(data.recentCalls.length / 2), modules.length - 1);

  // Find last completed module index
  const lastCompletedIndex = completedModules.size > 0
    ? Math.max(...modules.map((m: ModuleData, i: number) =>
        completedModules.has(m.slug || m.id || '') ? i : -1
      ))
    : Math.max(0, estimatedProgress - 1);

  // Module to review = last completed (or first if no progress)
  const moduleToReview = modules[lastCompletedIndex] || modules[0] || null;

  // Next module = one after last completed
  const nextModuleIndex = lastCompletedIndex + 1;
  let nextModule = nextModuleIndex < modules.length ? modules[nextModuleIndex] : null;

  // =========================================================================
  // LESSON PLAN SESSION TRACKING
  // If a lesson plan exists and onboarding is complete, use the lesson plan
  // entry for the current session to override module selection.
  // =========================================================================
  let currentSessionNumber: number | null = null;
  let lessonPlanSessionType: string | null = null;
  let lessonPlanEntry: SharedComputedState['lessonPlanEntry'] = null;

  // Load lesson plan from Subject curriculum deliveryConfig
  const subjects = data.subjectSources?.subjects;
  let lessonPlan: { estimatedSessions: number; entries: any[] } | null = null;
  let deliveryConfig: Record<string, any> | null = null;

  if (subjects?.length) {
    for (const subject of subjects) {
      const dc = subject.curriculum?.deliveryConfig as Record<string, any> | null;
      if (dc?.lessonPlan?.entries?.length) {
        lessonPlan = dc.lessonPlan;
        deliveryConfig = dc;
        break;
      }
    }
  }

  const playbookConfigForMode = data.playbooks?.[0]?.config as Record<string, unknown> | undefined;
  const lessonPlanMode = resolveLessonPlanMode(deliveryConfig, playbookConfigForMode);

  if (lessonPlan && onboardingSession?.isComplete) {
    // Read currentSession from callerAttributes
    const sessionAttr = data.callerAttributes.find(
      (a) => a.key.includes(':current_session') && a.scope === 'CURRICULUM'
    );
    currentSessionNumber = sessionAttr?.numberValue ?? null;

    if (currentSessionNumber) {
      const entry = lessonPlan.entries.find((e: any) => e.session === currentSessionNumber);
      if (entry) {
        lessonPlanSessionType = entry.type;
        lessonPlanEntry = {
          session: entry.session,
          type: entry.type,
          moduleId: entry.moduleId || null,
          moduleLabel: entry.moduleLabel || '',
          label: entry.label || '',
          phases: entry.phases || null,
          learningOutcomeRefs: entry.learningOutcomeRefs || null,
          assertionIds: entry.assertionIds || null,
          vocabularyIds: entry.vocabularyIds || null,
          questionIds: entry.questionIds || null,
          media: entry.media || null,
        };

        // Merge carry-forward TPs from previous session (weak-LO assertions)
        const carryForwardAttr = data.callerAttributes.find(
          (a) => a.key.includes(':carry_forward_tps') && a.scope === 'CURRICULUM'
        );
        if (carryForwardAttr?.stringValue && lessonPlanEntry) {
          try {
            const carryIds: string[] = JSON.parse(carryForwardAttr.stringValue);
            if (carryIds.length > 0) {
              const existingIds = lessonPlanEntry.assertionIds || [];
              // Prepend carry-forward (review first), deduplicate
              lessonPlanEntry.assertionIds = [...new Set([...carryIds, ...existingIds])];
              // Store carry-forward IDs for [Review] labeling in teaching-content
              (lessonPlanEntry as any).carryForwardAssertionIds = carryIds;
              console.log(`[modules] Merged ${carryIds.length} carry-forward TPs into session ${currentSessionNumber}`);
            }
          } catch { /* ignore malformed JSON */ }
        }

        // Override nextModule if entry specifies a moduleId
        if (entry.moduleId) {
          const entryModule = modules.find((m) => (m.id || m.slug) === entry.moduleId);
          if (entryModule) {
            nextModule = entryModule;
            console.log(
              `[modules] Lesson plan session ${currentSessionNumber}: ${entry.type} - ${entry.moduleLabel}`
            );
          }
        } else {
          console.log(
            `[modules] Lesson plan session ${currentSessionNumber}: ${entry.type} (cross-module)`
          );
        }
      } else {
        // Session number exceeds plan — curriculum complete
        console.log(
          `[modules] Lesson plan complete: session ${currentSessionNumber} > ${lessonPlan.estimatedSessions} entries`
        );
      }
    }
  }

  // =========================================================================
  // CONTINUOUS MODE — working set selector replaces session-based scoping
  // =========================================================================
  let workingSet: SharedComputedState['workingSet'] = null;

  if (lessonPlanMode === 'continuous' && modules.length > 0 && specSlug && curriculumId) {
    try {
      const { selectWorkingSet } = await import("@/lib/curriculum/working-set-selector");
      const { getTpProgressBatch } = await import("@/lib/curriculum/track-progress");

      // Load all assertions for this curriculum (from loaded data)
      const allAssertions = data.curriculumAssertions || [];

      // Load LOs from DB (real records with id, ref, moduleId)
      const dbLOs = await prisma.learningObjective.findMany({
        where: { module: { curriculumId, isActive: true } },
        select: { id: true, ref: true, moduleId: true, sortOrder: true, description: true },
        orderBy: [{ module: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      });

      // Get assertion IDs for progress lookup
      const assertionIds = allAssertions.map((a) => a.id);
      const callerId = data.caller?.id;

      if (callerId && assertionIds.length > 0 && dbLOs.length > 0) {
        const tpProgress = await getTpProgressBatch(callerId, specSlug, assertionIds);

        // Build LO mastery map from existing CallerAttributes
        const loMasteryMap: Record<string, number> = {};
        for (const attr of data.callerAttributes) {
          if (attr.key.includes(':lo_mastery:') && attr.scope === 'CURRICULUM') {
            const suffix = attr.key.split(':lo_mastery:')[1];
            if (suffix && suffix.length > 0 && attr.numberValue != null) {
              loMasteryMap[suffix] = attr.numberValue;
            }
          }
        }

        const pbConfig = (data.playbooks?.[0]?.config || {}) as Record<string, any>;
        const callDurationMins = (pbConfig.durationMins as number) || 15;
        const threshold = specConfig.thresholds?.masteryComplete ?? 0.7;

        const wsResult = selectWorkingSet({
          assertions: allAssertions.map((a) => ({
            id: a.id,
            learningObjectiveId: a.learningObjectiveId || null,
            learningOutcomeRef: a.learningOutcomeRef || null,
            depth: a.depth ?? null,
            orderIndex: a.orderIndex ?? 0,
          })),
          learningObjectives: dbLOs,
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
        });

        workingSet = {
          assertionIds: wsResult.assertionIds,
          reviewIds: wsResult.reviewIds,
          newIds: wsResult.newIds,
          selectedLOs: wsResult.selectedLOs,
        };

        // Build synthetic lessonPlanEntry from working set
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
        lessonPlanSessionType = 'continuous';
        currentSessionNumber = 1;

        // Override nextModule to the frontier module
        if (wsResult.frontierModuleId) {
          const frontier = modules.find((m) => (m.id || m.slug) === wsResult.frontierModuleId);
          if (frontier) nextModule = frontier;
        }

        console.log(
          `[modules] Continuous mode: selected ${wsResult.selectedLOs.length} LOs, ` +
          `${wsResult.assertionIds.length} TPs (${wsResult.reviewIds.length} review, ${wsResult.newIds.length} new). ` +
          `Progress: ${wsResult.totalMastered}/${wsResult.totalLOs} LOs mastered.`
        );
      }
    } catch (err) {
      console.error('[modules] Continuous mode selector failed, falling back to structured:', err);
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

  // Determine if this is the final teaching session
  const pbConfig = (data.playbooks?.[0]?.config || {}) as Record<string, any>;
  const sessionCount = pbConfig.sessionCount as number | undefined;
  const callNumber = currentSessionNumber ?? data.recentCalls.length;
  const isFinalBySessionCount = !!(sessionCount && sessionCount > 0 && callNumber >= sessionCount);
  const isFinalByModules = modules.length > 0 && completedModules.size >= modules.length;
  const isFinalSession = isFinalBySessionCount || isFinalByModules;

  return {
    channel,
    modules,
    isFirstCall,
    isFirstCallInDomain, // For domain-switch re-onboarding
    isFinalSession,
    daysSinceLastCall,
    completedModules,
    estimatedProgress,
    lastCompletedIndex,
    moduleToReview,
    nextModule,
    reviewType,
    reviewReason,
    thresholds,
    // Include metadata for downstream transforms
    curriculumMetadata: metadata,
    curriculumName: curriculumInfo?.name || null,
    curriculumSpecSlug: specSlug || undefined,
    // Lesson plan session tracking
    currentSessionNumber,
    lessonPlanSessionType,
    lessonPlanEntry,
    // Carry-forward TP IDs from previous session (for [Review] labeling)
    carryForwardAssertionIds: (lessonPlanEntry as any)?.carryForwardAssertionIds as string[] | undefined,
    // Continuous learning mode
    lessonPlanMode,
    workingSet,
    // #142: LO ref → id map for FK-based assertion filtering in teaching-content
    loRefToIdMap,
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
  const totalCallCount = loadedData.callCount;
  const masteryThreshold = (sharedState as Record<string, any>).curriculumMetadata?.masteryThreshold ?? 0.7;

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

  const getModuleStatus = (m: ModuleData, idx: number): "completed" | "in_progress" | "not_started" => {
    if (completedModules.has(getModuleKey(m))) return "completed";
    if (idx <= lastCompletedIndex && totalCallCount > 0) return "in_progress";
    return "not_started";
  };

  return {
    name: (sharedState as Record<string, any>).curriculumName || null,
    hasData: curriculumAttrs.length > 0 || modules.length > 0,
    totalModules: modules.length,
    completedModules: completedModulesList,
    coveredModules,
    completedCount: completedModules.size,
    estimatedProgress,
    masteryThreshold,
    modules: modules.map((m: ModuleData, idx: number) => ({
      id: m.id,
      slug: m.slug || m.id || '',
      name: m.name,
      description: m.description,
      order: m.sortOrder ?? m.sequence,
      prerequisites: m.prerequisites,
      masteryThreshold: m.masteryThreshold ?? masteryThreshold,
      isCompleted: completedModules.has(getModuleKey(m)),
      status: getModuleStatus(m, idx),
      // Include module content for LLM context
      content: m.content,
    })),
    nextModule: nextModule ? {
      id: nextModule.id,
      slug: nextModule.slug || nextModule.id,
      name: nextModule.name,
      description: nextModule.description,
      content: nextModule.content,
    } : null,
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

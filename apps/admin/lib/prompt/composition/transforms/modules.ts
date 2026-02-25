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
async function loadModulesFromDB(curriculumId: string): Promise<ModuleData[] | null> {
  try {
    const dbModules = await prisma.curriculumModule.findMany({
      where: { curriculumId, isActive: true },
      include: { learningObjectives: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    if (dbModules.length === 0) return null;
    return dbModules.map((m) => ({
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
  } catch (err: any) {
    console.warn("[modules] DB module load failed, falling back to JSON:", err.message);
    return null;
  }
}

/**
 * Try to find a curriculum ID from the loaded data context.
 * Looks in subjectSources → subjects → curriculum.
 */
function findCurriculumId(data: LoadedDataContext): string | null {
  const subjects = data.subjectSources?.subjects;
  if (!subjects?.length) return null;
  for (const subject of subjects) {
    if (subject.curriculum?.id) return subject.curriculum.id;
  }
  return null;
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
): Promise<SharedComputedState> {
  // DB-first: try CurriculumModule records before JSON paths
  const curriculumId = findCurriculumId(data);
  let modules: ModuleData[] = [];
  let metadata: CurriculumMetadata | null = null;
  let specSlug = resolvedSpecs.contentSpec?.slug || '';

  if (curriculumId) {
    const dbModules = await loadModulesFromDB(curriculumId);
    if (dbModules && dbModules.length > 0) {
      modules = dbModules;
      console.log(`[modules] DB-first: loaded ${modules.length} modules from CurriculumModule records`);
    }
  }

  // Fallback 1: Contract-driven extraction from CONTENT spec
  if (modules.length === 0) {
    const extracted = extractModules(resolvedSpecs.contentSpec);
    modules = extracted.modules;
    metadata = extracted.metadata;
  }

  // Fallback 2: Subject-based curriculum (JSON in notableInfo)
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

  const isFirstCall = data.recentCalls.length === 0;

  // Check if this is first call in current domain (for domain-switch re-onboarding)
  const onboardingSession = data.onboardingSession;
  const isFirstCallInDomain = !onboardingSession || !onboardingSession.isComplete;

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

  if (subjects?.length) {
    for (const subject of subjects) {
      const dc = subject.curriculum?.deliveryConfig as Record<string, any> | null;
      if (dc?.lessonPlan?.entries?.length) {
        lessonPlan = dc.lessonPlan;
        break;
      }
    }
  }

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
        };

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

  return {
    modules,
    isFirstCall,
    isFirstCallInDomain, // For domain-switch re-onboarding
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
    curriculumSpecSlug: specSlug || undefined,
    // Lesson plan session tracking
    currentSessionNumber,
    lessonPlanSessionType,
    lessonPlanEntry,
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
  const contentSpec = resolvedSpecs.contentSpec;
  const contentCfg = contentSpec?.config as Record<string, any> | null;
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
    name: contentCfg?.metadata?.curriculum?.name || contentCfg?.curriculum?.name || contentSpec?.name || null,
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

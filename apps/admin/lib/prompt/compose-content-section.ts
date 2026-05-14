/**
 * compose-content-section.ts
 *
 * Composes teaching content from CONTENT specs (specRole="CONTENT")
 * into a structured section with module progress for the caller detail UI.
 *
 * NO HARDCODED DEFAULTS - specs MUST provide all metadata
 * Uses CURRICULUM_PROGRESS_V1 contract for data conventions
 *
 * Naming clarification:
 * - CONTENT specs (specRole="CONTENT") define WHAT gets taught (e.g. QM-CONTENT-001)
 * - CURR-001 (specRole="EXTRACT") MEASURES progress through that material
 * - This file works with CONTENT specs, not CURR-001
 */

import { prisma } from "@/lib/prisma";
import { ContractRegistry } from "@/lib/contracts/registry";
import { CURRICULUM_REQUIRED_FIELDS } from "@/lib/curriculum/constants";
import type { SpecConfig } from "@/lib/types/json-fields";

interface CurriculumMetadata {
  type: 'sequential' | 'branching' | 'open-ended';
  trackingMode: 'module-based' | 'competency-based';
  moduleSelector: string;  // e.g., "section=content"
  moduleOrder: string;      // e.g., "sortBySequence"
  progressKey: string;      // e.g., "current_module"
  masteryThreshold: number;
}

interface CurriculumModule {
  id: string;
  name: string;
  description: string;
  content: any;
  sequence: number;
  prerequisites?: string[];
  status: 'not_started' | 'in_progress' | 'completed';
  mastery?: number;
}

interface CurriculumProgress {
  currentModuleId: string | null;
  modulesMastery: Record<string, number>;
  lastAccessedAt: string | null;
}

export interface ContentSection {
  name: string | null;
  hasData: boolean;
  modules: CurriculumModule[];
  nextModule: string | null;
  nextContent: any[];
  totalModules: number;
  completedCount: number;
  coveredModules: string[];
  currentProgress: CurriculumProgress | any[];
  completedModules: string[];
  estimatedProgress: number;
}

/**
 * Compose a content section from CONTENT specs for the caller detail UI.
 * Finds the active CONTENT spec via the domain's published playbook,
 * extracts modules, and enriches with caller progress.
 */
export async function composeContentSection(
  callerId: string,
  domainId: string
): Promise<ContentSection> {
  // 1. Find the CONTENT spec — enrollment-first, then domain fallback
  const playbookInclude = {
    items: {
      where: {
        itemType: 'SPEC' as const,
        isEnabled: true,
      },
      include: {
        spec: {
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            config: true,
            specRole: true,
            isActive: true,
          },
        },
      },
    },
  };

  // Resolve the caller's playbook via their ACTIVE CallerPlaybook enrolments.
  // Historically we fell back to `findFirst({ domainId, PUBLISHED })` when the
  // caller had no matching enrolment — that silently bound the content section
  // to a random playbook in multi-course domains. Removed: if the caller has
  // no enrolment, bail to the subject-curriculum fallback below rather than
  // picking a wrong playbook.
  let playbook = null;
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { callerId, status: "ACTIVE" },
    select: { playbookId: true },
  });

  if (enrollments.length > 0) {
    playbook = await prisma.playbook.findFirst({
      where: {
        id: { in: enrollments.map(e => e.playbookId) },
        status: 'PUBLISHED',
      },
      include: playbookInclude,
    });
  }

  // Find the CONTENT spec from playbook items
  const contentSpecItem = playbook?.items.find(
    item => item.spec?.specRole === 'CONTENT' && item.spec?.isActive
  );

  const contentSpec = contentSpecItem?.spec;

  if (!contentSpec) {
    // Fallback: try Subject curriculum
    return composeContentFromSubject(callerId, domainId);
  }

  // 2. Extract curriculum metadata (with sensible defaults)
  const metadata = await extractCurriculumMetadata(contentSpec);

  // 3. Extract modules from spec parameters using metadata selector
  const modules = extractModulesFromSpec(contentSpec, metadata);

  // 4. Load caller's progress for this curriculum
  const progress = await loadCallerProgress(
    callerId,
    contentSpec.slug,
    metadata.progressKey
  );

  // 5. Enhance modules with progress status
  // Use spec's masteryThreshold (required by contract)
  const enrichedModules = enrichModulesWithProgress(
    modules,
    progress,
    metadata.masteryThreshold
  );

  // 6. Determine next module based on curriculum type
  const nextModule = determineNextModule(
    enrichedModules,
    metadata.type,
    progress
  );

  // 7. Extract next content to teach
  const nextContent = nextModule
    ? extractNextContent(nextModule, progress)
    : [];

  return {
    name: contentSpec.name,
    hasData: true,
    modules: enrichedModules,
    nextModule: nextModule?.id || null,
    nextContent,
    totalModules: modules.length,
    completedCount: enrichedModules.filter(m => m.status === 'completed').length,
    coveredModules: enrichedModules
      .filter(m => m.status !== 'not_started')
      .map(m => m.id),
    currentProgress: progress,
    completedModules: enrichedModules
      .filter(m => m.status === 'completed')
      .map(m => m.id),
    estimatedProgress: calculateProgress(enrichedModules),
  };
}

/**
 * Extract curriculum metadata from spec
 * NO DEFAULTS - spec MUST provide all required fields per CURRICULUM_PROGRESS_V1 contract
 * Throws error if required metadata is missing
 */
async function extractCurriculumMetadata(spec: any): Promise<CurriculumMetadata> {
  const specConfig = spec.config as SpecConfig;
  const meta = specConfig?.metadata?.curriculum;

  if (!meta) {
    throw new Error(
      `Spec ${spec.slug} is missing required metadata.curriculum section. ` +
      `CONTENT specs MUST implement CURRICULUM_PROGRESS_V1 contract with full metadata.`
    );
  }

  // Load contract to get required fields
  const contract = await ContractRegistry.getContract('CURRICULUM_PROGRESS_V1');
  const contractMetadata = contract?.metadata?.curriculum || {};

  // Validate all required fields are present
  const missingFields: string[] = [];

  for (const field of CURRICULUM_REQUIRED_FIELDS) {
    if (meta[field] === undefined) {
      // Check if contract has a default
      const fieldDef = contractMetadata[field as keyof typeof contractMetadata] as Record<string, any> | undefined;
      if (!fieldDef?.default) {
        missingFields.push(field);
      }
    }
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Spec ${spec.slug} metadata.curriculum is missing required fields: ${missingFields.join(', ')}. ` +
      `See CURRICULUM_PROGRESS_V1 contract for requirements.`
    );
  }

  return {
    type: meta.type,
    trackingMode: meta.trackingMode,
    moduleSelector: meta.moduleSelector,
    moduleOrder: meta.moduleOrder,
    progressKey: meta.progressKey,
    masteryThreshold: meta.masteryThreshold,
  };
}

/**
 * Extract modules from spec parameters using metadata rules
 * FULLY GENERIC - works for any spec structure
 */
function extractModulesFromSpec(
  spec: any,
  metadata: CurriculumMetadata
): CurriculumModule[] {
  const specConfig = spec.config as SpecConfig;
  const params = specConfig?.parameters || [];

  // Parse selector (e.g., "section=content" → filter by section="content")
  const selectorParts = metadata.moduleSelector.split('=');
  const selectorKey = selectorParts[0];
  const selectorValue = selectorParts[1];

  // Filter parameters that match selector
  const moduleParams = params.filter((p: any) =>
    p[selectorKey] === selectorValue
  );

  // Transform parameters into modules
  const modules: CurriculumModule[] = moduleParams.map((p: any, index: number) => ({
    id: p.id,
    name: p.name || p.config?.chapterTitle || p.id,
    description: p.description || p.config?.description || '',
    content: p.config || {},
    sequence: p.sequence ?? p.config?.sequence ?? index,
    prerequisites: p.config?.prerequisites || [],
    status: 'not_started' as const,
    mastery: 0,
  }));

  // Sort modules based on metadata.moduleOrder
  return sortModules(modules, metadata.moduleOrder);
}

/**
 * Sort modules according to spec-defined ordering
 */
function sortModules(
  modules: CurriculumModule[],
  orderRule: string
): CurriculumModule[] {
  switch (orderRule) {
    case 'sortBySequence':
      return modules.sort((a, b) => a.sequence - b.sequence);

    case 'sortBySectionThenId':
      return modules.sort((a, b) => a.id.localeCompare(b.id));

    case 'explicit':
      // Spec provides explicit order in metadata.moduleOrder array
      return modules; // Already ordered by spec

    default:
      return modules.sort((a, b) => a.sequence - b.sequence);
  }
}

/**
 * Load caller's progress from CallerAttribute
 * Uses contract-defined storage keys - NO HARDCODING
 */
async function loadCallerProgress(
  callerId: string,
  specSlug: string,
  progressKey: string
): Promise<CurriculumProgress> {
  // Get storage keys from contract
  const storageKeys = await ContractRegistry.getStorageKeys('CURRICULUM_PROGRESS_V1');
  if (!storageKeys) {
    throw new Error('CURRICULUM_PROGRESS_V1 contract storage keys not found');
  }

  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');
  if (!keyPattern) {
    throw new Error('CURRICULUM_PROGRESS_V1 contract key pattern not found');
  }

  // Build the prefix by replacing variables in pattern
  const prefix = keyPattern
    .replace('{specSlug}', specSlug)
    .replace(':{key}', ':');

  const attributes = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      scope: 'CURRICULUM',
      key: {
        startsWith: prefix,
      },
    },
  });

  const progress: CurriculumProgress = {
    currentModuleId: null,
    modulesMastery: {},
    lastAccessedAt: null,
  };

  for (const attr of attributes) {
    const key = attr.key.replace(prefix, '');

    // Use contract-defined key names
    if (key === storageKeys.currentModule) {
      progress.currentModuleId = attr.stringValue;
    } else if (key.startsWith(storageKeys.mastery.replace(':{moduleId}', ':'))) {
      const moduleId = key.replace(storageKeys.mastery.replace(':{moduleId}', ':'), '');
      progress.modulesMastery[moduleId] = attr.numberValue || 0;
    } else if (key === storageKeys.lastAccessed) {
      progress.lastAccessedAt = attr.stringValue;
    }
  }

  return progress;
}

/**
 * Enrich modules with caller's progress status
 */
function enrichModulesWithProgress(
  modules: CurriculumModule[],
  progress: CurriculumProgress,
  masteryThreshold: number
): CurriculumModule[] {
  return modules.map(module => {
    const mastery = progress.modulesMastery[module.id] || 0;

    let status: CurriculumModule['status'];
    if (mastery >= masteryThreshold) {
      status = 'completed';
    } else if (module.id === progress.currentModuleId) {
      status = 'in_progress';
    } else if (mastery > 0) {
      status = 'in_progress';
    } else {
      status = 'not_started';
    }

    return {
      ...module,
      mastery,
      status,
    };
  });
}

/**
 * Determine next module based on curriculum type
 * GENERIC - handles sequential, branching, open-ended
 */
function determineNextModule(
  modules: CurriculumModule[],
  type: CurriculumMetadata['type'],
  progress: CurriculumProgress
): CurriculumModule | null {
  switch (type) {
    case 'sequential':
      // Find first incomplete module
      return modules.find(m => m.status !== 'completed') || null;

    case 'branching':
      // Check prerequisites, find next available
      return modules.find(m =>
        m.status !== 'completed' &&
        allPrerequisitesMet(m, modules)
      ) || null;

    case 'open-ended':
      // Learner chooses - suggest based on recent activity
      return progress.currentModuleId
        ? modules.find(m => m.id === progress.currentModuleId) || null
        : modules[0] || null;

    default:
      return modules.find(m => m.status !== 'completed') || null;
  }
}

/**
 * Check if all prerequisites for a module are met
 */
function allPrerequisitesMet(
  module: CurriculumModule,
  allModules: CurriculumModule[]
): boolean {
  if (!module.prerequisites?.length) return true;

  return module.prerequisites.every(prereqId => {
    const prereq = allModules.find(m => m.id === prereqId);
    return prereq?.status === 'completed';
  });
}

/**
 * Extract next content from module
 * Returns specific concepts/sections to teach next
 */
function extractNextContent(
  module: CurriculumModule,
  progress: CurriculumProgress
): any[] {
  // Module content could have sub-sections, concepts, etc.
  // Return them as structured content
  return [
    {
      moduleId: module.id,
      moduleName: module.name,
      content: module.content,
      // Could extract specific sub-sections here if needed
    }
  ];
}

/**
 * Calculate overall progress as average mastery across all modules
 */
function calculateProgress(modules: CurriculumModule[]): number {
  if (modules.length === 0) return 0;

  const totalMastery = modules.reduce((sum, m) => sum + (m.mastery || 0), 0);
  return totalMastery / modules.length;
}

const EMPTY_CONTENT_SECTION: ContentSection = {
  name: null,
  hasData: false,
  modules: [],
  nextModule: null,
  nextContent: [],
  totalModules: 0,
  completedCount: 0,
  coveredModules: [],
  currentProgress: [],
  completedModules: [],
  estimatedProgress: 0,
};

/**
 * Compose content section from Subject-based curriculum (fallback).
 * Uses Curriculum.notableInfo.modules when no CONTENT spec is found.
 */
async function composeContentFromSubject(
  callerId: string,
  domainId: string
): Promise<ContentSection> {
  // Try playbook curriculum first (direct link). Source-of-truth precedence:
  //   1. Relational CurriculumModule rows (populated by the projection layer
  //      added in #338). When this branch fires, the UI no longer reports
  //      "0/0 modules" on every goal card just because the legacy
  //      notableInfo.modules blob hasn't been populated.
  //   2. Legacy Curriculum.notableInfo.modules JSON (kept for back-compat
  //      with seed data that pre-dates the relational model).
  const { resolvePlaybookId } = await import("@/lib/enrollment/resolve-playbook");
  const enrolledPbId = await resolvePlaybookId(callerId);
  if (enrolledPbId) {
    const pbCurr = await prisma.curriculum.findFirst({
      where: { playbookId: enrolledPbId },
      orderBy: { updatedAt: "desc" },
      select: {
        slug: true,
        name: true,
        notableInfo: true,
        modules: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            slug: true,
            title: true,
            description: true,
            sortOrder: true,
          },
        },
      },
    });

    if (pbCurr) {
      // Path 1 — relational CurriculumModule rows.
      const relationalModules = pbCurr.modules ?? [];
      if (relationalModules.length > 0) {
        const modules: CurriculumModule[] = relationalModules.map((m, idx) => ({
          id: m.id,
          name: m.title || `Module ${idx + 1}`,
          description: m.description ?? "",
          content: m,
          sequence: m.sortOrder ?? idx,
          prerequisites: [],
          status: "not_started" as const,
          mastery: 0,
        }));

        const progress = await loadCallerProgress(callerId, pbCurr.slug, "current_module");
        const contractThresholds = await ContractRegistry.getThresholds("CURRICULUM_PROGRESS_V1");
        const masteryThreshold = contractThresholds?.masteryComplete ?? 0.7;
        const enrichedModules = enrichModulesWithProgress(modules, progress, masteryThreshold);
        const nextModule = enrichedModules.find((m) => m.status !== "completed") || null;
        const nextContent = nextModule
          ? [{ moduleId: nextModule.id, moduleName: nextModule.name, content: nextModule.content }]
          : [];

        return {
          name: pbCurr.name,
          hasData: true,
          modules: enrichedModules,
          nextModule: nextModule?.id || null,
          nextContent,
          totalModules: modules.length,
          completedCount: enrichedModules.filter((m) => m.status === "completed").length,
          coveredModules: enrichedModules.filter((m) => m.status !== "not_started").map((m) => m.id),
          currentProgress: progress,
          completedModules: enrichedModules.filter((m) => m.status === "completed").map((m) => m.id),
          estimatedProgress: calculateProgress(enrichedModules),
        };
      }

      // Path 2 — legacy notableInfo.modules JSON.
      const rawModules = (pbCurr.notableInfo as any)?.modules;
      if (Array.isArray(rawModules) && rawModules.length > 0) {
        const modules: CurriculumModule[] = rawModules.map((m: any, idx: number) => ({
          id: m.id,
          name: m.title || m.name || m.id,
          description: m.description || "",
          content: m,
          sequence: m.sortOrder ?? idx,
          prerequisites: [],
          status: "not_started" as const,
          mastery: 0,
        }));

        const progress = await loadCallerProgress(callerId, pbCurr.slug, "current_module");
        const contractThresholds = await ContractRegistry.getThresholds("CURRICULUM_PROGRESS_V1");
        const masteryThreshold = contractThresholds?.masteryComplete ?? 0.7;
        const enrichedModules = enrichModulesWithProgress(modules, progress, masteryThreshold);
        const nextModule = enrichedModules.find((m) => m.status !== "completed") || null;
        const nextContent = nextModule
          ? [{ moduleId: nextModule.id, moduleName: nextModule.name, content: nextModule.content }]
          : [];

        return {
          name: pbCurr.name,
          hasData: true,
          modules: enrichedModules,
          nextModule: nextModule?.id || null,
          nextContent,
          totalModules: modules.length,
          completedCount: enrichedModules.filter((m) => m.status === "completed").length,
          coveredModules: enrichedModules.filter((m) => m.status !== "not_started").map((m) => m.id),
          currentProgress: progress,
          completedModules: enrichedModules.filter((m) => m.status === "completed").map((m) => m.id),
          estimatedProgress: calculateProgress(enrichedModules),
        };
      }
    }
  }

  // Fallback: domain-wide Subject curriculum (legacy)
  const subjectDomains = await prisma.subjectDomain.findMany({
    where: { domainId },
    include: {
      subject: {
        include: {
          curricula: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: {
              slug: true,
              name: true,
              notableInfo: true,
            },
          },
        },
      },
    },
  });

  for (const sd of subjectDomains) {
    const curriculum = sd.subject.curricula[0];
    if (!curriculum?.notableInfo) continue;

    const rawModules = (curriculum.notableInfo as any)?.modules;
    if (!Array.isArray(rawModules) || rawModules.length === 0) continue;

    // Map Subject curriculum modules to CurriculumModule format
    const modules: CurriculumModule[] = rawModules.map((m: any, idx: number) => ({
      id: m.id,
      name: m.title || m.name || m.id,
      description: m.description || "",
      content: m,
      sequence: m.sortOrder ?? idx,
      prerequisites: [],
      status: "not_started" as const,
      mastery: 0,
    }));

    // Load progress using contract-defined keys
    const progress = await loadCallerProgress(callerId, curriculum.slug, "current_module");

    // Get mastery threshold from contract (not hardcoded)
    const contractThresholds = await ContractRegistry.getThresholds('CURRICULUM_PROGRESS_V1');
    const masteryThreshold = contractThresholds?.masteryComplete ?? 0.7;

    // Enrich modules with progress
    const enrichedModules = enrichModulesWithProgress(modules, progress, masteryThreshold);

    // Determine next module (sequential)
    const nextModule = enrichedModules.find(m => m.status !== "completed") || null;

    const nextContent = nextModule
      ? [{ moduleId: nextModule.id, moduleName: nextModule.name, content: nextModule.content }]
      : [];

    return {
      name: curriculum.name,
      hasData: true,
      modules: enrichedModules,
      nextModule: nextModule?.id || null,
      nextContent,
      totalModules: modules.length,
      completedCount: enrichedModules.filter(m => m.status === "completed").length,
      coveredModules: enrichedModules.filter(m => m.status !== "not_started").map(m => m.id),
      currentProgress: progress,
      completedModules: enrichedModules.filter(m => m.status === "completed").map(m => m.id),
      estimatedProgress: calculateProgress(enrichedModules),
    };
  }

  return EMPTY_CONTENT_SECTION;
}

/**
 * track-progress.ts
 *
 * Generic curriculum progress tracking
 * Stores progress as CallerAttributes using contract-defined key patterns
 *
 * NO HARDCODED KEY PATTERNS - reads from CURRICULUM_PROGRESS_V1 contract
 *
 * Key pattern defined by contract: curriculum:{specSlug}:{progressKey}
 * Examples:
 *   - curriculum:QM-CONTENT-001:current_module
 *   - curriculum:QM-CONTENT-001:mastery:chapter1_blackbody
 *   - curriculum:QM-CONTENT-001:last_accessed
 */

import { prisma } from "@/lib/prisma";
import { ContractRegistry } from "@/lib/contracts/registry";
import { getTrustSettings, TRUST_DEFAULTS } from "@/lib/system-settings";

interface ProgressUpdate {
  currentModuleId?: string;
  moduleMastery?: Record<string, number>;
  /** Per-LO mastery outcomes for a specific module */
  loMastery?: { moduleId: string; outcomes: Record<string, number> };
  lastAccessedAt?: Date;
}

/**
 * Build storage key using contract-defined pattern
 * NO HARDCODING - reads pattern from CURRICULUM_PROGRESS_V1 contract
 */
async function buildStorageKey(specSlug: string, keyName: string, moduleId?: string, loRef?: string): Promise<string> {
  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');
  const storageKeys = await ContractRegistry.getStorageKeys('CURRICULUM_PROGRESS_V1');

  if (!keyPattern || !storageKeys) {
    throw new Error('CURRICULUM_PROGRESS_V1 contract not loaded or invalid');
  }

  // Get the key template from contract
  const keyTemplate = storageKeys[keyName as keyof typeof storageKeys];
  if (!keyTemplate) {
    throw new Error(`Unknown storage key: ${keyName}. Check CURRICULUM_PROGRESS_V1 contract.`);
  }

  // Replace variables in pattern
  let key = keyPattern
    .replace('{specSlug}', specSlug)
    .replace('{key}', keyTemplate);

  // Replace moduleId if present in template
  if (moduleId && key.includes('{moduleId}')) {
    key = key.replace('{moduleId}', moduleId);
  }

  // Replace loRef if present in template
  if (loRef && key.includes('{loRef}')) {
    key = key.replace('{loRef}', loRef);
  }

  return key;
}

/**
 * Update curriculum progress for a caller
 * GENERIC - works for any curriculum spec
 * Uses contract-defined storage keys
 */
export async function updateCurriculumProgress(
  callerId: string,
  specSlug: string,
  updates: ProgressUpdate
): Promise<void> {
  const writes: Promise<any>[] = [];

  // Update current module
  if (updates.currentModuleId !== undefined) {
    const key = await buildStorageKey(specSlug, 'currentModule');
    writes.push(
      prisma.callerAttribute.upsert({
        where: {
          callerId_key_scope: {
            callerId,
            key,
            scope: 'CURRICULUM',
          },
        },
        create: {
          callerId,
          key,
          scope: 'CURRICULUM',
          valueType: 'STRING',
          stringValue: updates.currentModuleId,
        },
        update: {
          stringValue: updates.currentModuleId,
        },
      })
    );
  }

  // Update module mastery scores
  if (updates.moduleMastery) {
    for (const [moduleId, mastery] of Object.entries(updates.moduleMastery)) {
      const key = await buildStorageKey(specSlug, 'mastery', moduleId);
      writes.push(
        prisma.callerAttribute.upsert({
          where: {
            callerId_key_scope: {
              callerId,
              key,
              scope: 'CURRICULUM',
            },
          },
          create: {
            callerId,
            key,
            scope: 'CURRICULUM',
            valueType: 'NUMBER',
            numberValue: mastery,
          },
          update: {
            numberValue: mastery,
          },
        })
      );
    }
  }

  // Update per-LO mastery outcomes
  if (updates.loMastery) {
    for (const [loRef, score] of Object.entries(updates.loMastery.outcomes)) {
      const key = await buildStorageKey(specSlug, 'loMastery', updates.loMastery.moduleId, loRef);
      writes.push(
        prisma.callerAttribute.upsert({
          where: {
            callerId_key_scope: {
              callerId,
              key,
              scope: 'CURRICULUM',
            },
          },
          create: {
            callerId,
            key,
            scope: 'CURRICULUM',
            valueType: 'NUMBER',
            numberValue: score,
          },
          update: {
            numberValue: score,
          },
        })
      );
    }
  }

  // currentSession write removed — scheduler owns pacing

  // Update last accessed timestamp
  if (updates.lastAccessedAt !== undefined) {
    const key = await buildStorageKey(specSlug, 'lastAccessed');
    writes.push(
      prisma.callerAttribute.upsert({
        where: {
          callerId_key_scope: {
            callerId,
            key,
            scope: 'CURRICULUM',
          },
        },
        create: {
          callerId,
          key,
          scope: 'CURRICULUM',
          valueType: 'STRING',
          stringValue: updates.lastAccessedAt.toISOString(),
        },
        update: {
          stringValue: updates.lastAccessedAt.toISOString(),
        },
      })
    );
  }

  await Promise.all(writes);

  // Dual-write: also update CallerModuleProgress if moduleId maps to a DB record
  if (updates.moduleMastery) {
    for (const [moduleId, mastery] of Object.entries(updates.moduleMastery)) {
      try {
        await updateModuleMastery(callerId, moduleId, mastery);
      } catch {
        // Non-fatal — CallerModuleProgress is supplementary during transition
      }
    }
  }
}

/**
 * Phase 0 safety cap from issue #397: mastery cannot exceed `callCount / MASTERY_MIN_CALLS_TO_FULL`.
 * Caps a single-call AI snapshot of 0.7 to ~0.167 after call #1, ~0.333 after call #2, etc.
 * Phase 1 will replace this with LO-derived accumulation; the cap then becomes a no-op.
 */
const MASTERY_MIN_CALLS_TO_FULL = 6;

export function capMasteryByCallCount(rawMastery: number, callCountAfterThisCall: number): number {
  const cap = Math.min(1.0, callCountAfterThisCall / MASTERY_MIN_CALLS_TO_FULL);
  return Math.min(rawMastery, cap);
}

/**
 * Update mastery for a specific module using the first-class CallerModuleProgress model.
 * moduleId can be either a CurriculumModule.id (UUID) or a slug (e.g. "MOD-1").
 */
export async function updateModuleMastery(
  callerId: string,
  moduleId: string,
  mastery: number,
  callId?: string,
): Promise<void> {
  // Resolve slug to id if needed (slugs aren't UUIDs)
  let resolvedModuleId = moduleId;
  if (!moduleId.includes("-") || moduleId.startsWith("MOD-")) {
    const mod = await prisma.curriculumModule.findFirst({
      where: { slug: moduleId },
      select: { id: true },
    });
    if (!mod) return; // Module not in DB yet — skip silently
    resolvedModuleId = mod.id;
  }

  const existing = await prisma.callerModuleProgress.findUnique({
    where: { callerId_moduleId: { callerId, moduleId: resolvedModuleId } },
    select: { callCount: true },
  });
  const effectiveCallCount = (existing?.callCount ?? 0) + 1;
  const cappedMastery = capMasteryByCallCount(mastery, effectiveCallCount);

  const status = cappedMastery >= 1.0 ? "COMPLETED" : cappedMastery > 0 ? "IN_PROGRESS" : "NOT_STARTED";

  await prisma.callerModuleProgress.upsert({
    where: {
      callerId_moduleId: { callerId, moduleId: resolvedModuleId },
    },
    create: {
      callerId,
      moduleId: resolvedModuleId,
      mastery: cappedMastery,
      status,
      startedAt: cappedMastery > 0 ? new Date() : null,
      completedAt: cappedMastery >= 1.0 ? new Date() : null,
      lastCallId: callId || null,
      callCount: 1,
    },
    update: {
      mastery: cappedMastery,
      status,
      completedAt: cappedMastery >= 1.0 ? new Date() : null,
      lastCallId: callId || undefined,
      callCount: { increment: 1 },
    },
  });
}

/**
 * Get curriculum progress for a caller
 * Returns structured progress data using contract-defined keys
 */
export async function getCurriculumProgress(
  callerId: string,
  specSlug: string
): Promise<{
  currentModuleId: string | null;
  modulesMastery: Record<string, number>;
  /** Per-LO mastery: { moduleId: { loRef: score } } */
  loMastery: Record<string, Record<string, number>>;
  lastAccessedAt: string | null;
}> {
  // Get contract keys
  const storageKeys = await ContractRegistry.getStorageKeys('CURRICULUM_PROGRESS_V1');
  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');

  if (!storageKeys || !keyPattern) {
    throw new Error('CURRICULUM_PROGRESS_V1 contract not loaded');
  }

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

  const progress = {
    currentModuleId: null as string | null,
    modulesMastery: {} as Record<string, number>,
    loMastery: {} as Record<string, Record<string, number>>,
    lastAccessedAt: null as string | null,
  };

  // Build match prefixes from contract keys
  const masteryPrefix = storageKeys.mastery.replace(':{moduleId}', ':');
  const loMasteryPrefix = storageKeys.loMastery
    ? storageKeys.loMastery.replace(':{moduleId}:{loRef}', ':')
    : null;

  for (const attr of attributes) {
    const key = attr.key.replace(prefix, '');

    if (key === storageKeys.currentModule) {
      progress.currentModuleId = attr.stringValue;
    } else if (loMasteryPrefix && key.startsWith(loMasteryPrefix)) {
      // Parse lo_mastery:MODULE_ID:LO_REF
      const rest = key.replace(loMasteryPrefix, '');
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const moduleId = rest.substring(0, colonIdx);
        const loRef = rest.substring(colonIdx + 1);
        if (!progress.loMastery[moduleId]) progress.loMastery[moduleId] = {};
        progress.loMastery[moduleId][loRef] = attr.numberValue || 0;
      }
    } else if (key.startsWith(masteryPrefix)) {
      const moduleId = key.replace(masteryPrefix, '');
      progress.modulesMastery[moduleId] = attr.numberValue || 0;
    } else if (key === storageKeys.lastAccessed) {
      progress.lastAccessedAt = attr.stringValue;
    // currentSession parsing removed — scheduler owns pacing
    }
  }

  return progress;
}

/**
 * Mark a module as completed
 * Sets mastery to 1.0 and advances to next module if sequential
 */
export async function completeModule(
  callerId: string,
  specSlug: string,
  moduleId: string,
  nextModuleId?: string
): Promise<void> {
  const updates: ProgressUpdate = {
    moduleMastery: {
      [moduleId]: 1.0,
    },
    lastAccessedAt: new Date(),
  };

  if (nextModuleId) {
    updates.currentModuleId = nextModuleId;
  }

  await updateCurriculumProgress(callerId, specSlug, updates);
}

/**
 * Reset curriculum progress for a caller
 * Useful for retaking a curriculum or debugging
 * Uses contract-defined key pattern
 */
export async function resetCurriculumProgress(
  callerId: string,
  specSlug: string
): Promise<void> {
  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');
  if (!keyPattern) {
    throw new Error('CURRICULUM_PROGRESS_V1 contract not loaded');
  }

  const prefix = keyPattern
    .replace('{specSlug}', specSlug)
    .replace(':{key}', ':');

  await prisma.callerAttribute.deleteMany({
    where: {
      callerId,
      scope: 'CURRICULUM',
      key: {
        startsWith: prefix,
      },
    },
  });
}

/**
 * Get all curricula a caller has progress in
 * Uses contract-defined key pattern to identify curriculum data
 */
export async function getActiveCurricula(
  callerId: string
): Promise<string[]> {
  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');
  if (!keyPattern) {
    throw new Error('CURRICULUM_PROGRESS_V1 contract not loaded');
  }

  // Extract the prefix before {specSlug}
  const patternParts = keyPattern.split('{specSlug}');
  const prefix = patternParts[0];  // e.g., "curriculum:"

  const attributes = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      scope: 'CURRICULUM',
      key: {
        startsWith: prefix,
      },
    },
    select: {
      key: true,
    },
  });

  // Extract unique spec slugs from keys like "curriculum:QM-CONTENT-001:current_module"
  const specSlugs = new Set<string>();
  for (const attr of attributes) {
    // Parse using the contract pattern
    const withoutPrefix = attr.key.substring(prefix.length);
    const nextColon = withoutPrefix.indexOf(':');
    if (nextColon > 0) {
      const specSlug = withoutPrefix.substring(0, nextColon);
      specSlugs.add(specSlug);
    }
  }

  return Array.from(specSlugs);
}

// =============================================================================
// TRUST-WEIGHTED PROGRESS (CONTENT_TRUST_V1 contract)
// =============================================================================

// Trust level weights — loaded from system settings, fallback to TRUST_DEFAULTS
let TRUST_WEIGHTS: Record<string, number> = {
  REGULATORY_STANDARD: TRUST_DEFAULTS.weightL5Regulatory,
  ACCREDITED_MATERIAL: TRUST_DEFAULTS.weightL4Accredited,
  PUBLISHED_REFERENCE: TRUST_DEFAULTS.weightL3Published,
  EXPERT_CURATED: TRUST_DEFAULTS.weightL2Expert,
  AI_ASSISTED: TRUST_DEFAULTS.weightL1AiAssisted,
  UNVERIFIED: TRUST_DEFAULTS.weightL0Unverified,
};

// Minimum trust weight for certification readiness (L3+)
let CERTIFICATION_MIN_WEIGHT = TRUST_DEFAULTS.certificationMinWeight;

async function loadTrustConstants() {
  const s = await getTrustSettings();
  TRUST_WEIGHTS = {
    REGULATORY_STANDARD: s.weightL5Regulatory,
    ACCREDITED_MATERIAL: s.weightL4Accredited,
    PUBLISHED_REFERENCE: s.weightL3Published,
    EXPERT_CURATED: s.weightL2Expert,
    AI_ASSISTED: s.weightL1AiAssisted,
    UNVERIFIED: s.weightL0Unverified,
  };
  CERTIFICATION_MIN_WEIGHT = s.certificationMinWeight;
}

interface TrustWeightedProgress {
  certifiedMastery: number;    // 0-1, only L4+ content
  supplementaryMastery: number; // 0-1, all content
  certificationReadiness: number; // 0-1, weighted composite
  moduleBreakdown: Record<string, {
    mastery: number;
    trustLevel: string;
    trustWeight: number;
    countsToCertification: boolean;
  }>;
}

/**
 * Compute trust-weighted progress for a caller's curriculum.
 *
 * Dual-track:
 * - certifiedMastery: only modules with L4+ trust
 * - supplementaryMastery: all modules
 * - certificationReadiness: weighted average of certified modules
 *
 * Module trust levels come from the CONTENT spec's sourceRefs.
 */
export async function computeTrustWeightedProgress(
  moduleMastery: Record<string, number>,
  moduleTrustLevels: Record<string, string>,
): Promise<TrustWeightedProgress> {
  await loadTrustConstants();
  const moduleBreakdown: TrustWeightedProgress['moduleBreakdown'] = {};

  let certifiedWeightedSum = 0;
  let certifiedTotalWeight = 0;
  let allWeightedSum = 0;
  let allTotalWeight = 0;

  for (const [moduleId, mastery] of Object.entries(moduleMastery)) {
    const trustLevel = moduleTrustLevels[moduleId];
    if (!trustLevel) {
      console.warn(`[track-progress] No trust level for module ${moduleId}, defaulting to UNVERIFIED`);
    }
    const effectiveTrustLevel = trustLevel || 'UNVERIFIED';
    const weight = TRUST_WEIGHTS[effectiveTrustLevel] ?? 0.05;
    const countsToCertification = weight >= CERTIFICATION_MIN_WEIGHT;

    moduleBreakdown[moduleId] = {
      mastery,
      trustLevel: effectiveTrustLevel,
      trustWeight: weight,
      countsToCertification,
    };

    // All content counts toward general understanding
    allWeightedSum += mastery * weight;
    allTotalWeight += weight;

    // Only L4+ counts toward certification
    if (countsToCertification) {
      certifiedWeightedSum += mastery * weight;
      certifiedTotalWeight += weight;
    }
  }

  const certifiedMastery = certifiedTotalWeight > 0
    ? certifiedWeightedSum / certifiedTotalWeight
    : 0;

  const supplementaryMastery = allTotalWeight > 0
    ? allWeightedSum / allTotalWeight
    : 0;

  return {
    certifiedMastery,
    supplementaryMastery,
    certificationReadiness: certifiedMastery,
    moduleBreakdown,
  };
}

/**
 * Extract module trust levels from a CONTENT spec's modules.
 * Reads sourceRefs from each module and picks the highest trust level.
 */
export async function extractModuleTrustLevels(
  modules: Array<{ id: string; sourceRefs?: Array<{ trustLevel: string }> }>,
): Promise<Record<string, string>> {
  await loadTrustConstants();
  const result: Record<string, string> = {};

  for (const mod of modules) {
    if (!mod.sourceRefs || mod.sourceRefs.length === 0) {
      result[mod.id] = 'UNVERIFIED';
      continue;
    }

    // Pick highest trust level from sourceRefs
    let highestWeight = 0;
    let highestLevel = 'UNVERIFIED';

    for (const ref of mod.sourceRefs) {
      const weight = TRUST_WEIGHTS[ref.trustLevel] ?? 0;
      if (weight > highestWeight) {
        highestWeight = weight;
        highestLevel = ref.trustLevel;
      }
    }

    result[mod.id] = highestLevel;
  }

  return result;
}

/**
 * Store trust-weighted progress in CallerAttributes.
 * Uses CONTENT_TRUST_V1 contract key pattern: trust_progress:{specSlug}:{key}
 */
// =============================================================================
// PER-TP MASTERY (Continuous Learning Mode)
// =============================================================================

export interface TpProgress {
  mastery: number;
  status: "not_started" | "in_progress" | "mastered";
}

export interface TpProgressSummary {
  totalTps: number;
  mastered: number;
  inProgress: number;
  notStarted: number;
}

/**
 * Batch-read TP mastery for a set of assertion IDs.
 * Returns a map of assertionId → TpProgress.
 * Missing entries default to not_started / 0.
 */
export async function getTpProgressBatch(
  callerId: string,
  specSlug: string,
  assertionIds: string[],
): Promise<Record<string, TpProgress>> {
  if (assertionIds.length === 0) return {};

  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');
  if (!keyPattern) throw new Error('CURRICULUM_PROGRESS_V1 contract not loaded');

  const prefix = keyPattern
    .replace('{specSlug}', specSlug)
    .replace(':{key}', ':');

  // Fetch all tp_status and tp_mastery attributes in one query
  const attributes = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      scope: 'CURRICULUM',
      OR: [
        { key: { startsWith: `${prefix}tp_status:` } },
        { key: { startsWith: `${prefix}tp_mastery:` } },
      ],
    },
  });

  // Parse into map
  const result: Record<string, TpProgress> = {};
  for (const id of assertionIds) {
    result[id] = { mastery: 0, status: "not_started" };
  }

  for (const attr of attributes) {
    const key = attr.key.replace(prefix, '');
    if (key.startsWith('tp_status:')) {
      const assertionId = key.replace('tp_status:', '');
      if (result[assertionId]) {
        result[assertionId].status = (attr.stringValue as TpProgress["status"]) || "not_started";
      }
    } else if (key.startsWith('tp_mastery:')) {
      const assertionId = key.replace('tp_mastery:', '');
      if (result[assertionId]) {
        result[assertionId].mastery = attr.numberValue || 0;
      }
    }
  }

  return result;
}

/**
 * Get summary counts of TP progress for a curriculum (continuous mode).
 * Counts all tp_status attributes for the spec.
 */
export async function getTpProgressSummary(
  callerId: string,
  specSlug: string,
): Promise<TpProgressSummary> {
  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');
  if (!keyPattern) throw new Error('CURRICULUM_PROGRESS_V1 contract not loaded');

  const prefix = keyPattern
    .replace('{specSlug}', specSlug)
    .replace(':{key}', ':');

  const attributes = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      scope: 'CURRICULUM',
      key: { startsWith: `${prefix}tp_status:` },
    },
    select: { stringValue: true },
  });

  let mastered = 0;
  let inProgress = 0;
  let notStarted = 0;

  for (const attr of attributes) {
    switch (attr.stringValue) {
      case 'mastered': mastered++; break;
      case 'in_progress': inProgress++; break;
      default: notStarted++; break;
    }
  }

  return { totalTps: attributes.length, mastered, inProgress, notStarted };
}

/**
 * Batch version of getTpProgressSummary for multiple callers.
 * Single DB query instead of N separate queries.
 */
export async function getTpProgressSummaryBatch(
  callerIds: string[],
  specSlug: string,
): Promise<Map<string, TpProgressSummary>> {
  if (callerIds.length === 0) return new Map();

  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');
  if (!keyPattern) throw new Error('CURRICULUM_PROGRESS_V1 contract not loaded');

  const prefix = keyPattern
    .replace('{specSlug}', specSlug)
    .replace(':{key}', ':');

  const attributes = await prisma.callerAttribute.findMany({
    where: {
      callerId: { in: callerIds },
      scope: 'CURRICULUM',
      key: { startsWith: `${prefix}tp_status:` },
    },
    select: { callerId: true, stringValue: true },
  });

  const result = new Map<string, TpProgressSummary>();
  for (const id of callerIds) {
    result.set(id, { totalTps: 0, mastered: 0, inProgress: 0, notStarted: 0 });
  }
  for (const attr of attributes) {
    const summary = result.get(attr.callerId)!;
    summary.totalTps++;
    switch (attr.stringValue) {
      case 'mastered': summary.mastered++; break;
      case 'in_progress': summary.inProgress++; break;
      default: summary.notStarted++; break;
    }
  }

  return result;
}

/**
 * Batch-write TP mastery for multiple assertions.
 * Used by pipeline after continuous-mode assessment.
 */
export async function updateTpMasteryBatch(
  callerId: string,
  specSlug: string,
  updates: Record<string, TpProgress>,
): Promise<void> {
  const keyPattern = await ContractRegistry.getKeyPattern('CURRICULUM_PROGRESS_V1');
  if (!keyPattern) throw new Error('CURRICULUM_PROGRESS_V1 contract not loaded');

  const prefix = keyPattern
    .replace('{specSlug}', specSlug)
    .replace(':{key}', ':');

  const writes: Promise<unknown>[] = [];

  for (const [assertionId, progress] of Object.entries(updates)) {
    const statusKey = `${prefix}tp_status:${assertionId}`;
    const masteryKey = `${prefix}tp_mastery:${assertionId}`;

    writes.push(
      prisma.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId, key: statusKey, scope: 'CURRICULUM' } },
        create: { callerId, key: statusKey, scope: 'CURRICULUM', valueType: 'STRING', stringValue: progress.status },
        update: { stringValue: progress.status },
      }),
      prisma.callerAttribute.upsert({
        where: { callerId_key_scope: { callerId, key: masteryKey, scope: 'CURRICULUM' } },
        create: { callerId, key: masteryKey, scope: 'CURRICULUM', valueType: 'NUMBER', numberValue: progress.mastery },
        update: { numberValue: progress.mastery },
      }),
    );
  }

  await Promise.all(writes);
}

/**
 * Initialize TP tracking for all assertions in a continuous-mode curriculum.
 * Creates tp_status = "not_started" for each assertion that doesn't already have a status.
 * Called once when a learner first enters a continuous-mode course.
 */
export async function initializeTpTracking(
  callerId: string,
  specSlug: string,
  assertionIds: string[],
): Promise<void> {
  if (assertionIds.length === 0) return;

  const existing = await getTpProgressBatch(callerId, specSlug, assertionIds);
  const toInit: Record<string, TpProgress> = {};

  for (const id of assertionIds) {
    if (!existing[id] || existing[id].status === "not_started") {
      toInit[id] = { mastery: 0, status: "not_started" };
    }
  }

  if (Object.keys(toInit).length > 0) {
    await updateTpMasteryBatch(callerId, specSlug, toInit);
  }
}

export async function storeTrustWeightedProgress(
  callerId: string,
  specSlug: string,
  progress: TrustWeightedProgress,
): Promise<void> {
  const prefix = `trust_progress:${specSlug}`;

  await Promise.all([
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: `${prefix}:certified_mastery`, scope: 'TRUST_PROGRESS' } },
      create: { callerId, key: `${prefix}:certified_mastery`, scope: 'TRUST_PROGRESS', valueType: 'NUMBER', numberValue: progress.certifiedMastery },
      update: { numberValue: progress.certifiedMastery },
    }),
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: `${prefix}:supplementary_mastery`, scope: 'TRUST_PROGRESS' } },
      create: { callerId, key: `${prefix}:supplementary_mastery`, scope: 'TRUST_PROGRESS', valueType: 'NUMBER', numberValue: progress.supplementaryMastery },
      update: { numberValue: progress.supplementaryMastery },
    }),
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: `${prefix}:certification_readiness`, scope: 'TRUST_PROGRESS' } },
      create: { callerId, key: `${prefix}:certification_readiness`, scope: 'TRUST_PROGRESS', valueType: 'NUMBER', numberValue: progress.certificationReadiness },
      update: { numberValue: progress.certificationReadiness },
    }),
  ]);
}

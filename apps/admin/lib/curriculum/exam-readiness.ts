/**
 * exam-readiness.ts
 *
 * Exam readiness computation, gate checking, and result recording.
 * All storage keys read from EXAM_READINESS_V1 contract — NO HARDCODING.
 * Module mastery read from CURRICULUM_PROGRESS_V1 via getCurriculumProgress().
 *
 * Key pattern from contract: exam_readiness:{specSlug}:{key}
 * Examples:
 *   - exam_readiness:curr-fs-l2-001:readiness_score
 *   - exam_readiness:curr-fs-l2-001:formative_score
 *   - exam_readiness:curr-fs-l2-001:attempt_count
 */

import { prisma } from "@/lib/prisma";
import { ContractRegistry } from "@/lib/contracts/registry";
import { config } from "@/lib/config";
import { getCurriculumProgress, getActiveCurricula } from "./track-progress";

// ============================================================================
// Types
// ============================================================================

export interface ExamReadinessResult {
  specSlug: string;
  readinessScore: number;
  level: "not_ready" | "borderline" | "ready" | "strong";
  weakModules: string[];
  formativeScore: number | null;
  moduleMastery: Record<string, number>;
  gateStatus: { allowed: boolean; reason: string };
  attemptCount: number;
  lastAttemptPassed: boolean | null;
  bestScore: number | null;
}

const CONTRACT_ID = config.specs.examReadinessV1;
const SCOPE = "EXAM_READINESS";

// ============================================================================
// Key Building (contract-driven)
// ============================================================================

/**
 * Build storage key from EXAM_READINESS_V1 contract.
 * NO HARDCODED KEY PATTERNS.
 */
async function buildExamKey(specSlug: string, keyName: string): Promise<string> {
  const keyPattern = await ContractRegistry.getKeyPattern(CONTRACT_ID);
  const storageKeys = await ContractRegistry.getStorageKeys(CONTRACT_ID);

  if (!keyPattern || !storageKeys) {
    throw new Error(`${CONTRACT_ID} contract not loaded or invalid`);
  }

  const keyTemplate = storageKeys[keyName as keyof typeof storageKeys];
  if (!keyTemplate) {
    throw new Error(`Unknown storage key: ${keyName}. Check ${CONTRACT_ID} contract.`);
  }

  return keyPattern
    .replace("{specSlug}", specSlug)
    .replace("{key}", keyTemplate);
}

/**
 * Get all thresholds from contract.
 */
async function getThresholds(): Promise<{
  notReadyMax: number;
  borderlineMax: number;
  readyMax: number;
  passMarkDefault: number;
  formativePassThreshold: number;
  masteryWeight: number;
  formativeWeight: number;
}> {
  const thresholds = await ContractRegistry.getThresholds(CONTRACT_ID);
  if (!thresholds) {
    throw new Error(`${CONTRACT_ID} contract thresholds not loaded`);
  }
  return {
    notReadyMax: thresholds.notReadyMax ?? 0.50,
    borderlineMax: thresholds.borderlineMax ?? 0.66,
    readyMax: thresholds.readyMax ?? 0.80,
    passMarkDefault: thresholds.passMarkDefault ?? 0.66,
    formativePassThreshold: thresholds.formativePassThreshold ?? 0.66,
    masteryWeight: thresholds.masteryWeight ?? 0.6,
    formativeWeight: thresholds.formativeWeight ?? 0.4,
  };
}

// ============================================================================
// Readiness Computation
// ============================================================================

/**
 * Compute exam readiness for a caller on a specific curriculum.
 *
 * Formula: readiness = (avgModuleMastery * masteryWeight) + (formativeScore * formativeWeight)
 * All weights and thresholds from EXAM_READINESS_V1 contract.
 * Module mastery from CURRICULUM_PROGRESS_V1 via getCurriculumProgress().
 */
export async function computeExamReadiness(
  callerId: string,
  specSlug: string,
): Promise<ExamReadinessResult> {
  const [thresholds, curriculumProgress, stored] = await Promise.all([
    getThresholds(),
    getCurriculumProgress(callerId, specSlug),
    getStoredExamReadiness(callerId, specSlug),
  ]);

  const moduleMastery = curriculumProgress.modulesMastery;
  const masteryValues = Object.values(moduleMastery);
  const avgMastery = masteryValues.length > 0
    ? masteryValues.reduce((sum, v) => sum + v, 0) / masteryValues.length
    : 0;

  const formativeScore = stored.formativeScore;

  // Compute readiness using contract weights
  const readinessScore = formativeScore !== null
    ? (avgMastery * thresholds.masteryWeight) + (formativeScore * thresholds.formativeWeight)
    : avgMastery; // If no formative yet, use mastery alone

  // Identify weak modules (below formative threshold)
  const weakModules: string[] = [];
  for (const [moduleId, mastery] of Object.entries(moduleMastery)) {
    if (mastery < thresholds.formativePassThreshold) {
      weakModules.push(moduleId);
    }
  }

  // Determine level from contract thresholds
  let level: ExamReadinessResult["level"];
  if (readinessScore < thresholds.notReadyMax) {
    level = "not_ready";
  } else if (readinessScore < thresholds.borderlineMax) {
    level = "borderline";
  } else if (readinessScore < thresholds.readyMax) {
    level = "ready";
  } else {
    level = "strong";
  }

  // Gate check
  const allowed = readinessScore >= thresholds.notReadyMax;
  const reason = allowed
    ? level === "borderline"
      ? "Borderline readiness — exam allowed but targeted revision recommended"
      : "Readiness threshold met"
    : `Readiness ${(readinessScore * 100).toFixed(0)}% is below minimum ${(thresholds.notReadyMax * 100).toFixed(0)}%`;

  return {
    specSlug,
    readinessScore,
    level,
    weakModules,
    formativeScore,
    moduleMastery,
    gateStatus: { allowed, reason },
    attemptCount: stored.attemptCount,
    lastAttemptPassed: stored.lastAttemptPassed,
    bestScore: stored.bestScore,
  };
}

// ============================================================================
// Storage (CallerAttribute, scope: EXAM_READINESS)
// ============================================================================

/**
 * Read stored exam readiness data from CallerAttribute.
 */
async function getStoredExamReadiness(
  callerId: string,
  specSlug: string,
): Promise<{
  formativeScore: number | null;
  attemptCount: number;
  lastAttemptPassed: boolean | null;
  bestScore: number | null;
}> {
  const keyPattern = await ContractRegistry.getKeyPattern(CONTRACT_ID);
  if (!keyPattern) {
    return { formativeScore: null, attemptCount: 0, lastAttemptPassed: null, bestScore: null };
  }

  const prefix = keyPattern
    .replace("{specSlug}", specSlug)
    .replace(":{key}", ":");

  const attributes = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      scope: SCOPE,
      key: { startsWith: prefix },
    },
  });

  const storageKeys = await ContractRegistry.getStorageKeys(CONTRACT_ID);
  if (!storageKeys) {
    return { formativeScore: null, attemptCount: 0, lastAttemptPassed: null, bestScore: null };
  }

  let formativeScore: number | null = null;
  let attemptCount = 0;
  let lastAttemptPassed: boolean | null = null;
  let bestScore: number | null = null;

  for (const attr of attributes) {
    const key = attr.key.replace(prefix, "");

    if (key === storageKeys.formativeScore) {
      formativeScore = attr.numberValue;
    } else if (key === storageKeys.attemptCount) {
      attemptCount = attr.numberValue ?? 0;
    } else if (key === storageKeys.lastAttemptPassed) {
      lastAttemptPassed = attr.stringValue === "true";
    } else if (key === storageKeys.bestScore) {
      bestScore = attr.numberValue;
    }
  }

  return { formativeScore, attemptCount, lastAttemptPassed, bestScore };
}

/**
 * Store exam readiness result in CallerAttribute.
 */
async function storeExamReadiness(
  callerId: string,
  specSlug: string,
  result: ExamReadinessResult,
): Promise<void> {
  const writes: Promise<any>[] = [];

  // Readiness score
  const readinessKey = await buildExamKey(specSlug, "readinessScore");
  writes.push(
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: readinessKey, scope: SCOPE } },
      create: { callerId, key: readinessKey, scope: SCOPE, valueType: "NUMBER", numberValue: result.readinessScore, sourceSpecSlug: specSlug },
      update: { numberValue: result.readinessScore },
    }),
  );

  // Weak modules
  const weakKey = await buildExamKey(specSlug, "weakModules");
  writes.push(
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: weakKey, scope: SCOPE } },
      create: { callerId, key: weakKey, scope: SCOPE, valueType: "STRING", stringValue: JSON.stringify(result.weakModules), sourceSpecSlug: specSlug },
      update: { stringValue: JSON.stringify(result.weakModules) },
    }),
  );

  // Last assessed timestamp
  const assessedKey = await buildExamKey(specSlug, "lastAssessedAt");
  writes.push(
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: assessedKey, scope: SCOPE } },
      create: { callerId, key: assessedKey, scope: SCOPE, valueType: "STRING", stringValue: new Date().toISOString(), sourceSpecSlug: specSlug },
      update: { stringValue: new Date().toISOString() },
    }),
  );

  await Promise.all(writes);
}

// ============================================================================
// Public API: Formative Assessment
// ============================================================================

/**
 * Update formative assessment score and recompute readiness.
 * moduleScores: Record<moduleId, score (0-1)>
 */
export async function updateFormativeScore(
  callerId: string,
  specSlug: string,
  moduleScores: Record<string, number>,
): Promise<ExamReadinessResult> {
  // Compute average formative score
  const scores = Object.values(moduleScores);
  const avgFormative = scores.length > 0
    ? scores.reduce((sum, v) => sum + v, 0) / scores.length
    : 0;

  // Store formative score
  const formativeKey = await buildExamKey(specSlug, "formativeScore");
  await prisma.callerAttribute.upsert({
    where: { callerId_key_scope: { callerId, key: formativeKey, scope: SCOPE } },
    create: { callerId, key: formativeKey, scope: SCOPE, valueType: "NUMBER", numberValue: avgFormative, sourceSpecSlug: specSlug },
    update: { numberValue: avgFormative },
  });

  // Recompute and store readiness
  const result = await computeExamReadiness(callerId, specSlug);
  await storeExamReadiness(callerId, specSlug, result);
  return result;
}

// ============================================================================
// Public API: Exam Gate Check
// ============================================================================

/**
 * Check if a caller is allowed to attempt the exam.
 */
export async function checkExamGate(
  callerId: string,
  specSlug: string,
): Promise<{ allowed: boolean; reason: string; readiness: number }> {
  const result = await computeExamReadiness(callerId, specSlug);
  return {
    allowed: result.gateStatus.allowed,
    reason: result.gateStatus.reason,
    readiness: result.readinessScore,
  };
}

// ============================================================================
// Public API: Record Exam Result
// ============================================================================

/**
 * Record an exam result. Updates CallerAttribute and Goal.
 * If passed, finds the linked LEARN Goal and marks it COMPLETED.
 */
export async function recordExamResult(
  callerId: string,
  specSlug: string,
  score: number,
  totalQuestions: number,
  correctAnswers: number,
): Promise<ExamReadinessResult> {
  const thresholds = await getThresholds();
  const passed = score >= thresholds.passMarkDefault;

  // Read current attempt count + best score
  const stored = await getStoredExamReadiness(callerId, specSlug);
  const newAttemptCount = stored.attemptCount + 1;
  const newBestScore = stored.bestScore !== null ? Math.max(stored.bestScore, score) : score;

  // Store attempt data
  const [attemptKey, passedKey, bestKey] = await Promise.all([
    buildExamKey(specSlug, "attemptCount"),
    buildExamKey(specSlug, "lastAttemptPassed"),
    buildExamKey(specSlug, "bestScore"),
  ]);

  await Promise.all([
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: attemptKey, scope: SCOPE } },
      create: { callerId, key: attemptKey, scope: SCOPE, valueType: "NUMBER", numberValue: newAttemptCount, sourceSpecSlug: specSlug },
      update: { numberValue: newAttemptCount },
    }),
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: passedKey, scope: SCOPE } },
      create: { callerId, key: passedKey, scope: SCOPE, valueType: "STRING", stringValue: String(passed), sourceSpecSlug: specSlug },
      update: { stringValue: String(passed) },
    }),
    prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: bestKey, scope: SCOPE } },
      create: { callerId, key: bestKey, scope: SCOPE, valueType: "NUMBER", numberValue: newBestScore, sourceSpecSlug: specSlug },
      update: { numberValue: newBestScore },
    }),
  ]);

  // If passed, update linked Goal to COMPLETED (or create one if missing)
  if (passed) {
    // Find the CONTENT spec for this curriculum slug
    const contentSpec = await prisma.analysisSpec.findFirst({
      where: { slug: specSlug, specRole: "CONTENT", isActive: true },
      select: { id: true, name: true },
    });

    if (contentSpec) {
      const examMetrics = {
        examScore: score,
        examPassed: true,
        examAttempts: newAttemptCount,
        totalQuestions,
        correctAnswers,
        completedAt: new Date().toISOString(),
      };

      // Find active LEARN Goal linked to this spec
      const goal = await prisma.goal.findFirst({
        where: {
          callerId,
          contentSpecId: contentSpec.id,
          type: "LEARN",
          status: "ACTIVE",
        },
      });

      if (goal) {
        await prisma.goal.update({
          where: { id: goal.id },
          data: {
            status: "COMPLETED",
            progress: 1.0,
            completedAt: new Date(),
            progressMetrics: {
              ...(goal.progressMetrics as Record<string, any> || {}),
              ...examMetrics,
            },
          },
        });
      } else {
        // No LEARN Goal exists — create one as COMPLETED (name from DB, not hardcoded)
        await prisma.goal.create({
          data: {
            callerId,
            type: "LEARN",
            name: contentSpec.name,
            contentSpecId: contentSpec.id,
            status: "COMPLETED",
            progress: 1.0,
            startedAt: new Date(),
            completedAt: new Date(),
            progressMetrics: examMetrics,
          },
        });
      }
    }
  }

  // Recompute and return readiness
  const result = await computeExamReadiness(callerId, specSlug);
  await storeExamReadiness(callerId, specSlug, result);
  return result;
}

// ============================================================================
// Public API: Get Readiness for All Active Curricula
// ============================================================================

/**
 * Compute exam readiness for all curricula a caller has progress in.
 */
export async function getAllExamReadiness(
  callerId: string,
): Promise<ExamReadinessResult[]> {
  let specSlugs: string[];
  try {
    specSlugs = await getActiveCurricula(callerId);
  } catch {
    // Contract not loaded — return empty
    return [];
  }

  if (specSlugs.length === 0) return [];

  return Promise.all(
    specSlugs.map((slug) => computeExamReadiness(callerId, slug)),
  );
}

/**
 * working-set-selector.ts
 *
 * Core algorithm for continuous learning mode.
 * Selects a "working set" of LOs (and their child TPs) for each call,
 * based on mastery state, module sequence, and call duration budget.
 *
 * LO-first selection: picks LOs as atomic units, never splits an LO's TPs.
 * Pure function — no DB access; takes pre-fetched data.
 */

import type { TpProgress } from "./track-progress";

// ── Types ──────────────────────────────────────────────

export interface WorkingSetInput {
  /** All assertions in the curriculum, with LO and module linkage */
  assertions: AssertionRef[];
  /** All LOs in the curriculum, grouped by module */
  learningObjectives: LORef[];
  /** Ordered modules with optional prerequisites */
  modules: ModuleRef[];
  /** Per-TP mastery from CallerAttributes */
  tpMasteryMap: Record<string, TpProgress>;
  /** Per-LO mastery from CallerAttributes (lo_mastery keys) */
  loMasteryMap: Record<string, number>;
  /** Call duration in minutes (from playbook config) */
  callDurationMins: number;
  /** Mastery threshold for "mastered" status (default 0.7) */
  masteryThreshold: number;
}

export interface AssertionRef {
  id: string;
  learningObjectiveId: string | null;
  learningOutcomeRef: string | null;
  depth: number | null;
  orderIndex: number;
}

export interface LORef {
  id: string;
  ref: string;
  moduleId: string;
  sortOrder: number;
  description: string;
  /**
   * Per-LO mastery threshold override (#155). Null → inherit the input-level
   * masteryThreshold (which in turn resolves from module/preset/default).
   */
  masteryThreshold?: number | null;
}

export interface ModuleRef {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  prerequisites: string[];  // module IDs that must be completed first
}

export interface WorkingSetResult {
  /** All assertion IDs in the working set (review + new) */
  assertionIds: string[];
  /** Assertion IDs that are review (in_progress, below threshold) */
  reviewIds: string[];
  /** Assertion IDs that are new (not_started) */
  newIds: string[];
  /** Selected LOs with status info */
  selectedLOs: SelectedLO[];
  /** The primary module being taught (first frontier module) */
  frontierModuleId: string | null;
  /** Progress summary */
  totalMastered: number;
  totalLOs: number;
  totalTps: number;
}

export interface SelectedLO {
  id: string;
  ref: string;
  moduleId: string;
  status: "review" | "new";
  childTpIds: string[];
  /**
   * LO description text, propagated from `LORef.description`. Surfaced as
   * session context in the runtime prompt's `curriculum_guidance` section
   * (#306). May be empty for legacy LOs that pre-date description capture.
   */
  description: string;
}

// ── Budget calculation ──────────────────────────────────

interface LOWithMeta extends LORef {
  childTps: AssertionRef[];
  mastery: number;
  status: "mastered" | "in_progress" | "not_started";
  weight: number;  // cost against budget
}

/**
 * Compute LO budget based on call duration.
 * Returns the effective number of LO "slots" available.
 */
function computeLoBudget(callDurationMins: number): number {
  if (callDurationMins <= 15) return 2;
  if (callDurationMins <= 25) return 3;
  if (callDurationMins <= 40) return 4;
  return 5;
}

/**
 * Compute the hard cap on total TPs per call.
 * Prevents prompt overload regardless of LO count.
 */
function computeMaxTps(callDurationMins: number): number {
  return Math.ceil(callDurationMins * 0.8);
}

/**
 * Compute the "weight" (budget cost) of an LO.
 * Complex LOs with many TPs cost more; simple ones cost less.
 * Review LOs cost half (learner has prior exposure).
 */
function computeLoWeight(tpCount: number, isReview: boolean): number {
  let base: number;
  if (tpCount <= 2) base = 0.75;
  else if (tpCount <= 4) base = 1.0;
  else base = 1.5;

  return isReview ? base * 0.5 : base;
}

// ── Main selector ──────────────────────────────────────

/**
 * Select a working set of LOs and TPs for one call.
 *
 * Algorithm:
 * 1. Build LO graph (group TPs by LO, compute status)
 * 2. Select at most 1 review LO (weakest in_progress)
 * 3. Select new LOs from frontier modules (prerequisites met, sorted by module order)
 * 4. Assemble: all TPs from selected LOs, respecting MAX_TPS_PER_CALL
 *
 * Deterministic given same inputs.
 */
export function selectWorkingSet(input: WorkingSetInput): WorkingSetResult {
  const {
    assertions, learningObjectives, modules,
    tpMasteryMap, loMasteryMap,
    callDurationMins, masteryThreshold,
  } = input;

  const loBudget = computeLoBudget(callDurationMins);
  const maxTps = computeMaxTps(callDurationMins);

  // ── STEP 1: Build LO graph ──

  // Group assertions by learningObjectiveId
  const tpsByLoId = new Map<string, AssertionRef[]>();
  const orphanTps: AssertionRef[] = [];

  for (const a of assertions) {
    if (a.learningObjectiveId) {
      const list = tpsByLoId.get(a.learningObjectiveId) || [];
      list.push(a);
      tpsByLoId.set(a.learningObjectiveId, list);
    } else {
      orphanTps.push(a);
    }
  }

  // Build enriched LO objects with mastery and status
  const loGraph: LOWithMeta[] = [];

  for (const lo of learningObjectives) {
    const childTps = (tpsByLoId.get(lo.id) || [])
      .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || a.orderIndex - b.orderIndex);

    if (childTps.length === 0) continue;  // Skip LOs with no TPs

    // Per-LO threshold override (#155). Null falls back to the input-level
    // threshold so behaviour is unchanged for LOs without overrides.
    const loThreshold = lo.masteryThreshold ?? masteryThreshold;

    // Compute LO status from child TPs
    const allMastered = childTps.every(
      (tp) => (tpMasteryMap[tp.id]?.mastery ?? 0) >= loThreshold
    );
    const anyAttempted = childTps.some(
      (tp) => tpMasteryMap[tp.id]?.status === "in_progress" || tpMasteryMap[tp.id]?.status === "mastered"
    );

    const status: LOWithMeta["status"] = allMastered ? "mastered"
      : anyAttempted ? "in_progress"
      : "not_started";

    const mastery = loMasteryMap[`${lo.moduleId}:${lo.ref}`]
      ?? loMasteryMap[lo.ref]
      ?? (childTps.reduce((sum, tp) => sum + (tpMasteryMap[tp.id]?.mastery ?? 0), 0) / childTps.length);

    const isReview = status === "in_progress";
    const weight = computeLoWeight(childTps.length, isReview);

    loGraph.push({ ...lo, childTps, mastery, status, weight });
  }

  // Build module completion map
  const moduleCompletionMap = new Map<string, boolean>();
  for (const mod of modules) {
    const moduleLOs = loGraph.filter((lo) => lo.moduleId === mod.id);
    const allMastered = moduleLOs.length > 0 && moduleLOs.every((lo) => lo.status === "mastered");
    moduleCompletionMap.set(mod.id, allMastered);
  }

  // ── STEP 2: Select review LO (at most 1) ──

  let reviewLO: LOWithMeta | null = null;
  const reviewCandidates = loGraph
    .filter((lo) => lo.status === "in_progress" && lo.mastery < (lo.masteryThreshold ?? masteryThreshold))
    .sort((a, b) => a.mastery - b.mastery);  // weakest first

  if (reviewCandidates.length > 0) {
    reviewLO = reviewCandidates[0];
  }

  // ── STEP 3: Select new LOs from frontier modules ──

  const usedBudget = reviewLO ? reviewLO.weight : 0;
  let remainingBudget = loBudget - usedBudget;
  let tpCount = reviewLO ? reviewLO.childTps.length : 0;

  // Find frontier modules: not completed, all prerequisites met
  const frontierModules = modules
    .filter((mod) => {
      if (moduleCompletionMap.get(mod.id)) return false;  // already complete
      // Check prerequisites
      return mod.prerequisites.every((prereqId) => moduleCompletionMap.get(prereqId) === true);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const newLOs: LOWithMeta[] = [];
  let frontierModuleId: string | null = null;

  for (const mod of frontierModules) {
    if (remainingBudget <= 0 || tpCount >= maxTps) break;

    if (!frontierModuleId) frontierModuleId = mod.id;

    const moduleLOs = loGraph
      .filter((lo) => lo.moduleId === mod.id && lo.status === "not_started")
      .sort((a, b) => a.sortOrder - b.sortOrder);

    for (const lo of moduleLOs) {
      if (remainingBudget <= 0 || tpCount + lo.childTps.length > maxTps) break;

      newLOs.push(lo);
      remainingBudget -= lo.weight;
      tpCount += lo.childTps.length;
    }
  }

  // Fallback: if no new LOs found (all in_progress or mastered), pick weakest in_progress
  if (newLOs.length === 0 && reviewLO === null) {
    const fallbackCandidates = loGraph
      .filter((lo) => lo.status !== "mastered")
      .sort((a, b) => a.mastery - b.mastery);

    if (fallbackCandidates.length > 0) {
      const fallback = fallbackCandidates[0];
      reviewLO = fallback;
    }
  }

  // ── STEP 4: Assemble working set ──

  const reviewTpIds = reviewLO
    ? reviewLO.childTps.map((tp) => tp.id)
    : [];

  const newTpIds = newLOs.flatMap((lo) => lo.childTps.map((tp) => tp.id));

  // Include orphan TPs (null learningObjectiveId) up to maxTps budget.
  // These are assertions the semantic reconciler couldn't match to any LO.
  // Without this, orphans are silently excluded from continuous mode.
  const orphanTpIds: string[] = [];
  if (orphanTps.length > 0) {
    const currentCount = reviewTpIds.length + newTpIds.length;
    const orphanBudget = maxTps - currentCount;
    if (orphanBudget > 0) {
      const included = orphanTps.slice(0, orphanBudget);
      orphanTpIds.push(...included.map((tp) => tp.id));
    }
    if (orphanTps.length > orphanTpIds.length) {
      console.warn(
        `[working-set-selector] ${orphanTps.length - orphanTpIds.length} orphan TPs excluded (null learningObjectiveId, budget exhausted). ` +
        `Run curriculum regeneration to improve LO linkage.`,
      );
    }
  }

  const selectedLOs: SelectedLO[] = [];
  if (reviewLO) {
    selectedLOs.push({
      id: reviewLO.id,
      ref: reviewLO.ref,
      moduleId: reviewLO.moduleId,
      status: "review",
      childTpIds: reviewTpIds,
      description: reviewLO.description ?? "",
    });
  }
  for (const lo of newLOs) {
    selectedLOs.push({
      id: lo.id,
      ref: lo.ref,
      moduleId: lo.moduleId,
      status: "new",
      childTpIds: lo.childTps.map((tp) => tp.id),
      description: lo.description ?? "",
    });
  }

  // Progress summary
  const totalMastered = loGraph.filter((lo) => lo.status === "mastered").length;

  return {
    assertionIds: [...reviewTpIds, ...newTpIds, ...orphanTpIds],
    reviewIds: reviewTpIds,
    newIds: [...newTpIds, ...orphanTpIds],
    selectedLOs,
    frontierModuleId,
    totalMastered,
    totalLOs: loGraph.length,
    totalTps: assertions.length,
  };
}

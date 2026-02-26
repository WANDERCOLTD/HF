/**
 * Teaching Point Distribution
 *
 * Given a module's learning outcomes + TP counts per teachMethod + model config,
 * distributes TPs across multiple sessions respecting cognitive load limits.
 *
 * This is used by the AI generation prompt to provide context about how many
 * sessions a module needs, NOT for runtime filtering (that uses learningOutcomeRefs).
 */

import type { LessonPlanModelConfig } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModuleTPStats {
  moduleId: string;
  moduleName: string;
  totalTPs: number;
  /** TP count per teachMethod */
  byTeachMethod: Record<string, number>;
  /** TP count per learning outcome ref */
  byLearningOutcome: Record<string, number>;
  /** All learning outcome refs in this module */
  learningOutcomeRefs: string[];
}

export interface SessionTPAllocation {
  /** Session index within this module (0-based) */
  sessionIndex: number;
  /** Suggested session type */
  suggestedType: "introduce" | "deepen";
  /** Number of new TPs in this session */
  tpCount: number;
  /** Which LO refs this session covers */
  learningOutcomeRefs: string[];
  /** TeachMethod distribution for this session */
  teachMethodDistribution: Record<string, number>;
}

export interface ModuleDistribution {
  moduleId: string;
  moduleName: string;
  totalTPs: number;
  sessionsNeeded: number;
  sessions: SessionTPAllocation[];
}

// ---------------------------------------------------------------------------
// Main distribution function
// ---------------------------------------------------------------------------

/**
 * Distribute a module's TPs across multiple sessions, respecting cognitive load cap.
 *
 * Strategy:
 * 1. Group TPs by learning outcome
 * 2. Pack LOs into sessions until maxTpsPerSession is reached
 * 3. First session is "introduce", subsequent are "deepen"
 */
export function distributeModuleTPs(
  stats: ModuleTPStats,
  config: LessonPlanModelConfig = {},
): ModuleDistribution {
  const maxTPs = config.maxTpsPerSession ?? 10;

  // If module fits in one session, simple case
  if (stats.totalTPs <= maxTPs) {
    return {
      moduleId: stats.moduleId,
      moduleName: stats.moduleName,
      totalTPs: stats.totalTPs,
      sessionsNeeded: 1,
      sessions: [{
        sessionIndex: 0,
        suggestedType: "introduce",
        tpCount: stats.totalTPs,
        learningOutcomeRefs: stats.learningOutcomeRefs,
        teachMethodDistribution: { ...stats.byTeachMethod },
      }],
    };
  }

  // Multi-session: pack LOs into sessions by TP count
  const loEntries = stats.learningOutcomeRefs.map((ref) => ({
    ref,
    count: stats.byLearningOutcome[ref] || 0,
  }));

  // Sort by count descending for better packing
  loEntries.sort((a, b) => b.count - a.count);

  const sessions: SessionTPAllocation[] = [];
  let currentSession: SessionTPAllocation = {
    sessionIndex: 0,
    suggestedType: "introduce",
    tpCount: 0,
    learningOutcomeRefs: [],
    teachMethodDistribution: {},
  };

  for (const lo of loEntries) {
    // If adding this LO would exceed cap, start a new session
    // (unless current session is empty — an LO with >maxTPs still goes in one session)
    if (currentSession.tpCount + lo.count > maxTPs && currentSession.tpCount > 0) {
      sessions.push(currentSession);
      currentSession = {
        sessionIndex: sessions.length,
        suggestedType: "deepen",
        tpCount: 0,
        learningOutcomeRefs: [],
        teachMethodDistribution: {},
      };
    }

    currentSession.tpCount += lo.count;
    currentSession.learningOutcomeRefs.push(lo.ref);
  }

  // Handle TPs without LO refs (assign to first session that has room, or last)
  const untaggedCount = stats.totalTPs -
    Object.values(stats.byLearningOutcome).reduce((a, b) => a + b, 0);
  if (untaggedCount > 0) {
    currentSession.tpCount += untaggedCount;
  }

  // Push final session
  if (currentSession.tpCount > 0 || currentSession.learningOutcomeRefs.length > 0) {
    sessions.push(currentSession);
  }

  // If we still only have 0 sessions (edge case), add one
  if (sessions.length === 0) {
    sessions.push({
      sessionIndex: 0,
      suggestedType: "introduce",
      tpCount: stats.totalTPs,
      learningOutcomeRefs: stats.learningOutcomeRefs,
      teachMethodDistribution: { ...stats.byTeachMethod },
    });
  }

  return {
    moduleId: stats.moduleId,
    moduleName: stats.moduleName,
    totalTPs: stats.totalTPs,
    sessionsNeeded: sessions.length,
    sessions,
  };
}

// ---------------------------------------------------------------------------
// Stats computation helper (for use in generate-plan route)
// ---------------------------------------------------------------------------

/**
 * Compute TP stats per module from raw assertion data.
 * Used to provide context to the AI lesson plan generator.
 */
export function computeModuleTPStats(
  modules: Array<{ id: string; name: string; learningOutcomes?: string[] }>,
  assertions: Array<{ learningOutcomeRef: string | null; teachMethod: string | null; category: string }>,
): ModuleTPStats[] {
  return modules.map((mod) => {
    const loRefs = (mod.learningOutcomes || []).map((lo) => {
      const match = lo.match(/^(LO\d+|AC[\d.]+)/i);
      return match ? match[1] : lo;
    });

    // Filter assertions to this module's LOs
    const moduleAssertions = loRefs.length > 0
      ? assertions.filter((a) =>
          a.learningOutcomeRef && loRefs.some((ref) => a.learningOutcomeRef!.includes(ref))
        )
      : [];

    const byTeachMethod: Record<string, number> = {};
    const byLearningOutcome: Record<string, number> = {};

    for (const a of moduleAssertions) {
      const method = a.teachMethod || a.category || "unknown";
      byTeachMethod[method] = (byTeachMethod[method] || 0) + 1;

      if (a.learningOutcomeRef) {
        const loMatch = a.learningOutcomeRef.match(/^(LO\d+|AC[\d.]+)/i);
        const loKey = loMatch ? loMatch[1] : a.learningOutcomeRef;
        byLearningOutcome[loKey] = (byLearningOutcome[loKey] || 0) + 1;
      }
    }

    return {
      moduleId: mod.id,
      moduleName: mod.name,
      totalTPs: moduleAssertions.length,
      byTeachMethod,
      byLearningOutcome,
      learningOutcomeRefs: loRefs,
    };
  });
}

/**
 * Format module TP stats as a readable string for the AI prompt.
 */
export function formatTPStatsForPrompt(
  distributions: ModuleDistribution[],
): string {
  if (distributions.length === 0) return "";

  const lines = ["Teaching point distribution per module:"];
  for (const dist of distributions) {
    const methodSummary = dist.sessions[0]?.teachMethodDistribution
      ? Object.entries(dist.sessions[0].teachMethodDistribution)
          .map(([m, c]) => `${c} [${m}]`)
          .join(", ")
      : "";
    lines.push(
      `- "${dist.moduleName}": ${dist.totalTPs} TPs → ${dist.sessionsNeeded} session(s)${methodSummary ? ` (${methodSummary})` : ""}`
    );
  }
  return lines.join("\n");
}

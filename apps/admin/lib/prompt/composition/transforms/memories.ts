/**
 * Memory Transforms — Spec-Driven Sub-Flow
 *
 * 3 chainable transforms declared in COMP-001 memory section:
 *   1. deduplicateMemories — deduplicate by normalized key
 *   2. scoreMemoryRelevance — blend confidence with contextual relevance
 *   3. groupMemoriesByCategory — group into byCategory + all + _deduplicated
 *
 * Also registers the legacy monolithic "deduplicateAndGroupMemories" for
 * backward compatibility (specs that haven't switched to the array form).
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, CompositionSectionDef, MemoryData } from "../types";

/**
 * Compute contextual relevance of a memory to the current session.
 *
 * Uses keyword overlap between memory content and session context,
 * plus an optional per-category boost from spec config.
 *
 * @param memory - The memory to score
 * @param sessionContext - Current session context (modules, goals, topics)
 * @param categoryWeights - Per-category boost weights from COMP-001 spec (default: no boost)
 * @returns 0-1 relevance score
 */
export function computeMemoryRelevance(
  memory: MemoryData,
  sessionContext: {
    currentModule?: string | null;
    nextModule?: string | null;
    recentTopics?: string[];
    upcomingTopics?: string[];
    learnerGoals?: string[];
  },
  categoryWeights?: Record<string, number>,
): number {
  const weights = categoryWeights || {};

  // Build a set of context keywords (lowered, split by spaces)
  const contextTokens = new Set<string>();
  const addTokens = (text: string | null | undefined) => {
    if (!text) return;
    text.toLowerCase().split(/\s+/).forEach((t) => {
      if (t.length > 2) contextTokens.add(t);
    });
  };

  addTokens(sessionContext.currentModule);
  addTokens(sessionContext.nextModule);
  (sessionContext.recentTopics || []).forEach(addTokens);
  (sessionContext.upcomingTopics || []).forEach(addTokens);
  (sessionContext.learnerGoals || []).forEach(addTokens);

  // Recency boost — recently extracted memories get a small edge (max 0.2)
  const recencyBoost = (() => {
    if (!memory.extractedAt) return 0;
    const daysSince = (Date.now() - new Date(memory.extractedAt).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, 1 - (daysSince / 90)) * 0.2;
  })();

  if (contextTokens.size === 0) {
    // No session context → category boost + recency (or 0)
    return Math.min(1, Math.max(0, (weights[memory.category] || 0) + recencyBoost));
  }

  // Compute keyword overlap
  const memoryText = `${memory.key} ${memory.value}`.toLowerCase();
  const memoryTokens = memoryText.split(/\s+/).filter((t) => t.length > 2);

  let matches = 0;
  for (const token of memoryTokens) {
    if (contextTokens.has(token)) matches++;
  }

  const overlapScore = memoryTokens.length > 0
    ? Math.min(1, matches / Math.min(memoryTokens.length, 3))
    : 0;

  // Add category boost
  const categoryBoost = weights[memory.category] || 0;

  return Math.min(1, overlapScore + categoryBoost + recencyBoost);
}

/**
 * Default decay rates by memory category. Used when decayFactor is 1.0
 * (DB default = not explicitly set). Expressed as monthly decay multiplier:
 *   - 1.0 = no decay (stable facts)
 *   - 0.95 = ~5% confidence loss per 30 days
 *   - 0.85 = ~15% confidence loss per 30 days
 */
const CATEGORY_DECAY_DEFAULTS: Record<string, number> = {
  FACT: 1.0,          // "They live in London" — stable until contradicted
  PREFERENCE: 1.0,    // "They prefer visual learning" — stable
  RELATIONSHIP: 1.0,  // "They have 2 children" — stable
  TOPIC: 0.95,        // "They're interested in budgeting" — slowly fades
  EVENT: 0.90,        // "They mentioned an upcoming exam" — time-sensitive
  CONTEXT: 0.85,      // "They seemed stressed today" — fades quickly
};

/**
 * Apply decayFactor to confidence.
 *
 * When decayFactor is explicitly set (< 1.0), use it directly.
 * When decayFactor is 1.0 (DB default), apply category-based decay instead.
 *   effectiveConfidence = confidence * decay^(daysSinceExtraction / 30)
 *
 * #598 Slice 1 — `memoryDecayScale` (from `Playbook.config.tolerances`) is a
 * per-course multiplier applied ONLY to the category-default branch. Explicit
 * per-assertion `decayFactor < 1.0` values are NOT scaled (already authored
 * with intent — scaling would double-penalise). Scale of 1.0 (or absent) is a
 * no-op so existing courses produce byte-identical output.
 */
export function applyDecay(m: MemoryData, memoryDecayScale: number = 1.0): number {
  if (!m.extractedAt) return m.confidence;
  let decay: number;
  if (m.decayFactor < 1.0) {
    // Explicit per-assertion decay — honour it as-is, no course-level scaling.
    decay = m.decayFactor;
  } else {
    // Category default — clamp the scale to [0.1, 1.0] and multiply.
    // Fast-path scale === 1.0 (the default) without multiplying so existing
    // courses produce byte-identical output. Without this short-circuit,
    // `categoryDefault * 1.0` is not byte-identical to `categoryDefault`
    // for IEEE-754 floats (e.g. 0.95 * 1.0 = 0.9499999999812003 due to
    // mantissa-rounding compounding through Math.pow downstream).
    const rawScale = Number.isFinite(memoryDecayScale) ? memoryDecayScale : 1.0;
    const scale = Math.min(1.0, Math.max(0.1, rawScale));
    const categoryDefault = CATEGORY_DECAY_DEFAULTS[m.category] ?? 1.0;
    decay = scale === 1.0 ? categoryDefault : categoryDefault * scale;
  }
  if (decay >= 1.0) return m.confidence;
  const daysSince = (Date.now() - new Date(m.extractedAt).getTime()) / (1000 * 60 * 60 * 24);
  return m.confidence * Math.pow(decay, daysSince / 30);
}

// ---------------------------------------------------------------------------
// Step 1: Deduplicate by normalized key (highest effective confidence wins)
// Input:  MemoryData[]
// Output: MemoryData[] (with confidence adjusted by decayFactor)
// ---------------------------------------------------------------------------
registerTransform("deduplicateMemories", (
  rawData: MemoryData[],
  context: AssembledContext,
  _sectionDef: CompositionSectionDef,
) => {
  const memories = rawData || [];
  // #598 Slice 1 — read the course-level decay scale (no-op when absent or 1.0).
  const pbConfig = (context.loadedData?.playbooks?.[0]?.config || {}) as Record<string, unknown>;
  const tolerances = pbConfig.tolerances as { memoryDecayScale?: number } | undefined;
  const memoryDecayScale =
    typeof tolerances?.memoryDecayScale === "number" ? tolerances.memoryDecayScale : 1.0;
  // Apply decay to confidence before deduplication
  const decayed = memories.map((m) => ({ ...m, confidence: applyDecay(m, memoryDecayScale) }));
  const seen = new Map<string, MemoryData>();
  for (const m of decayed) {
    const normalizedKey = `${m.category}:${m.key.toLowerCase().replace(/\s+/g, "_")}`;
    const existing = seen.get(normalizedKey);
    if (!existing || m.confidence > existing.confidence) {
      seen.set(normalizedKey, m);
    }
  }
  return Array.from(seen.values());
});

// ---------------------------------------------------------------------------
// Step 2: Score relevance, blend with confidence, sort
// Input:  MemoryData[]
// Output: ScoredMemory[] (MemoryData + relevance + combinedScore), sorted desc
// ---------------------------------------------------------------------------
registerTransform("scoreMemoryRelevance", (
  rawData: MemoryData[],
  context: AssembledContext,
  sectionDef: CompositionSectionDef,
) => {
  const memories = rawData || [];
  const memConfig = sectionDef.config || {};
  const alpha: number = memConfig.relevanceAlpha ?? context.specConfig.relevanceAlpha ?? 0.6;
  const categoryWeights: Record<string, number> = memConfig.categoryRelevanceWeights ?? {};

  const sessionContext = {
    currentModule: context.sharedState?.moduleToReview?.name || null,
    nextModule: context.sharedState?.nextModule?.name || null,
    upcomingTopics: (context.sharedState?.modules || [])
      .slice(
        (context.sharedState?.lastCompletedIndex ?? -1) + 1,
        (context.sharedState?.lastCompletedIndex ?? -1) + 3,
      )
      .map((m: any) => m.name),
    learnerGoals: (context.loadedData?.goals || []).map((g: any) => g.name),
  };

  const scored = memories.map((m) => {
    const relevance = computeMemoryRelevance(m, sessionContext, categoryWeights);
    const combinedScore = alpha * m.confidence + (1 - alpha) * relevance;
    return { ...m, relevance, combinedScore };
  });
  scored.sort((a, b) => b.combinedScore - a.combinedScore);
  return scored;
});

// ---------------------------------------------------------------------------
// Step 3: Group into byCategory + all + _deduplicated
// Input:  MemoryData[] (or ScoredMemory[])
// Output: { totalCount, byCategory, all, _deduplicated }
// ---------------------------------------------------------------------------
registerTransform("groupMemoriesByCategory", (
  rawData: MemoryData[],
  context: AssembledContext,
  sectionDef: CompositionSectionDef,
) => {
  const memories = rawData || [];
  const memoriesPerCategory = sectionDef.config?.memoriesPerCategory || context.specConfig.memoriesPerCategory || 5;
  const memoriesLimit = sectionDef.config?.memoriesLimit || context.specConfig.memoriesLimit || 50;

  const byCategory: Record<string, Array<{ key: string; value: string; confidence: number }>> = {};
  for (const m of memories) {
    if (!byCategory[m.category]) byCategory[m.category] = [];
    if (byCategory[m.category].length < memoriesPerCategory) {
      byCategory[m.category].push({
        key: m.key,
        value: m.value,
        confidence: m.confidence,
      });
    }
  }

  return {
    totalCount: memories.length,
    byCategory,
    all: memories.slice(0, memoriesLimit).map((m) => ({
      category: m.category,
      key: m.key,
      value: m.value,
      confidence: m.confidence,
    })),
    _deduplicated: memories,
  };
});

// ---------------------------------------------------------------------------
// Legacy monolithic transform — backward compat for specs using single string
// ---------------------------------------------------------------------------
registerTransform("deduplicateAndGroupMemories", (
  rawData: MemoryData[],
  context: AssembledContext,
  sectionDef: CompositionSectionDef,
) => {
  const memories = rawData || [];
  const memoriesPerCategory = sectionDef.config?.memoriesPerCategory || context.specConfig.memoriesPerCategory || 5;
  const memoriesLimit = sectionDef.config?.memoriesLimit || context.specConfig.memoriesLimit || 50;

  // #598 Slice 1 — same course-level decay scale as the split transform.
  const pbConfig = (context.loadedData?.playbooks?.[0]?.config || {}) as Record<string, unknown>;
  const tolerances = pbConfig.tolerances as { memoryDecayScale?: number } | undefined;
  const memoryDecayScale =
    typeof tolerances?.memoryDecayScale === "number" ? tolerances.memoryDecayScale : 1.0;

  // Step 1: Apply decay + deduplicate
  const decayed = memories.map((m) => ({ ...m, confidence: applyDecay(m, memoryDecayScale) }));
  const seen = new Map<string, MemoryData>();
  for (const m of decayed) {
    const normalizedKey = `${m.category}:${m.key.toLowerCase().replace(/\s+/g, "_")}`;
    const existing = seen.get(normalizedKey);
    if (!existing || m.confidence > existing.confidence) {
      seen.set(normalizedKey, m);
    }
  }
  const deduplicated = Array.from(seen.values());

  // Step 2: Score + sort
  const memConfig = sectionDef.config || {};
  const alpha: number = memConfig.relevanceAlpha ?? context.specConfig.relevanceAlpha ?? 0.6;
  const categoryWeights: Record<string, number> = memConfig.categoryRelevanceWeights ?? {};

  const sessionContext = {
    currentModule: context.sharedState?.moduleToReview?.name || null,
    nextModule: context.sharedState?.nextModule?.name || null,
    upcomingTopics: (context.sharedState?.modules || [])
      .slice(
        (context.sharedState?.lastCompletedIndex ?? -1) + 1,
        (context.sharedState?.lastCompletedIndex ?? -1) + 3,
      )
      .map((m: any) => m.name),
    learnerGoals: (context.loadedData?.goals || []).map((g: any) => g.name),
  };

  const scored = deduplicated.map((m) => {
    const relevance = computeMemoryRelevance(m, sessionContext, categoryWeights);
    const combinedScore = alpha * m.confidence + (1 - alpha) * relevance;
    return { ...m, relevance, combinedScore };
  });
  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  // Step 3: Group
  const byCategory: Record<string, Array<{ key: string; value: string; confidence: number }>> = {};
  for (const m of scored) {
    if (!byCategory[m.category]) byCategory[m.category] = [];
    if (byCategory[m.category].length < memoriesPerCategory) {
      byCategory[m.category].push({
        key: m.key,
        value: m.value,
        confidence: m.confidence,
      });
    }
  }

  return {
    totalCount: scored.length,
    byCategory,
    all: scored.slice(0, memoriesLimit).map((m) => ({
      category: m.category,
      key: m.key,
      value: m.value,
      confidence: m.confidence,
    })),
    _deduplicated: scored,
  };
});

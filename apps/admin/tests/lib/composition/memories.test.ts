import { describe, it, expect } from "vitest";
import { computeMemoryRelevance } from "@/lib/prompt/composition/transforms/memories";
import { getTransform } from "@/lib/prompt/composition/TransformRegistry";
import type { MemoryData, AssembledContext, CompositionSectionDef } from "@/lib/prompt/composition/types";

// Trigger transform registrations
import "@/lib/prompt/composition/transforms/memories";

function mem(overrides: Partial<MemoryData> = {}): MemoryData {
  return {
    category: "FACT",
    key: "location",
    value: "London",
    confidence: 0.8,
    evidence: null,
    extractedAt: null,
    decayFactor: 1.0,
    ...overrides,
  };
}

describe("computeMemoryRelevance", () => {
  describe("keyword overlap", () => {
    it("scores high when memory matches current module", () => {
      const m = mem({ key: "topic", value: "financial planning basics" });
      const score = computeMemoryRelevance(m, {
        currentModule: "Financial Planning Basics",
      });
      expect(score).toBeGreaterThan(0.5);
    });

    it("scores zero when no overlap", () => {
      const m = mem({ key: "pet", value: "dog named Rex" });
      const score = computeMemoryRelevance(m, {
        currentModule: "Advanced Calculus",
      });
      expect(score).toBe(0);
    });

    it("scores based on upcoming topics", () => {
      const m = mem({ key: "interest", value: "retirement savings" });
      const score = computeMemoryRelevance(m, {
        upcomingTopics: ["Retirement Savings Strategies"],
      });
      expect(score).toBeGreaterThan(0);
    });

    it("scores based on learner goals", () => {
      const m = mem({ key: "goal_note", value: "wants to learn budgeting" });
      const score = computeMemoryRelevance(m, {
        learnerGoals: ["Master budgeting skills"],
      });
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("empty context", () => {
    it("returns 0 when no session context and no category weight", () => {
      const score = computeMemoryRelevance(mem(), {});
      expect(score).toBe(0);
    });

    it("returns category weight when no session context", () => {
      const m = mem({ category: "CONTEXT" });
      const score = computeMemoryRelevance(m, {}, { CONTEXT: 0.15 });
      expect(score).toBe(0.15);
    });
  });

  describe("category weights (spec-driven)", () => {
    it("adds category boost to overlap score", () => {
      const m = mem({ category: "CONTEXT", key: "topic", value: "math basics" });
      const withoutBoost = computeMemoryRelevance(
        m,
        { currentModule: "Math Basics" },
      );
      const withBoost = computeMemoryRelevance(
        m,
        { currentModule: "Math Basics" },
        { CONTEXT: 0.15 },
      );
      expect(withBoost).toBeGreaterThan(withoutBoost);
    });

    it("does not exceed 1.0", () => {
      const m = mem({ category: "CONTEXT", key: "math", value: "math" });
      const score = computeMemoryRelevance(
        m,
        { currentModule: "math" },
        { CONTEXT: 0.9 },
      );
      expect(score).toBeLessThanOrEqual(1);
    });

    it("ignores unknown categories (no boost)", () => {
      const m = mem({ category: "CUSTOM" });
      const score = computeMemoryRelevance(m, {}, { FACT: 0.1 });
      expect(score).toBe(0);
    });

    it("handles empty weights object (no boost)", () => {
      const m = mem({ category: "FACT" });
      const score = computeMemoryRelevance(m, {}, {});
      expect(score).toBe(0);
    });
  });

  describe("recency boost", () => {
    it("boosts recently extracted memories", () => {
      const recent = mem({ extractedAt: new Date() }); // today
      const old = mem({ extractedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) }); // 120 days ago

      const recentScore = computeMemoryRelevance(recent, { currentModule: "London guide" });
      const oldScore = computeMemoryRelevance(old, { currentModule: "London guide" });

      // Both have same keyword overlap, but recent gets a boost
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it("gives no boost when extractedAt is null", () => {
      const noDate = mem({ extractedAt: null });
      const withDate = mem({ extractedAt: new Date() });

      const noDateScore = computeMemoryRelevance(noDate, { currentModule: "London guide" });
      const withDateScore = computeMemoryRelevance(withDate, { currentModule: "London guide" });

      expect(withDateScore).toBeGreaterThan(noDateScore);
    });

    it("recency boost decays over 90 days", () => {
      const fresh = mem({ extractedAt: new Date() });
      const midAge = mem({ extractedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) }); // 45 days
      const stale = mem({ extractedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }); // 90 days

      const freshScore = computeMemoryRelevance(fresh, { currentModule: "London guide" });
      const midScore = computeMemoryRelevance(midAge, { currentModule: "London guide" });
      const staleScore = computeMemoryRelevance(stale, { currentModule: "London guide" });

      expect(freshScore).toBeGreaterThan(midScore);
      expect(midScore).toBeGreaterThanOrEqual(staleScore);
    });

    it("recency boost is capped at 0.2", () => {
      // Memory with no keyword overlap, no category boost, only recency
      const recent = mem({ key: "pet", value: "dog", extractedAt: new Date() });
      const score = computeMemoryRelevance(recent, {}); // no context → only recency
      expect(score).toBeLessThanOrEqual(0.2);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("score bounds", () => {
    it("returns value between 0 and 1", () => {
      const m = mem({ key: "a b c d e f", value: "x y z" });
      const score = computeMemoryRelevance(
        m,
        { currentModule: "a b c d e f x y z" },
        { FACT: 0.5 },
      );
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });
});

describe("alpha blending (integration with sort)", () => {
  it("alpha=1.0 means pure confidence (default behavior)", () => {
    // When alpha=1.0: combinedScore = 1.0 * confidence + 0 * relevance = confidence
    const highConf = mem({ key: "pet", value: "dog", confidence: 0.95 });
    const lowConf = mem({ key: "topic", value: "math basics", confidence: 0.3 });

    const highConfRelevance = computeMemoryRelevance(highConf, { currentModule: "Math Basics" });
    const lowConfRelevance = computeMemoryRelevance(lowConf, { currentModule: "Math Basics" });

    // low confidence memory has higher relevance
    expect(lowConfRelevance).toBeGreaterThan(highConfRelevance);

    // but with alpha=1.0, confidence wins
    const alpha = 1.0;
    const highScore = alpha * highConf.confidence + (1 - alpha) * highConfRelevance;
    const lowScore = alpha * lowConf.confidence + (1 - alpha) * lowConfRelevance;
    expect(highScore).toBeGreaterThan(lowScore);
  });

  it("alpha=0.0 means pure relevance", () => {
    const highConf = mem({ key: "pet", value: "dog", confidence: 0.95 });
    const lowConf = mem({ key: "topic", value: "math basics", confidence: 0.3 });

    const highConfRelevance = computeMemoryRelevance(highConf, { currentModule: "Math Basics" });
    const lowConfRelevance = computeMemoryRelevance(lowConf, { currentModule: "Math Basics" });

    const alpha = 0.0;
    const highScore = alpha * highConf.confidence + (1 - alpha) * highConfRelevance;
    const lowScore = alpha * lowConf.confidence + (1 - alpha) * lowConfRelevance;
    // Now the relevant (but low-confidence) memory wins
    expect(lowScore).toBeGreaterThan(highScore);
  });

  it("alpha=0.5 is balanced blend", () => {
    const m = mem({ key: "math", value: "math basics", confidence: 0.6 });
    const relevance = computeMemoryRelevance(m, { currentModule: "Math Basics" });

    const alpha = 0.5;
    const blended = alpha * m.confidence + (1 - alpha) * relevance;

    expect(blended).toBeGreaterThan(0);
    expect(blended).toBeLessThanOrEqual(1);
    // Should be somewhere between confidence and relevance
    const minVal = Math.min(m.confidence, relevance);
    const maxVal = Math.max(m.confidence, relevance);
    expect(blended).toBeGreaterThanOrEqual(minVal);
    expect(blended).toBeLessThanOrEqual(maxVal);
  });
});

// ---------------------------------------------------------------------------
// Transform chain integration tests
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    loadedData: { goals: [] } as any,
    sections: {},
    resolvedSpecs: { identitySpec: null, voiceSpec: null },
    sharedState: {
      modules: [],
      isFirstCall: false,
      daysSinceLastCall: 0,
      completedModules: new Set(),
      estimatedProgress: 0,
      lastCompletedIndex: -1,
      moduleToReview: null,
      nextModule: null,
      reviewType: "",
      reviewReason: "",
      thresholds: { high: 0.65, low: 0.35 },
    },
    specConfig: {},
    ...overrides,
  };
}

function makeSectionDef(config: Record<string, any> = {}): CompositionSectionDef {
  return {
    id: "memories",
    name: "Caller Memories",
    priority: 4,
    dataSource: "memories",
    activateWhen: { condition: "dataExists" },
    fallback: { action: "emptyObject" },
    transform: ["deduplicateMemories", "scoreMemoryRelevance", "groupMemoriesByCategory"],
    config: { memoriesPerCategory: 5, ...config },
    outputKey: "memories",
  };
}

describe("transform chain: deduplicateMemories → scoreMemoryRelevance → groupMemoriesByCategory", () => {
  const testMemories: MemoryData[] = [
    mem({ category: "FACT", key: "location", value: "London", confidence: 0.9 }),
    mem({ category: "FACT", key: "location", value: "Paris", confidence: 0.7 }), // duplicate key, lower conf
    mem({ category: "PREFERENCE", key: "contact", value: "email", confidence: 0.8 }),
    mem({ category: "TOPIC", key: "interest", value: "math basics", confidence: 0.6 }),
  ];

  it("all 3 transforms are registered", () => {
    expect(getTransform("deduplicateMemories")).toBeDefined();
    expect(getTransform("scoreMemoryRelevance")).toBeDefined();
    expect(getTransform("groupMemoriesByCategory")).toBeDefined();
  });

  it("legacy monolithic transform still registered", () => {
    expect(getTransform("deduplicateAndGroupMemories")).toBeDefined();
  });

  it("chain produces same structure as monolithic transform", () => {
    const ctx = makeContext();
    const sectionDef = makeSectionDef();

    // Run chain
    const dedup = getTransform("deduplicateMemories")!(testMemories, ctx, sectionDef);
    const scored = getTransform("scoreMemoryRelevance")!(dedup, ctx, sectionDef);
    const grouped = getTransform("groupMemoriesByCategory")!(scored, ctx, sectionDef);

    // Run monolithic
    const monolithic = getTransform("deduplicateAndGroupMemories")!(testMemories, ctx, sectionDef);

    // Same structure
    expect(grouped).toHaveProperty("totalCount");
    expect(grouped).toHaveProperty("byCategory");
    expect(grouped).toHaveProperty("all");
    expect(grouped).toHaveProperty("_deduplicated");

    // Same counts (duplicate removed)
    expect(grouped.totalCount).toBe(monolithic.totalCount);
    expect(grouped.totalCount).toBe(3); // 4 input - 1 duplicate = 3
  });

  it("deduplicateMemories keeps highest confidence", () => {
    const ctx = makeContext();
    const sectionDef = makeSectionDef();

    const dedup = getTransform("deduplicateMemories")!(testMemories, ctx, sectionDef);
    expect(dedup).toHaveLength(3);

    const location = dedup.find((m: MemoryData) => m.key === "location");
    expect(location?.value).toBe("London"); // 0.9 > 0.7
    expect(location?.confidence).toBe(0.9);
  });

  it("scoreMemoryRelevance sorts by combined score", () => {
    const ctx = makeContext({
      sharedState: {
        modules: [{ slug: "math", name: "Math Basics" }],
        moduleToReview: { slug: "math", name: "Math Basics" },
        nextModule: null,
        isFirstCall: false,
        daysSinceLastCall: 0,
        completedModules: new Set(),
        estimatedProgress: 0,
        lastCompletedIndex: -1,
        reviewType: "",
        reviewReason: "",
        thresholds: { high: 0.65, low: 0.35 },
      },
    });
    const sectionDef = makeSectionDef({ relevanceAlpha: 0.5 });

    const dedup = getTransform("deduplicateMemories")!(testMemories, ctx, sectionDef);
    const scored = getTransform("scoreMemoryRelevance")!(dedup, ctx, sectionDef);

    // Each item should have relevance and combinedScore
    for (const m of scored) {
      expect(m).toHaveProperty("relevance");
      expect(m).toHaveProperty("combinedScore");
    }

    // The "math basics" interest should be boosted by relevance
    const mathItem = scored.find((m: any) => m.key === "interest");
    expect(mathItem?.relevance).toBeGreaterThan(0);
  });

  it("groupMemoriesByCategory respects memoriesPerCategory limit", () => {
    const ctx = makeContext();
    const sectionDef = makeSectionDef({ memoriesPerCategory: 1 });

    const manyFacts: MemoryData[] = [
      mem({ key: "fact1", value: "a", confidence: 0.9 }),
      mem({ key: "fact2", value: "b", confidence: 0.8 }),
      mem({ key: "fact3", value: "c", confidence: 0.7 }),
    ];

    const grouped = getTransform("groupMemoriesByCategory")!(manyFacts, ctx, sectionDef);
    expect(grouped.byCategory["FACT"]).toHaveLength(1); // limited to 1
    expect(grouped.totalCount).toBe(3); // all counted
  });
});

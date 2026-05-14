/**
 * Tests for lib/goals/extract-goals.ts — Goal Extraction from Transcripts
 *
 * Covers:
 * - extractGoals: skips short/null transcripts
 * - extractGoals: returns early for mock engine
 * - extractGoals: parses AI JSON response (with and without markdown fences)
 * - extractGoals: normalizes goal types and extraction methods
 * - extractGoals: skips low-confidence goals
 * - extractGoals: deduplication (LLM-flagged, exact match, similarity)
 * - extractGoals: creates new goals with correct data
 * - extractGoals: updates existing goals with new evidence
 * - extractGoals: handles JSON parse errors gracefully
 * - extractGoals: handles AI call failures gracefully
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

// Override @prisma/client to include GoalType and GoalStatus enums
vi.mock("@prisma/client", async (importOriginal) => {
  const orig = (await importOriginal()) as any;
  return {
    ...orig,
    GoalType: {
      LEARN: "LEARN",
      ACHIEVE: "ACHIEVE",
      CHANGE: "CHANGE",
      CONNECT: "CONNECT",
      SUPPORT: "SUPPORT",
      CREATE: "CREATE",
    },
    GoalStatus: {
      ACTIVE: "ACTIVE",
      COMPLETED: "COMPLETED",
      PAUSED: "PAUSED",
      ARCHIVED: "ARCHIVED",
    },
  };
});

const mockPrisma = {
  goal: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  callerAttribute: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

const mockGetConfiguredMeteredAICompletion = vi.fn();
const mockLogMockAIUsage = vi.fn();

vi.mock("@/lib/metering", () => ({
  getConfiguredMeteredAICompletion: (...args: any[]) =>
    mockGetConfiguredMeteredAICompletion(...args),
  logMockAIUsage: (...args: any[]) => mockLogMockAIUsage(...args),
}));

vi.mock("@/lib/logger", () => ({
  logAI: vi.fn(),
}));

vi.mock("@/lib/system-settings", () => ({
  getGoalSettings: vi.fn().mockResolvedValue({
    transcriptLimitChars: 4000,
    transcriptMinChars: 100,
    confidenceThreshold: 0.5,
    similarityThreshold: 0.8,
  }),
  getAITimeoutSettings: vi.fn().mockResolvedValue({
    pipelineTimeoutMs: 30000,
    classificationTimeoutMs: 30000,
  }),
}));

// =====================================================
// FIXTURES
// =====================================================

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeCall(transcript: string | null, id = "call-1") {
  return { id, transcript };
}

function makeExistingGoal(overrides: Partial<{
  id: string;
  type: string;
  name: string;
  status: string;
  priority: number;
  progressMetrics: any;
}> = {}) {
  return {
    id: overrides.id ?? "goal-1",
    type: overrides.type ?? "LEARN",
    name: overrides.name ?? "Learn quantum mechanics",
    status: overrides.status ?? "ACTIVE",
    priority: overrides.priority ?? 5,
    progressMetrics: overrides.progressMetrics ?? {},
  };
}

function makeAIResponse(goals: Array<{
  t: string;
  n: string;
  d: string;
  e: string;
  c: number;
  ev: string;
  dup?: string;
}>) {
  return {
    content: JSON.stringify({ goals }),
    model: "claude-sonnet-4",
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

const LONG_TRANSCRIPT = "I want to learn quantum mechanics because I find physics fascinating. ".repeat(20);

// =====================================================
// TESTS
// =====================================================

describe("lib/goals/extract-goals.ts", () => {
  let extractGoals: typeof import("@/lib/goals/extract-goals").extractGoals;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockPrisma.goal.findMany.mockResolvedValue([]);
    mockPrisma.goal.create.mockImplementation(async ({ data }: any) => ({
      id: "new-goal-id",
      ...data,
    }));
    mockPrisma.goal.update.mockResolvedValue({});
    mockLogMockAIUsage.mockResolvedValue(undefined);

    const mod = await import("@/lib/goals/extract-goals");
    extractGoals = mod.extractGoals;
  });

  // -------------------------------------------------
  // Input validation
  // -------------------------------------------------

  describe("input validation", () => {
    it("returns zero counts when transcript is null", async () => {
      const log = makeLogger();
      const result = await extractGoals(makeCall(null), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(0);
      expect(result.goalsUpdated).toBe(0);
      expect(result.goalsSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining("too short"),
        expect.any(Object)
      );
    });

    it("returns zero counts when transcript is too short", async () => {
      const log = makeLogger();
      const result = await extractGoals(makeCall("Hi"), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(0);
      expect(result.goalsUpdated).toBe(0);
      expect(result.goalsSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("does not call AI or prisma when transcript is too short", async () => {
      const log = makeLogger();
      await extractGoals(makeCall("Short"), "caller-1", "claude", log);

      expect(mockGetConfiguredMeteredAICompletion).not.toHaveBeenCalled();
      expect(mockPrisma.goal.findMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------
  // Mock engine
  // -------------------------------------------------

  describe("mock engine", () => {
    it("returns zero counts and logs mock usage for mock engine", async () => {
      const log = makeLogger();
      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "mock", log);

      expect(result.goalsCreated).toBe(0);
      expect(result.goalsUpdated).toBe(0);
      expect(result.goalsSkipped).toBe(0);
      expect(mockLogMockAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          callId: "call-1",
          callerId: "caller-1",
          sourceOp: "pipeline:extract_goals",
        })
      );
      expect(mockGetConfiguredMeteredAICompletion).not.toHaveBeenCalled();
    });

    it("handles logMockAIUsage failure gracefully", async () => {
      mockLogMockAIUsage.mockRejectedValue(new Error("DB error"));
      const log = makeLogger();
      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "mock", log);

      expect(result.goalsCreated).toBe(0);
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to log mock usage"),
        expect.any(Object)
      );
    });
  });

  // -------------------------------------------------
  // Goal creation
  // -------------------------------------------------

  describe("goal creation", () => {
    it("creates a new EXPLICIT goal with priority 7", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "Master calculus",
            d: "Wants to understand derivatives",
            e: "EXPLICIT",
            c: 0.9,
            ev: "I want to learn calculus",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
      expect(mockPrisma.goal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          callerId: "caller-1",
          playbookId: null,
          type: "LEARN",
          name: "Master calculus",
          description: "Wants to understand derivatives",
          status: "ACTIVE",
          priority: 7,
          progress: 0,
          progressMetrics: expect.objectContaining({
            extractionMethod: "EXPLICIT",
            confidence: 0.9,
            evidence: ["I want to learn calculus"],
            sourceCallId: "call-1",
          }),
        }),
      });
    });

    it("creates a new IMPLICIT goal with priority 5", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "SUPPORT",
            n: "Cope with stress",
            d: "Seems overwhelmed",
            e: "IMPLICIT",
            c: 0.6,
            ev: "I've been so stressed lately",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
      expect(mockPrisma.goal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          priority: 5,
          progressMetrics: expect.objectContaining({
            extractionMethod: "IMPLICIT",
          }),
        }),
      });
    });

    it("creates goals of all valid types", async () => {
      const log = makeLogger();
      const goalTypes = ["LEARN", "ACHIEVE", "CHANGE", "CONNECT", "SUPPORT", "CREATE"];
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse(
          goalTypes.map((t) => ({
            t,
            n: `Goal ${t}`,
            d: `Description ${t}`,
            e: "EXPLICIT",
            c: 0.85,
            ev: `Evidence for ${t}`,
          }))
        )
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(6);
      expect(mockPrisma.goal.create).toHaveBeenCalledTimes(6);
    });
  });

  // -------------------------------------------------
  // Goal normalization
  // -------------------------------------------------

  describe("goal normalization", () => {
    it("skips goals with unknown type", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "INVALID_TYPE",
            n: "Bad goal",
            d: "Unknown type",
            e: "EXPLICIT",
            c: 0.9,
            ev: "some quote",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsSkipped).toBe(1);
      expect(result.goalsCreated).toBe(0);
    });

    it("handles case-insensitive goal types", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "learn",
            n: "Learn physics",
            d: "Wants physics",
            e: "EXPLICIT",
            c: 0.85,
            ev: "teach me physics",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
    });

    it("defaults name to 'Unnamed goal' when empty", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "",
            d: "Some description",
            e: "EXPLICIT",
            c: 0.85,
            ev: "some evidence",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
      expect(mockPrisma.goal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Unnamed goal",
        }),
      });
    });

    it("clamps confidence to 0-1 range", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "High conf goal",
            d: "Over 1",
            e: "EXPLICIT",
            c: 5.0,
            ev: "evidence",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
      expect(mockPrisma.goal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          progressMetrics: expect.objectContaining({
            confidence: 1,
          }),
        }),
      });
    });

    it("defaults extraction method to EXPLICIT when not IMPLICIT", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "Some goal",
            d: "desc",
            e: "UNKNOWN",
            c: 0.85,
            ev: "evidence",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
      expect(mockPrisma.goal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          progressMetrics: expect.objectContaining({
            extractionMethod: "EXPLICIT",
          }),
        }),
      });
    });
  });

  // -------------------------------------------------
  // Confidence filtering
  // -------------------------------------------------

  describe("confidence filtering", () => {
    it("skips goals below confidence threshold (0.5)", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "Low confidence goal",
            d: "Not sure about this",
            e: "IMPLICIT",
            c: 0.3,
            ev: "might have mentioned it",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsSkipped).toBe(1);
      expect(result.goalsCreated).toBe(0);
      expect(log.debug).toHaveBeenCalledWith(
        expect.stringContaining("low confidence"),
        expect.objectContaining({ confidence: 0.3 })
      );
    });

    it("creates goals exactly at confidence threshold (0.5)", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "Borderline goal",
            d: "Just at threshold",
            e: "IMPLICIT",
            c: 0.5,
            ev: "some hint",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
    });
  });

  // -------------------------------------------------
  // Deduplication
  // -------------------------------------------------

  describe("deduplication", () => {
    it("updates existing goal when LLM flags a duplicate", async () => {
      const existing = makeExistingGoal({
        id: "existing-goal-1",
        type: "LEARN",
        name: "Learn quantum mechanics",
        progressMetrics: { evidence: ["earlier mention"], mentionCount: 1 },
      });
      mockPrisma.goal.findMany.mockResolvedValue([existing]);

      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "Quantum mechanics study",
            d: "Re-mentioned quantum",
            e: "EXPLICIT",
            c: 0.9,
            ev: "I still want to learn quantum mechanics",
            dup: "existing-goal-1",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsUpdated).toBe(1);
      expect(result.goalsCreated).toBe(0);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "existing-goal-1" },
        data: expect.objectContaining({
          progressMetrics: expect.objectContaining({
            evidence: ["earlier mention", "I still want to learn quantum mechanics"],
            mentionCount: 2,
          }),
          priority: 6, // 5 + 1
        }),
      });
    });

    it("updates existing goal on exact name match (case-insensitive)", async () => {
      const existing = makeExistingGoal({
        id: "existing-goal-2",
        type: "LEARN",
        name: "Learn Python",
        progressMetrics: {},
      });
      mockPrisma.goal.findMany.mockResolvedValue([existing]);

      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "learn python",
            d: "Python programming",
            e: "EXPLICIT",
            c: 0.85,
            ev: "I want to learn Python",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsUpdated).toBe(1);
      expect(result.goalsCreated).toBe(0);
    });

    it("creates new goal when type differs even if name matches", async () => {
      const existing = makeExistingGoal({
        id: "existing-goal-3",
        type: "LEARN",
        name: "Python",
      });
      mockPrisma.goal.findMany.mockResolvedValue([existing]);

      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "CREATE",
            n: "Python",
            d: "Build something with Python",
            e: "EXPLICIT",
            c: 0.85,
            ev: "I want to create a Python app",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
      expect(result.goalsUpdated).toBe(0);
    });

    it("caps priority at 10 when bumping duplicate", async () => {
      const existing = makeExistingGoal({
        id: "existing-goal-max",
        type: "LEARN",
        name: "Learn math",
        priority: 10,
        progressMetrics: { evidence: [], mentionCount: 5 },
      });
      mockPrisma.goal.findMany.mockResolvedValue([existing]);

      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "Learn math",
            d: "Math again",
            e: "EXPLICIT",
            c: 0.9,
            ev: "I really want to learn math",
            dup: "existing-goal-max",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsUpdated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "existing-goal-max" },
        data: expect.objectContaining({
          priority: 10, // Stays at 10, not 11
        }),
      });
    });

    it("creates new goal when LLM dup ID does not match any existing goal", async () => {
      const existing = makeExistingGoal({ id: "real-goal-id" });
      mockPrisma.goal.findMany.mockResolvedValue([existing]);

      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "ACHIEVE",
            n: "New achievement",
            d: "Something new",
            e: "EXPLICIT",
            c: 0.9,
            ev: "I want to achieve this",
            dup: "nonexistent-goal-id",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
    });
  });

  // -------------------------------------------------
  // JSON parsing
  // -------------------------------------------------

  describe("JSON parsing", () => {
    it("strips markdown code fences from AI response", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue({
        content: '```json\n{"goals":[{"t":"LEARN","n":"Test","d":"desc","e":"EXPLICIT","c":0.9,"ev":"quote"}]}\n```',
        model: "claude-sonnet-4",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
    });

    it("handles JSON parse error gracefully", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue({
        content: "This is not valid JSON at all",
        model: "claude-sonnet-4",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("JSON parse error");
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("JSON parse failed"),
        expect.any(Object)
      );
    });

    it("handles empty goals array in response", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(0);
      expect(result.goalsUpdated).toBe(0);
      expect(result.goalsSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("handles missing goals field in parsed JSON", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue({
        content: '{"noGoalsHere": true}',
        model: "claude-sonnet-4",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------
  // Error handling
  // -------------------------------------------------

  describe("error handling", () => {
    it("catches AI call failure and returns error", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockRejectedValue(
        new Error("AI service unavailable")
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe("AI service unavailable");
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining("Goal extraction failed"),
        expect.objectContaining({ callId: "call-1" })
      );
    });

    it("catches per-goal processing errors and continues", async () => {
      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          {
            t: "LEARN",
            n: "Good goal",
            d: "desc",
            e: "EXPLICIT",
            c: 0.9,
            ev: "evidence1",
          },
          {
            t: "ACHIEVE",
            n: "Another goal",
            d: "desc2",
            e: "EXPLICIT",
            c: 0.85,
            ev: "evidence2",
          },
        ])
      );

      // First create succeeds, second throws
      mockPrisma.goal.create
        .mockResolvedValueOnce({ id: "new-1", name: "Good goal" })
        .mockRejectedValueOnce(new Error("DB constraint violation"));

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Another goal");
      expect(result.errors[0]).toContain("DB constraint violation");
    });
  });

  // -------------------------------------------------
  // Multiple goals in a single response
  // -------------------------------------------------

  describe("multiple goals", () => {
    it("processes mix of created, updated, and skipped goals", async () => {
      const existing = makeExistingGoal({
        id: "existing-1",
        type: "LEARN",
        name: "Existing goal",
        progressMetrics: { evidence: [] },
      });
      mockPrisma.goal.findMany.mockResolvedValue([existing]);

      const log = makeLogger();
      mockGetConfiguredMeteredAICompletion.mockResolvedValue(
        makeAIResponse([
          // Should be created (new goal)
          {
            t: "ACHIEVE",
            n: "Pass the exam",
            d: "Certification exam",
            e: "EXPLICIT",
            c: 0.9,
            ev: "I need to pass the exam",
          },
          // Should be updated (matches existing by name)
          {
            t: "LEARN",
            n: "Existing goal",
            d: "Still interested",
            e: "EXPLICIT",
            c: 0.85,
            ev: "I want to continue learning",
          },
          // Should be skipped (low confidence)
          {
            t: "CONNECT",
            n: "Maybe make friends",
            d: "Uncertain",
            e: "IMPLICIT",
            c: 0.3,
            ev: "vague mention",
          },
          // Should be skipped (bad type)
          {
            t: "BOGUS",
            n: "Invalid",
            d: "Bad type",
            e: "EXPLICIT",
            c: 0.9,
            ev: "quote",
          },
        ])
      );

      const result = await extractGoals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

      expect(result.goalsCreated).toBe(1);
      expect(result.goalsUpdated).toBe(1);
      expect(result.goalsSkipped).toBe(2);
      expect(result.errors).toHaveLength(0);
    });
  });
});

// =====================================================
// extractGoalCompletionSignals
// =====================================================

describe("extractGoalCompletionSignals", () => {
  let extractGoalCompletionSignals: typeof import("@/lib/goals/extract-goals").extractGoalCompletionSignals;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockPrisma.goal.findMany.mockResolvedValue([]);
    mockPrisma.callerAttribute.findFirst.mockResolvedValue(null);
    mockPrisma.callerAttribute.create.mockResolvedValue({ id: "attr-1" });
    mockLogMockAIUsage.mockResolvedValue(undefined);

    const mod = await import("@/lib/goals/extract-goals");
    extractGoalCompletionSignals = mod.extractGoalCompletionSignals;
  });

  it("returns early for short transcripts", async () => {
    const log = makeLogger();
    const result = await extractGoalCompletionSignals(makeCall("Hi"), "caller-1", "claude", log);

    expect(result.signalsDetected).toBe(0);
    expect(mockPrisma.goal.findMany).not.toHaveBeenCalled();
  });

  it("returns early when no assessment target goals exist", async () => {
    const log = makeLogger();
    mockPrisma.goal.findMany.mockResolvedValue([]);

    const result = await extractGoalCompletionSignals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

    expect(result.signalsDetected).toBe(0);
    expect(mockGetConfiguredMeteredAICompletion).not.toHaveBeenCalled();
  });

  it("returns early for mock engine", async () => {
    const log = makeLogger();
    mockPrisma.goal.findMany.mockResolvedValue([{ id: "goal-1", name: "Pass exam" }]);

    const result = await extractGoalCompletionSignals(makeCall(LONG_TRANSCRIPT), "caller-1", "mock", log);

    expect(result.signalsDetected).toBe(0);
    expect(mockGetConfiguredMeteredAICompletion).not.toHaveBeenCalled();
  });

  it("creates CallerAttribute when signal detected with high confidence", async () => {
    const log = makeLogger();
    mockPrisma.goal.findMany.mockResolvedValue([{ id: "goal-1", name: "Pass the Beit Din" }]);
    mockGetConfiguredMeteredAICompletion.mockResolvedValue({
      content: JSON.stringify({
        signals: [{ goalId: "goal-1", evidence: "I passed the Beit Din!", confidence: 0.95 }],
      }),
      model: "claude-sonnet-4",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await extractGoalCompletionSignals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

    expect(result.signalsDetected).toBe(1);
    expect(mockPrisma.callerAttribute.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        callerId: "caller-1",
        key: "goal_completion_signal:goal-1",
        scope: "GOAL_EVENT",
        booleanValue: null,
        confidence: 0.95,
      }),
    });
  });

  it("skips signal with low confidence (<0.7)", async () => {
    const log = makeLogger();
    mockPrisma.goal.findMany.mockResolvedValue([{ id: "goal-1", name: "Pass exam" }]);
    mockGetConfiguredMeteredAICompletion.mockResolvedValue({
      content: JSON.stringify({
        signals: [{ goalId: "goal-1", evidence: "Maybe I passed?", confidence: 0.5 }],
      }),
      model: "claude-sonnet-4",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await extractGoalCompletionSignals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

    expect(result.signalsDetected).toBe(0);
    expect(mockPrisma.callerAttribute.create).not.toHaveBeenCalled();
  });

  it("skips signal with invalid goalId", async () => {
    const log = makeLogger();
    mockPrisma.goal.findMany.mockResolvedValue([{ id: "goal-1", name: "Pass exam" }]);
    mockGetConfiguredMeteredAICompletion.mockResolvedValue({
      content: JSON.stringify({
        signals: [{ goalId: "nonexistent", evidence: "I passed!", confidence: 0.95 }],
      }),
      model: "claude-sonnet-4",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await extractGoalCompletionSignals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

    expect(result.signalsDetected).toBe(0);
    expect(mockPrisma.callerAttribute.create).not.toHaveBeenCalled();
  });

  it("skips when signal already pending for goal", async () => {
    const log = makeLogger();
    mockPrisma.goal.findMany.mockResolvedValue([{ id: "goal-1", name: "Pass exam" }]);
    mockPrisma.callerAttribute.findFirst.mockResolvedValue({ id: "existing-attr" });
    mockGetConfiguredMeteredAICompletion.mockResolvedValue({
      content: JSON.stringify({
        signals: [{ goalId: "goal-1", evidence: "I passed!", confidence: 0.95 }],
      }),
      model: "claude-sonnet-4",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await extractGoalCompletionSignals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

    expect(result.signalsDetected).toBe(0);
    expect(mockPrisma.callerAttribute.create).not.toHaveBeenCalled();
  });

  it("handles AI failure gracefully", async () => {
    const log = makeLogger();
    mockPrisma.goal.findMany.mockResolvedValue([{ id: "goal-1", name: "Pass exam" }]);
    mockGetConfiguredMeteredAICompletion.mockRejectedValue(new Error("AI down"));

    const result = await extractGoalCompletionSignals(makeCall(LONG_TRANSCRIPT), "caller-1", "claude", log);

    expect(result.signalsDetected).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe("AI down");
  });
});

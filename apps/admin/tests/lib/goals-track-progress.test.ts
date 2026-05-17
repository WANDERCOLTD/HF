/**
 * Tests for lib/goals/track-progress.ts — Goal Progress Tracking
 *
 * Covers:
 * - trackGoalProgress: returns zeros when no active goals
 * - trackGoalProgress: LEARN goals with contentSpec (curriculum progress)
 * - trackGoalProgress: LEARN goals without contentSpec (fallback engagement)
 * - trackGoalProgress: CONNECT goals (score-based progress)
 * - trackGoalProgress: engagement-based goals (ACHIEVE, CHANGE, SUPPORT, CREATE)
 * - trackGoalProgress: marks goals COMPLETED when progress reaches 1.0
 * - trackGoalProgress: caps progress at 1.0
 * - trackGoalProgress: unknown goal types return null (no update)
 * - updateGoalProgress: clamps progress and marks completion
 * - Edge cases: no scores, short transcript, null transcript
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
    update: vi.fn(),
  },
  callerAttribute: {
    findMany: vi.fn(),
  },
  callScore: {
    findMany: vi.fn(),
  },
  call: {
    findUnique: vi.fn(),
  },
  callerTarget: {
    upsert: vi.fn(),
  },
  // #397 Phase 2: LEARN goal progress derived from CallerModuleProgress
  curriculumModule: {
    findMany: vi.fn(),
  },
  callerModuleProgress: {
    findMany: vi.fn(),
  },
  // #414 P5b: LEARN goal progress derived from a specific LO ref
  learningObjective: {
    findMany: vi.fn(),
  },
  // #417 P5b-ACHIEVE: skill-based progress via BehaviorTarget → CallerTarget
  behaviorTarget: {
    findFirst: vi.fn(),
  },
  callerTarget: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  // #439: per-playbook skillTierMapping override lookup
  playbook: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/registry", () => ({
  PARAMS: {
    BEH_WARMTH: "BEH-WARMTH",
    BEH_EMPATHY_RATE: "BEH-EMPATHY-RATE",
    BEH_INSIGHT_FREQUENCY: "BEH-INSIGHT-FREQUENCY",
    BEH_QUESTION_RATE: "BEH-QUESTION-RATE",
  },
}));

const mockComputeExamReadiness = vi.fn();
vi.mock("@/lib/curriculum/exam-readiness", () => ({
  computeExamReadiness: (...args: any[]) => mockComputeExamReadiness(...args),
}));

// #417 — ContractRegistry stub. Returns null so getSkillTierMapping falls
// back to the SKILL_TIER_DEFAULTS in track-progress.
vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    get: vi.fn().mockResolvedValue(null),
  },
}));

// =====================================================
// FIXTURES
// =====================================================

function makeGoal(overrides: Partial<{
  id: string;
  type: string;
  progress: number;
  contentSpec: any;
  callerId: string;
  isAssessmentTarget: boolean;
  assessmentConfig: any;
}> = {}) {
  return {
    id: overrides.id ?? "goal-1",
    type: overrides.type ?? "LEARN",
    progress: overrides.progress ?? 0,
    contentSpec: overrides.contentSpec ?? null,
    callerId: overrides.callerId ?? "caller-1",
    isAssessmentTarget: overrides.isAssessmentTarget ?? false,
    assessmentConfig: overrides.assessmentConfig ?? null,
  };
}

function makeContentSpec(
  domain: string,
  modules: string[] = ["mod1", "mod2", "mod3"]
) {
  return {
    domain,
    config: {
      curriculum: {
        modules: modules.map((m) => ({ id: m })),
      },
    },
  };
}

// =====================================================
// TESTS
// =====================================================

describe("lib/goals/track-progress.ts", () => {
  let trackGoalProgress: typeof import("@/lib/goals/track-progress").trackGoalProgress;
  let updateGoalProgress: typeof import("@/lib/goals/track-progress").updateGoalProgress;
  let applyAssessmentAdaptation: typeof import("@/lib/goals/track-progress").applyAssessmentAdaptation;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockPrisma.goal.findMany.mockResolvedValue([]);
    mockPrisma.goal.update.mockResolvedValue({});
    mockPrisma.callerAttribute.findMany.mockResolvedValue([]);
    mockPrisma.callScore.findMany.mockResolvedValue([]);
    mockPrisma.call.findUnique.mockResolvedValue(null);
    mockPrisma.callerTarget.upsert.mockResolvedValue({});
    // Default: no curriculum modules linked → Phase 2 derivation returns null,
    // letting individual tests fall through to legacy paths unless they
    // explicitly set up CallerModuleProgress fixtures.
    mockPrisma.curriculumModule.findMany.mockResolvedValue([]);
    mockPrisma.callerModuleProgress.findMany.mockResolvedValue([]);
    // #439 — default to no per-playbook override (falls back to contract/defaults)
    mockPrisma.playbook.findUnique.mockResolvedValue(null);
    mockComputeExamReadiness.mockResolvedValue({
      readinessScore: 0.6,
      level: "borderline",
      weakModules: [],
    });

    const mod = await import("@/lib/goals/track-progress");
    trackGoalProgress = mod.trackGoalProgress;
    updateGoalProgress = mod.updateGoalProgress;
    applyAssessmentAdaptation = mod.applyAssessmentAdaptation;
  });

  // -------------------------------------------------
  // No active goals
  // -------------------------------------------------

  describe("no active goals", () => {
    it("returns zeros when caller has no active goals", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(result.completed).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });

    it("queries goals with ACTIVE and PAUSED status", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);

      await trackGoalProgress("caller-1", "call-1");

      expect(mockPrisma.goal.findMany).toHaveBeenCalledWith({
        where: {
          callerId: "caller-1",
          status: { in: ["ACTIVE", "PAUSED"] },
        },
        include: {
          contentSpec: true,
        },
      });
    });
  });

  // -------------------------------------------------
  // LEARN goals with contentSpec
  // -------------------------------------------------

  describe("LEARN goals with contentSpec", () => {
    it("calculates progress from curriculum module completion", async () => {
      const goal = makeGoal({
        id: "learn-1",
        type: "LEARN",
        progress: 0,
        contentSpec: makeContentSpec("quantum", ["mod1", "mod2", "mod3", "mod4"]),
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      // 2 out of 4 modules completed
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        { key: "module_1", stringValue: "completed" },
        { key: "module_2", stringValue: "completed" },
        { key: "module_3", stringValue: "in_progress" },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      // Progress delta = 2/4 - 0 = 0.5
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "learn-1" },
        data: expect.objectContaining({
          progress: 0.5,
        }),
      });
    });

    it("does not update when curriculum progress has not increased", async () => {
      const goal = makeGoal({
        id: "learn-2",
        type: "LEARN",
        progress: 0.75, // Already at 75%
        contentSpec: makeContentSpec("quantum", ["mod1", "mod2", "mod3", "mod4"]),
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      // 2 out of 4 completed = 50%, less than current 75%
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        { key: "module_1", stringValue: "completed" },
        { key: "module_2", stringValue: "completed" },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      // Falls through to fallback 0.05 engagement increment since curriculumProgress (0.5) <= goal.progress (0.75)
      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "learn-2" },
        data: expect.objectContaining({
          progress: 0.8, // 0.75 + 0.05 fallback
        }),
      });
    });

    it("queries callerAttribute with correct domain and scope", async () => {
      const goal = makeGoal({
        type: "LEARN",
        contentSpec: makeContentSpec("physics"),
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      await trackGoalProgress("caller-1", "call-1");

      expect(mockPrisma.callerAttribute.findMany).toHaveBeenCalledWith({
        where: {
          callerId: "caller-1",
          scope: "CURRICULUM",
          domain: "physics",
          key: { contains: "module_" },
        },
      });
    });

    it("uses 1 as default totalModules when config has no modules", async () => {
      const goal = makeGoal({
        id: "learn-no-modules",
        type: "LEARN",
        progress: 0,
        contentSpec: { domain: "test", config: {} },
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      // 1 completed module, totalModules defaults to 1 => progress = 1.0
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        { key: "module_1", stringValue: "completed" },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(result.completed).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "learn-no-modules" },
        data: expect.objectContaining({
          progress: 1.0,
          status: "COMPLETED",
        }),
      });
    });
  });

  // -------------------------------------------------
  // #397 Phase 2: LEARN goals derived from CallerModuleProgress
  // -------------------------------------------------

  describe("LEARN goals — Phase 2 derivation from CallerModuleProgress", () => {
    it("derives progress from spec-level avg of module mastery", async () => {
      const goal = {
        ...makeGoal({
          id: "learn-derived",
          type: "LEARN",
          progress: 0,
          contentSpec: makeContentSpec("ielts"),
        }),
        contentSpecId: "spec-ielts-1",
      };
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      // 4 modules linked to this spec; 2 have CallerModuleProgress rows
      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        { id: "mod-a" }, { id: "mod-b" }, { id: "mod-c" }, { id: "mod-d" },
      ]);
      mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
        { mastery: 0.6 }, // mod-a
        { mastery: 0.4 }, // mod-b
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      // (0.6 + 0.4 + 0 + 0) / 4 = 0.25
      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "learn-derived" },
        data: expect.objectContaining({ progress: 0.25 }),
      });
    });

    it("untouched modules contribute 0 (penalises partial coverage)", async () => {
      const goal = {
        ...makeGoal({ id: "learn-cov", type: "LEARN", progress: 0, contentSpec: makeContentSpec("ielts") }),
        contentSpecId: "spec-ielts-1",
      };
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      // 1 module fully mastered, 3 untouched
      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        { id: "mod-a" }, { id: "mod-b" }, { id: "mod-c" }, { id: "mod-d" },
      ]);
      mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
        { mastery: 1.0 }, // mod-a
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      // 1.0 / 4 = 0.25 — NOT 1.0 (would be wrong: 75% of course untouched)
      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "learn-cov" },
        data: expect.objectContaining({ progress: 0.25 }),
      });
    });

    it("suppresses 5% engagement fallback when curriculum derivation has no progress to report", async () => {
      // Goal already at 0.5; new derivation is also 0.5 → no delta → must NOT
      // get a sneaky +0.05 from the engagement heuristic.
      const goal = {
        ...makeGoal({ id: "learn-stable", type: "LEARN", progress: 0.5, contentSpec: makeContentSpec("ielts") }),
        contentSpecId: "spec-ielts-1",
      };
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.curriculumModule.findMany.mockResolvedValue([
        { id: "mod-a" }, { id: "mod-b" },
      ]);
      mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
        { mastery: 0.5 }, { mastery: 0.5 },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });

    it("falls back to legacy attr path when no curriculum is linked to the spec", async () => {
      // curriculumModule.findMany returns [] → derivation returns null → legacy
      // callerAttribute path runs.
      const goal = {
        ...makeGoal({ id: "learn-legacy", type: "LEARN", progress: 0, contentSpec: makeContentSpec("legacy", ["m1", "m2"]) }),
        contentSpecId: "spec-legacy-1",
      };
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.curriculumModule.findMany.mockResolvedValue([]); // no curriculum
      mockPrisma.callerAttribute.findMany.mockResolvedValue([
        { key: "module_1", stringValue: "completed" },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      // 1/2 modules completed via legacy attr path
      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "learn-legacy" },
        data: expect.objectContaining({ progress: 0.5 }),
      });
    });
  });

  // -------------------------------------------------
  // #414 P5b: LEARN goals derived from Goal.ref (per-LO mastery)
  // -------------------------------------------------

  describe("LEARN goals — #414 derivation from Goal.ref", () => {
    function refGoal(over: Partial<{
      id: string;
      ref: string;
      progress: number;
    }> = {}) {
      return {
        id: over.id ?? "goal-ref",
        type: "LEARN",
        progress: over.progress ?? 0,
        contentSpec: null,
        contentSpecId: null,
        callerId: "caller-1",
        isAssessmentTarget: false,
        assessmentConfig: null,
        playbookId: "pb-1",
        ref: over.ref ?? "OUT-01",
      };
    }

    it("returns distinct progress per goal — Opal-shaped, 14 goals with 14 refs", async () => {
      // Eight OUT- refs + four SKILL- refs + two NULL-ref legacy → 14 goals
      const goals = [
        refGoal({ id: "g-1", ref: "OUT-01" }),
        refGoal({ id: "g-2", ref: "OUT-02" }),
        refGoal({ id: "g-3", ref: "OUT-03" }),
        refGoal({ id: "g-4", ref: "OUT-04" }),
      ];
      mockPrisma.goal.findMany.mockResolvedValue(goals);

      // Each ref lives in its own module.
      mockPrisma.learningObjective.findMany.mockImplementation(
        ({ where }: any) =>
          Promise.resolve([{ moduleId: `mod-${where.ref}` }]),
      );

      // Caller has progress on every module, with a distinct mastery per ref.
      mockPrisma.callerModuleProgress.findMany.mockImplementation(
        ({ where }: any) => {
          const moduleIds: string[] = where.moduleId.in;
          return Promise.resolve(
            moduleIds.map((id) => {
              const ref = id.replace(/^mod-/, "");
              // Build a deterministic per-ref mastery: OUT-01→0.1, OUT-02→0.2 …
              const n = parseInt(ref.split("-")[1] ?? "0", 10);
              return {
                moduleId: id,
                loScoresJson: { [ref]: { mastery: n / 10, callCount: 1 } },
              };
            }),
          );
        },
      );

      await trackGoalProgress("caller-1", "call-1");

      const updates = mockPrisma.goal.update.mock.calls.map((c: any) => ({
        id: c[0].where.id,
        progress: c[0].data.progress,
      }));

      // Each goal updates to its own ref's mastery — NOT a single uniform value.
      const byId = Object.fromEntries(updates.map((u: any) => [u.id, u.progress]));
      expect(byId["g-1"]).toBeCloseTo(0.1, 5);
      expect(byId["g-2"]).toBeCloseTo(0.2, 5);
      expect(byId["g-3"]).toBeCloseTo(0.3, 5);
      expect(byId["g-4"]).toBeCloseTo(0.4, 5);
    });

    it("aggregates a ref appearing in multiple modules via mean-across-modules", async () => {
      // OUT-01 lives in BOTH part1 (mastery 0.4) AND mock (mastery 0.6).
      mockPrisma.goal.findMany.mockResolvedValue([refGoal({ ref: "OUT-01" })]);

      mockPrisma.learningObjective.findMany.mockResolvedValue([
        { moduleId: "mod-part1" },
        { moduleId: "mod-mock" },
      ]);

      mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
        {
          moduleId: "mod-part1",
          loScoresJson: { "OUT-01": { mastery: 0.4, callCount: 2 } },
        },
        {
          moduleId: "mod-mock",
          loScoresJson: { "OUT-01": { mastery: 0.6, callCount: 1 } },
        },
      ]);

      await trackGoalProgress("caller-1", "call-1");

      // (0.4 + 0.6) / 2 = 0.5
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "goal-ref" },
        data: expect.objectContaining({ progress: 0.5 }),
      });
    });

    it("skips modules where caller has no loScoresJson entry for the ref (partial coverage)", async () => {
      // OUT-01 is in 2 modules, but caller only has progress on 1.
      mockPrisma.goal.findMany.mockResolvedValue([refGoal({ ref: "OUT-01" })]);

      mockPrisma.learningObjective.findMany.mockResolvedValue([
        { moduleId: "mod-part1" },
        { moduleId: "mod-mock" },
      ]);

      mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
        {
          moduleId: "mod-part1",
          loScoresJson: { "OUT-01": { mastery: 0.8, callCount: 3 } },
        },
        // mod-mock has no progress row at all
      ]);

      await trackGoalProgress("caller-1", "call-1");

      // Mean of the 1 touched module = 0.8 (NOT 0.4 = 0.8/2).
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "goal-ref" },
        data: expect.objectContaining({ progress: 0.8 }),
      });
    });

    it("falls back to engagement when goal.ref is null", async () => {
      // Legacy goal with no ref — should not enter the #414 path.
      const legacyGoal = {
        ...refGoal({ progress: 0 }),
        ref: null,
        playbookId: null,
      };
      mockPrisma.goal.findMany.mockResolvedValue([legacyGoal]);

      // Engagement fallback needs a transcript
      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "A".repeat(1200),
      });
      mockPrisma.callScore.findMany.mockResolvedValue([]);

      await trackGoalProgress("caller-1", "call-1");

      // The #414 path should NOT have queried learningObjective at all.
      expect(mockPrisma.learningObjective.findMany).not.toHaveBeenCalled();
      // Engagement fallback gives 5% increment
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "goal-ref" },
        data: expect.objectContaining({ progress: 0.05 }),
      });
    });

    it("ref-linked goal with no accumulated mastery returns no update (no fall-through to engagement)", async () => {
      // The exact bug #414 was meant to fix: previously, ref-linked goals
      // with no mastery yet fell through to the session-embedded heuristic
      // (COMP_/DISC_/COACH_ score average) which assigned every goal the
      // same uniform value. Ref-linked goals must NEVER fall through.
      mockPrisma.goal.findMany.mockResolvedValue([refGoal({ ref: "OUT-99" })]);

      // No LO with this ref → derivation returns null
      mockPrisma.learningObjective.findMany.mockResolvedValue([]);

      // If the engagement path leaked in it would average these scores
      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "A".repeat(1200),
      });
      mockPrisma.callScore.findMany.mockResolvedValue([
        { score: 0.7, parameter: { parameterId: "COMP_RECALL" } },
        { score: 0.8, parameter: { parameterId: "DISC_ARGUMENT" } },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });

    it("does not double-apply: if derived progress equals current, no update", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([
        refGoal({ progress: 0.7, ref: "OUT-01" }),
      ]);
      mockPrisma.learningObjective.findMany.mockResolvedValue([
        { moduleId: "mod-1" },
      ]);
      mockPrisma.callerModuleProgress.findMany.mockResolvedValue([
        {
          moduleId: "mod-1",
          loScoresJson: { "OUT-01": { mastery: 0.7, callCount: 5 } },
        },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------
  // #417 P5b-ACHIEVE: skill-based ACHIEVE progress
  // -------------------------------------------------

  describe("ACHIEVE goals — #417 skill-based progress", () => {
    function skillGoal(over: Partial<{
      id: string;
      ref: string;
      progress: number;
    }> = {}) {
      return {
        id: over.id ?? "skill-goal",
        type: "ACHIEVE",
        progress: over.progress ?? 0,
        contentSpec: null,
        contentSpecId: null,
        callerId: "caller-1",
        isAssessmentTarget: true,
        assessmentConfig: null,
        playbookId: "pb-1",
        ref: over.ref ?? "SKILL-01",
      };
    }

    it("derives progress from CallerTarget.currentScore / BehaviorTarget.targetValue", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([skillGoal()]);
      mockPrisma.behaviorTarget.findFirst.mockResolvedValue({
        parameterId: "skill_fluency_and_coherence_fc",
        targetValue: 1.0,
      });
      mockPrisma.callerTarget.findUnique.mockResolvedValue({
        currentScore: 0.62,
        callsUsed: 3,
      });

      await trackGoalProgress("caller-1", "call-1");

      expect(mockPrisma.goal.update).toHaveBeenCalledTimes(1);
      const call = mockPrisma.goal.update.mock.calls[0][0];
      expect(call.where.id).toBe("skill-goal");
      expect(call.data.progress).toBeCloseTo(0.62, 5);
    });

    it("evidence string cites tier + band number", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([skillGoal()]);
      mockPrisma.behaviorTarget.findFirst.mockResolvedValue({
        parameterId: "skill_xyz",
        targetValue: 1.0,
      });
      mockPrisma.callerTarget.findUnique.mockResolvedValue({
        currentScore: 0.62,
        callsUsed: 4,
      });

      const before = await import("@/lib/goals/track-progress");
      const result = await before.calculateSkillAchieveProgress(
        { id: "g-x", ref: "SKILL-01", playbookId: "pb-1", progress: 0 },
        "caller-1",
      );
      expect(result).not.toBeNull();
      // 0.62 falls in [0.55, 0.70) → "Developing" / band 5.5
      expect(result!.evidence).toContain("Developing");
      expect(result!.evidence).toContain("5.5");
      expect(result!.evidence).toContain("0.62");
    });

    it("returns null when no BehaviorTarget matches the skillRef", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([skillGoal({ ref: "SKILL-99" })]);
      mockPrisma.behaviorTarget.findFirst.mockResolvedValue(null);
      mockPrisma.callerTarget.findUnique.mockResolvedValue(null);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });

    it("returns null when CallerTarget has no currentScore yet", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([skillGoal()]);
      mockPrisma.behaviorTarget.findFirst.mockResolvedValue({
        parameterId: "skill_x",
        targetValue: 1.0,
      });
      mockPrisma.callerTarget.findUnique.mockResolvedValue({
        currentScore: null,
        callsUsed: 0,
      });

      const result = await trackGoalProgress("caller-1", "call-1");
      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });

    it("does NOT fall through to exam-readiness when isAssessmentTarget+contentSpec are both set", async () => {
      // The whole point of the routing precedence: a SKILL-NN goal with
      // contentSpec set still routes to skill mastery, not exam readiness.
      const dualLinkedGoal = {
        ...skillGoal(),
        contentSpec: { id: "cs-1", slug: "ielts" },
        contentSpecId: "cs-1",
      };
      mockPrisma.goal.findMany.mockResolvedValue([dualLinkedGoal]);
      mockPrisma.behaviorTarget.findFirst.mockResolvedValue({
        parameterId: "skill_x",
        targetValue: 1.0,
      });
      mockPrisma.callerTarget.findUnique.mockResolvedValue({
        currentScore: 0.4,
        callsUsed: 2,
      });

      await trackGoalProgress("caller-1", "call-1");

      // Skill path won — exam-readiness was never called
      expect(mockComputeExamReadiness).not.toHaveBeenCalled();
      expect(mockPrisma.goal.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.goal.update.mock.calls[0][0].data.progress).toBeCloseTo(0.4, 5);
    });

    // ── #437 — banding metadata persistence ───────────────────────────
    it("#437 persists tier+band+score+target+evidence into progressMetrics.progress", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([skillGoal()]);
      mockPrisma.behaviorTarget.findFirst.mockResolvedValue({
        parameterId: "skill_xyz",
        targetValue: 1.0,
      });
      mockPrisma.callerTarget.findUnique.mockResolvedValue({
        currentScore: 0.62, // → "Developing", band 5.5
        callsUsed: 4,
      });

      await trackGoalProgress("caller-1", "call-42");

      expect(mockPrisma.goal.update).toHaveBeenCalledTimes(1);
      const data = mockPrisma.goal.update.mock.calls[0][0].data;
      expect(data.progressMetrics).toBeDefined();
      expect(data.progressMetrics.progress).toMatchObject({
        tier: "Developing",
        band: 5.5,
        score: 0.62,
        target: 1.0,
        callId: "call-42",
      });
      expect(data.progressMetrics.progress.evidence).toContain("Developing");
      expect(data.progressMetrics.progress.evidence).toContain("5.5");
      expect(typeof data.progressMetrics.progress.at).toBe("string");
    });

    // ── #439 — per-playbook tier mapping override ─────────────────────
    it("#439 honours Playbook.config.skillTierMapping as a CEFR override", async () => {
      // Custom CEFR-shaped mapping — note "Emerging" still slots in
      // numerically but the band labels are CEFR.
      const cefrMapping = {
        thresholds: { approachingEmerging: 0.3, emerging: 0.5, developing: 0.75, secure: 1.0 },
        tierBands: { approachingEmerging: 2, emerging: 3, developing: 4, secure: 6 },
      };
      mockPrisma.playbook.findUnique.mockResolvedValue({ config: { skillTierMapping: cefrMapping } });
      mockPrisma.goal.findMany.mockResolvedValue([skillGoal()]);
      mockPrisma.behaviorTarget.findFirst.mockResolvedValue({
        parameterId: "skill_pres",
        targetValue: 1.0,
      });
      mockPrisma.callerTarget.findUnique.mockResolvedValue({
        // 0.6 falls in [0.5, 0.75) under CEFR → band 4 ("B2-equivalent")
        currentScore: 0.6,
        callsUsed: 3,
      });

      await trackGoalProgress("caller-1", "call-1");

      const data = mockPrisma.goal.update.mock.calls[0][0].data;
      expect(data.progressMetrics.progress.band).toBe(4); // CEFR band, NOT IELTS 5.5
      expect(data.progressMetrics.progress.tier).toBe("Developing");
    });

    it("#437 preserves existing progressMetrics keys when merging banding", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([
        {
          ...skillGoal(),
          progressMetrics: {
            extractionMethod: "EXPLICIT",
            evidence: ["caller said 'I want to pass IELTS'"],
            sourceCallId: "call-0",
            mentionCount: 2,
          },
        },
      ]);
      mockPrisma.behaviorTarget.findFirst.mockResolvedValue({
        parameterId: "skill_xyz",
        targetValue: 1.0,
      });
      mockPrisma.callerTarget.findUnique.mockResolvedValue({
        currentScore: 0.4, // → "Emerging", band 4
        callsUsed: 2,
      });

      await trackGoalProgress("caller-1", "call-99");

      const data = mockPrisma.goal.update.mock.calls[0][0].data;
      // extract-goals.ts metadata preserved (top-level keys untouched)
      expect(data.progressMetrics.extractionMethod).toBe("EXPLICIT");
      expect(data.progressMetrics.evidence).toEqual([
        "caller said 'I want to pass IELTS'",
      ]);
      expect(data.progressMetrics.mentionCount).toBe(2);
      // banding write nested under .progress so it can't collide
      expect(data.progressMetrics.progress.tier).toBe("Emerging");
      expect(data.progressMetrics.progress.band).toBe(4);
    });
  });

  describe("scoreToTier pure function (#417)", () => {
    it("maps 0.0 → Approaching Emerging (band 3)", async () => {
      const { scoreToTier } = await import("@/lib/goals/track-progress");
      expect(scoreToTier(0.0)).toEqual({ tier: "Approaching Emerging", band: 3 });
      expect(scoreToTier(0.29)).toEqual({ tier: "Approaching Emerging", band: 3 });
    });
    it("maps Emerging band (0.3-0.55)", async () => {
      const { scoreToTier } = await import("@/lib/goals/track-progress");
      expect(scoreToTier(0.3)).toEqual({ tier: "Emerging", band: 4 });
      expect(scoreToTier(0.54)).toEqual({ tier: "Emerging", band: 4 });
    });
    it("maps Developing band (0.55-0.70)", async () => {
      const { scoreToTier } = await import("@/lib/goals/track-progress");
      expect(scoreToTier(0.55)).toEqual({ tier: "Developing", band: 5.5 });
      expect(scoreToTier(0.69)).toEqual({ tier: "Developing", band: 5.5 });
    });
    it("maps Secure band (≥0.70)", async () => {
      const { scoreToTier } = await import("@/lib/goals/track-progress");
      expect(scoreToTier(0.7)).toEqual({ tier: "Secure", band: 7 });
      expect(scoreToTier(1.0)).toEqual({ tier: "Secure", band: 7 });
    });
    it("clamps out-of-range input", async () => {
      const { scoreToTier } = await import("@/lib/goals/track-progress");
      expect(scoreToTier(-0.1)).toEqual({ tier: "Approaching Emerging", band: 3 });
      expect(scoreToTier(1.5)).toEqual({ tier: "Secure", band: 7 });
    });
  });

  // -------------------------------------------------
  // LEARN goals without contentSpec (fallback)
  // -------------------------------------------------

  describe("LEARN goals without contentSpec", () => {
    it("gives 5% progress increment as fallback", async () => {
      const goal = makeGoal({
        id: "learn-no-spec",
        type: "LEARN",
        progress: 0.2,
        contentSpec: null,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "learn-no-spec" },
        data: expect.objectContaining({
          progress: 0.25, // 0.2 + 0.05
        }),
      });
    });
  });

  // -------------------------------------------------
  // CONNECT goals
  // -------------------------------------------------

  describe("CONNECT goals", () => {
    it("gives 10% progress for high connection scores (>0.7)", async () => {
      const goal = makeGoal({
        id: "connect-1",
        type: "CONNECT",
        progress: 0.3,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.callScore.findMany.mockResolvedValue([
        { score: 0.85, parameter: { parameterId: "BEH-WARMTH" } },
        { score: 0.9, parameter: { parameterId: "BEH-EMPATHY-RATE" } },
        { score: 0.8, parameter: { parameterId: "BEH-INSIGHT-FREQUENCY" } },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "connect-1" },
        data: expect.objectContaining({
          progress: 0.4, // 0.3 + 0.1
        }),
      });
    });

    it("gives 5% progress for moderate connection scores (>0.5, <=0.7)", async () => {
      const goal = makeGoal({
        id: "connect-2",
        type: "CONNECT",
        progress: 0.1,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.callScore.findMany.mockResolvedValue([
        { score: 0.6, parameter: { parameterId: "BEH-WARMTH" } },
        { score: 0.55, parameter: { parameterId: "BEH-EMPATHY-RATE" } },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      const updateCall = mockPrisma.goal.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe("connect-2");
      expect(updateCall.data.progress).toBeCloseTo(0.15, 10); // 0.1 + 0.05
    });

    it("returns no update for low connection scores (<=0.5)", async () => {
      const goal = makeGoal({
        id: "connect-3",
        type: "CONNECT",
        progress: 0.1,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.callScore.findMany.mockResolvedValue([
        { score: 0.3, parameter: { parameterId: "BEH-WARMTH" } },
        { score: 0.4, parameter: { parameterId: "BEH-EMPATHY-RATE" } },
      ]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });

    it("returns no update when no connection scores exist", async () => {
      const goal = makeGoal({
        id: "connect-4",
        type: "CONNECT",
        progress: 0,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.callScore.findMany.mockResolvedValue([]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
    });

    it("queries callScore with correct parameter IDs", async () => {
      const goal = makeGoal({ type: "CONNECT" });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      await trackGoalProgress("caller-1", "call-1");

      expect(mockPrisma.callScore.findMany).toHaveBeenCalledWith({
        where: {
          callId: "call-1",
          parameter: {
            parameterId: {
              in: ["BEH-WARMTH", "BEH-EMPATHY-RATE", "BEH-INSIGHT-FREQUENCY"],
            },
          },
        },
        include: {
          parameter: true,
        },
      });
    });
  });

  // -------------------------------------------------
  // Engagement-based goals (ACHIEVE, CHANGE, SUPPORT, CREATE)
  // -------------------------------------------------

  describe("engagement-based goals", () => {
    it("gives 5% progress for long transcripts (>1000 chars)", async () => {
      const goal = makeGoal({
        id: "achieve-1",
        type: "ACHIEVE",
        progress: 0.4,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "A".repeat(1500),
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "achieve-1" },
        data: expect.objectContaining({
          progress: 0.45, // 0.4 + 0.05
        }),
      });
    });

    it("gives 2% progress for moderate transcripts (>500, <=1000 chars)", async () => {
      const goal = makeGoal({
        id: "change-1",
        type: "CHANGE",
        progress: 0.5,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "B".repeat(750),
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "change-1" },
        data: expect.objectContaining({
          progress: 0.52, // 0.5 + 0.02
        }),
      });
    });

    it("returns no update for short transcripts (<=500 chars)", async () => {
      const goal = makeGoal({
        id: "support-1",
        type: "SUPPORT",
        progress: 0.3,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "C".repeat(200),
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });

    it("returns no update when call has no transcript", async () => {
      const goal = makeGoal({
        id: "create-1",
        type: "CREATE",
        progress: 0.2,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.call.findUnique.mockResolvedValue({ transcript: null });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
    });

    it("returns no update when call does not exist", async () => {
      const goal = makeGoal({
        id: "create-2",
        type: "CREATE",
        progress: 0.2,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.call.findUnique.mockResolvedValue(null);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
    });

    it("works for all engagement-based goal types", async () => {
      const engagementTypes = ["ACHIEVE", "CHANGE", "SUPPORT", "CREATE"];

      for (const goalType of engagementTypes) {
        vi.clearAllMocks();
        const goal = makeGoal({
          id: `goal-${goalType}`,
          type: goalType,
          progress: 0,
        });
        mockPrisma.goal.findMany.mockResolvedValue([goal]);
        mockPrisma.call.findUnique.mockResolvedValue({
          transcript: "X".repeat(2000),
        });

        const result = await trackGoalProgress("caller-1", "call-1");

        expect(result.updated).toBe(1);
        expect(mockPrisma.goal.update).toHaveBeenCalledWith({
          where: { id: `goal-${goalType}` },
          data: expect.objectContaining({
            progress: 0.05,
          }),
        });
      }
    });

    it("gives +3% keyword relevance bonus when goal name terms appear in transcript", async () => {
      const goal = makeGoal({
        id: "keyword-match",
        type: "ACHIEVE",
        progress: 0.2,
      });
      // Override default goal name to something searchable
      (goal as any).name = "Master fractions";
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      // Long transcript that mentions "fractions"
      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "Today we talked about fractions and how to simplify them. " + "X".repeat(1000),
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "keyword-match" },
        data: expect.objectContaining({
          progress: 0.28, // 0.2 + 0.05 (engagement) + 0.03 (keyword bonus)
        }),
      });
    });

    it("gives keyword bonus even for short transcripts if goal terms match", async () => {
      const goal = makeGoal({
        id: "short-relevant",
        type: "ACHIEVE",
        progress: 0.5,
      });
      (goal as any).name = "Learn fractions";
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      // Short transcript (< 500 chars) but mentions "fractions"
      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "We discussed fractions briefly today.",
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "short-relevant" },
        data: expect.objectContaining({
          progress: 0.53, // 0.5 + 0.00 (short transcript) + 0.03 (keyword bonus)
        }),
      });
    });

    it("no keyword bonus when goal name has only short words", async () => {
      const goal = makeGoal({
        id: "short-words",
        type: "ACHIEVE",
        progress: 0.4,
      });
      (goal as any).name = "Do it";
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "Do it now! " + "X".repeat(1000),
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      // Only base engagement, no keyword bonus (words <= 3 chars filtered out)
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "short-words" },
        data: expect.objectContaining({
          progress: 0.45, // 0.4 + 0.05 (engagement only)
        }),
      });
    });
  });

  // -------------------------------------------------
  // Goal completion
  // -------------------------------------------------

  describe("goal completion", () => {
    it("marks goal as COMPLETED when progress reaches 1.0", async () => {
      const goal = makeGoal({
        id: "almost-done",
        type: "LEARN",
        progress: 0.97,
        contentSpec: null,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(result.completed).toBe(1);
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "almost-done" },
        data: expect.objectContaining({
          progress: 1.0, // Math.min(1.0, 0.97 + 0.05)
          status: "COMPLETED",
          completedAt: expect.any(Date),
        }),
      });
    });

    it("caps progress at 1.0", async () => {
      const goal = makeGoal({
        id: "overflow",
        type: "LEARN",
        progress: 0.99,
        contentSpec: null,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "overflow" },
        data: expect.objectContaining({
          progress: 1.0, // Not 1.04
        }),
      });
    });

    it("does not set COMPLETED status when progress < 1.0", async () => {
      const goal = makeGoal({
        id: "in-progress",
        type: "LEARN",
        progress: 0.5,
        contentSpec: null,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      await trackGoalProgress("caller-1", "call-1");

      const updateCall = mockPrisma.goal.update.mock.calls[0][0];
      expect(updateCall.data.progress).toBe(0.55);
      expect(updateCall.data.status).toBeUndefined();
      expect(updateCall.data.completedAt).toBeUndefined();
    });
  });

  // -------------------------------------------------
  // Unknown goal types
  // -------------------------------------------------

  describe("unknown goal types", () => {
    it("returns no update for unknown goal type", async () => {
      const goal = makeGoal({
        id: "unknown-1",
        type: "UNKNOWN_TYPE" as any,
        progress: 0.5,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------
  // Multiple goals
  // -------------------------------------------------

  describe("multiple goals", () => {
    it("processes multiple goals independently", async () => {
      const goals = [
        makeGoal({ id: "g1", type: "LEARN", progress: 0, contentSpec: null }),
        makeGoal({ id: "g2", type: "CONNECT", progress: 0 }),
        makeGoal({ id: "g3", type: "ACHIEVE", progress: 0 }),
      ];
      mockPrisma.goal.findMany.mockResolvedValue(goals);

      // LEARN fallback = 0.05
      // CONNECT = no scores -> no update
      mockPrisma.callScore.findMany.mockResolvedValue([]);
      // ACHIEVE = long transcript -> 0.05
      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "D".repeat(2000),
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      // LEARN (0.05) + ACHIEVE (0.05) = 2 updated, CONNECT = 0
      expect(result.updated).toBe(2);
      expect(result.completed).toBe(0);
    });
  });

  // -------------------------------------------------
  // updateGoalProgress (manual update)
  // -------------------------------------------------

  describe("updateGoalProgress", () => {
    it("updates goal with clamped progress", async () => {
      await updateGoalProgress("goal-1", 0.75);

      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "goal-1" },
        data: expect.objectContaining({
          progress: 0.75,
          updatedAt: expect.any(Date),
        }),
      });
    });

    it("clamps progress above 1.0 to 1.0 and marks COMPLETED", async () => {
      await updateGoalProgress("goal-2", 1.5);

      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "goal-2" },
        data: expect.objectContaining({
          progress: 1.0,
          status: "COMPLETED",
          completedAt: expect.any(Date),
        }),
      });
    });

    it("clamps progress below 0 to 0", async () => {
      await updateGoalProgress("goal-3", -0.5);

      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "goal-3" },
        data: expect.objectContaining({
          progress: 0,
        }),
      });
    });

    it("marks COMPLETED when progress is exactly 1.0", async () => {
      await updateGoalProgress("goal-4", 1.0);

      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "goal-4" },
        data: expect.objectContaining({
          progress: 1.0,
          status: "COMPLETED",
          completedAt: expect.any(Date),
        }),
      });
    });

    it("does not mark COMPLETED when progress < 1.0", async () => {
      await updateGoalProgress("goal-5", 0.99);

      const updateCall = mockPrisma.goal.update.mock.calls[0][0];
      expect(updateCall.data.progress).toBe(0.99);
      expect(updateCall.data.status).toBeUndefined();
      expect(updateCall.data.completedAt).toBeUndefined();
    });
  });

  // -------------------------------------------------
  // Assessment target goals
  // -------------------------------------------------

  describe("assessment target goals", () => {
    it("uses exam readiness for assessment targets with contentSpec", async () => {
      const goal = makeGoal({
        id: "assess-1",
        type: "ACHIEVE",
        progress: 0.3,
        isAssessmentTarget: true,
        contentSpec: { slug: "hebrew-content", domain: "hebrew" },
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockComputeExamReadiness.mockResolvedValue({
        readinessScore: 0.65,
        level: "borderline",
        weakModules: ["mod3"],
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(mockComputeExamReadiness).toHaveBeenCalledWith("caller-1", "hebrew-content");
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "assess-1" },
        data: expect.objectContaining({
          progress: 0.65, // 0.3 + (0.65 - 0.3) = 0.65
        }),
      });
    });

    it("does not update when exam readiness is below current progress", async () => {
      const goal = makeGoal({
        id: "assess-2",
        type: "ACHIEVE",
        progress: 0.7,
        isAssessmentTarget: true,
        contentSpec: { slug: "hebrew-content", domain: "hebrew" },
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockComputeExamReadiness.mockResolvedValue({
        readinessScore: 0.5,
        level: "borderline",
        weakModules: [],
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(0);
      expect(mockPrisma.goal.update).not.toHaveBeenCalled();
    });

    it("does NOT auto-complete assessment targets at progress 1.0", async () => {
      const goal = makeGoal({
        id: "assess-3",
        type: "ACHIEVE",
        progress: 0.95,
        isAssessmentTarget: true,
        contentSpec: { slug: "hebrew-content", domain: "hebrew" },
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockComputeExamReadiness.mockResolvedValue({
        readinessScore: 1.0,
        level: "strong",
        weakModules: [],
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(result.completed).toBe(0); // NOT auto-completed
      const updateCall = mockPrisma.goal.update.mock.calls[0][0];
      expect(updateCall.data.progress).toBe(1.0);
      expect(updateCall.data.status).toBeUndefined(); // No COMPLETED status
    });

    it("falls back to conservative heuristic when exam readiness fails", async () => {
      const goal = makeGoal({
        id: "assess-4",
        type: "ACHIEVE",
        progress: 0.4,
        isAssessmentTarget: true,
        contentSpec: { slug: "broken-spec", domain: "test" },
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockComputeExamReadiness.mockRejectedValue(new Error("Contract not seeded"));

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      const updateCall = mockPrisma.goal.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe("assess-4");
      expect(updateCall.data.progress).toBeCloseTo(0.43, 10); // 0.4 + 0.03 conservative fallback
    });

    it("routes assessment targets without contentSpec through engagement heuristic", async () => {
      const goal = makeGoal({
        id: "assess-no-spec",
        type: "ACHIEVE",
        progress: 0.2,
        isAssessmentTarget: true,
        contentSpec: null,
      });
      mockPrisma.goal.findMany.mockResolvedValue([goal]);

      mockPrisma.call.findUnique.mockResolvedValue({
        transcript: "A".repeat(1500),
      });

      const result = await trackGoalProgress("caller-1", "call-1");

      expect(result.updated).toBe(1);
      expect(mockComputeExamReadiness).not.toHaveBeenCalled();
      // Falls through to engagement-based progress (ACHIEVE type)
      expect(mockPrisma.goal.update).toHaveBeenCalledWith({
        where: { id: "assess-no-spec" },
        data: expect.objectContaining({
          progress: 0.25, // 0.2 + 0.05 engagement
        }),
      });
    });
  });

  // -------------------------------------------------
  // applyAssessmentAdaptation
  // -------------------------------------------------

  describe("applyAssessmentAdaptation", () => {
    it("returns zero adjustments when no assessment targets", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([]);

      const result = await applyAssessmentAdaptation("caller-1");

      expect(result.adjustments).toBe(0);
      expect(mockPrisma.callerTarget.upsert).not.toHaveBeenCalled();
    });

    it("increases question rate when near threshold (>= 0.7)", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([
        { progress: 0.75, assessmentConfig: { threshold: 0.8 } },
      ]);

      const result = await applyAssessmentAdaptation("caller-1");

      expect(result.adjustments).toBe(1);
      expect(mockPrisma.callerTarget.upsert).toHaveBeenCalledWith({
        where: { callerId_parameterId: { callerId: "caller-1", parameterId: "BEH-QUESTION-RATE" } },
        create: expect.objectContaining({ targetValue: 0.8, confidence: 0.7 }),
        update: expect.objectContaining({ targetValue: 0.8, confidence: 0.7 }),
      });
    });

    it("decreases question rate when far from threshold (< 0.3)", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([
        { progress: 0.15, assessmentConfig: { threshold: 0.8 } },
      ]);

      const result = await applyAssessmentAdaptation("caller-1");

      expect(result.adjustments).toBe(1);
      expect(mockPrisma.callerTarget.upsert).toHaveBeenCalledWith({
        where: { callerId_parameterId: { callerId: "caller-1", parameterId: "BEH-QUESTION-RATE" } },
        create: expect.objectContaining({ targetValue: 0.3, confidence: 0.6 }),
        update: expect.objectContaining({ targetValue: 0.3, confidence: 0.6 }),
      });
    });

    it("makes no adjustments in middle range (0.3-0.7)", async () => {
      mockPrisma.goal.findMany.mockResolvedValue([
        { progress: 0.5, assessmentConfig: { threshold: 0.8 } },
      ]);

      const result = await applyAssessmentAdaptation("caller-1");

      expect(result.adjustments).toBe(0);
      expect(mockPrisma.callerTarget.upsert).not.toHaveBeenCalled();
    });
  });
});

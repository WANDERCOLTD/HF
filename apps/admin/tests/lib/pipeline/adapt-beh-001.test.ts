/**
 * ADAPT-BEH-001 round-trip — story #2074 closes the beh-aggregate-cascade
 * ADAPT leg.
 *
 * What this pins:
 *
 *   - The new `dataSource: "callerAttribute"` branch in adapt-runner.ts
 *     reads CallerAttribute(callerId, key, scope) by PK and feeds the
 *     value into evaluateCondition.
 *   - `scope` defaults to "BEH-AGG-001" when omitted, overridable per-rule.
 *   - When the CallerAttribute row is absent (AGGREGATE hasn't yet met
 *     minimumObservations), readCallerAttribute returns null and the
 *     rule silently skips — natural activation gate.
 *   - End-to-end round-trip: seeded CallerAttribute → runAdaptSpecs →
 *     CallerTarget upsert with the expected delta.
 *   - Existing dataSource branches ("parameterValues", "learnerProfile")
 *     are NOT regressed by the extension.
 *
 * Counterpart spec: docs-archive/bdd-specs/ADAPT-BEH-001-behavior-adaptation.spec.json
 * Counterpart chain: docs/lattice-chains.json → beh-aggregate-cascade
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ────────────────────────────────────────────────────────────
// Prisma mock surface
// ────────────────────────────────────────────────────────────

const mockAnalysisSpecFindMany = vi.fn();
const mockCallerAttributeFindUnique = vi.fn();
const mockCallerPersonalityProfileFindUnique = vi.fn();
const mockParameterFindUnique = vi.fn();
const mockCallerTargetFindUnique = vi.fn();
const mockCallerTargetUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    analysisSpec: {
      findMany: (...args: unknown[]) => mockAnalysisSpecFindMany(...args),
    },
    callerAttribute: {
      findUnique: (...args: unknown[]) => mockCallerAttributeFindUnique(...args),
    },
    callerPersonalityProfile: {
      findUnique: (...args: unknown[]) =>
        mockCallerPersonalityProfileFindUnique(...args),
    },
    parameter: {
      findUnique: (...args: unknown[]) => mockParameterFindUnique(...args),
    },
    callerTarget: {
      findUnique: (...args: unknown[]) => mockCallerTargetFindUnique(...args),
      upsert: (...args: unknown[]) => mockCallerTargetUpsert(...args),
    },
  },
}));

// getLearnerProfile is called once per runAdaptSpecs — mock to a stable empty.
vi.mock("@/lib/learner/profile", () => ({
  getLearnerProfile: vi.fn().mockResolvedValue({}),
}));

import { runAdaptSpecs, evaluateCondition, AdaptCondition } from "@/lib/pipeline/adapt-runner";

// ────────────────────────────────────────────────────────────
// Spec fixtures — minimal slices of ADAPT-BEH-001 + a control
// ────────────────────────────────────────────────────────────

const ADAPT_BEH_001_SUPERVISION_TUTOR_FIDELITY_SPEC = {
  slug: "ADAPT-BEH-001",
  outputType: "ADAPT",
  isActive: true,
  config: {
    defaultAdaptConfidence: 0.75,
    parameters: [
      {
        id: "supervision_tutor_fidelity_adaptation",
        config: {
          adaptationRules: [
            {
              condition: {
                profileKey: "behavior_profile:supervision:tutor_fidelity",
                operator: "eq",
                value: "low",
                dataSource: "callerAttribute",
                scope: "BEH-AGG-001",
              },
              actions: [
                {
                  targetParameter: "BEH-DEFINITION-PRECISION",
                  adjustment: "increase",
                  delta: 0.1,
                  rationale: "Supervision flagged low tutor fidelity",
                },
              ],
            },
          ],
        },
      },
    ],
  },
};

const ADAPT_BEH_001_ENGAGEMENT_DRIFT_SPEC = {
  slug: "ADAPT-BEH-001-engagement",
  outputType: "ADAPT",
  isActive: true,
  config: {
    defaultAdaptConfidence: 0.75,
    parameters: [
      {
        id: "engagement_call_frequency_adaptation",
        config: {
          adaptationRules: [
            {
              condition: {
                profileKey: "behavior_profile:engagement:call_frequency_fidelity",
                operator: "eq",
                value: "drift",
                dataSource: "callerAttribute",
                scope: "BEH-AGG-001",
              },
              actions: [
                {
                  targetParameter: "BEH-ENGAGEMENT",
                  adjustment: "set",
                  value: 0.8,
                  rationale: "Call cadence drifting",
                },
              ],
            },
          ],
        },
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // By default, no CallerAttribute, no existing target, parameter exists.
  mockCallerAttributeFindUnique.mockResolvedValue(null);
  mockCallerTargetFindUnique.mockResolvedValue(null);
  mockCallerTargetUpsert.mockResolvedValue({});
  mockParameterFindUnique.mockImplementation(async ({ where }: any) => ({
    parameterId: where.parameterId,
  }));
});

// ────────────────────────────────────────────────────────────
// Unit — evaluateCondition with the "in" operator on the
// categorical strings BEH-AGG-001 writes
// ────────────────────────────────────────────────────────────

describe("evaluateCondition — categorical strings (BEH-AGG-001 values)", () => {
  it("fires for 'low' when condition.value === 'low'", () => {
    const condition: AdaptCondition = {
      profileKey: "behavior_profile:supervision:tutor_fidelity",
      operator: "eq",
      value: "low",
      dataSource: "callerAttribute",
    };
    expect(evaluateCondition(condition, "low")).toBe(true);
    expect(evaluateCondition(condition, "moderate")).toBe(false);
    expect(evaluateCondition(condition, "high")).toBe(false);
  });

  it("returns false for null profileValue (natural activation gate)", () => {
    const condition: AdaptCondition = {
      profileKey: "behavior_profile:companion:engagement_level",
      operator: "eq",
      value: "low",
      dataSource: "callerAttribute",
    };
    expect(evaluateCondition(condition, null)).toBe(false);
  });

  it("supports 'in' operator for value-set matches", () => {
    const condition: AdaptCondition = {
      profileKey: "behavior_profile:companion:empathy_level",
      operator: "in",
      values: ["emerging", "no_evidence"],
      dataSource: "callerAttribute",
    };
    expect(evaluateCondition(condition, "emerging")).toBe(true);
    expect(evaluateCondition(condition, "no_evidence")).toBe(true);
    expect(evaluateCondition(condition, "secure")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// Integration — runAdaptSpecs round-trip
// ────────────────────────────────────────────────────────────

describe("runAdaptSpecs — callerAttribute dataSource round-trip (story #2074)", () => {
  it("reads BEH-AGG-001 CallerAttribute by PK using the default scope", async () => {
    mockAnalysisSpecFindMany.mockResolvedValue([
      ADAPT_BEH_001_SUPERVISION_TUTOR_FIDELITY_SPEC,
    ]);
    mockCallerAttributeFindUnique.mockResolvedValue({ stringValue: "low" });

    await runAdaptSpecs("caller-bertie");

    // The runner must call findUnique with the compound-PK shape and the
    // spec-supplied scope. This is the structural pin that catches
    // refactor drift on the PK name.
    expect(mockCallerAttributeFindUnique).toHaveBeenCalledWith({
      where: {
        callerId_key_scope: {
          callerId: "caller-bertie",
          key: "behavior_profile:supervision:tutor_fidelity",
          scope: "BEH-AGG-001",
        },
      },
      select: { stringValue: true },
    });
  });

  it("ROUND-TRIP: CallerAttribute(tutor_fidelity=low) → CallerTarget(BEH-DEFINITION-PRECISION).targetValue increased by 0.10", async () => {
    mockAnalysisSpecFindMany.mockResolvedValue([
      ADAPT_BEH_001_SUPERVISION_TUTOR_FIDELITY_SPEC,
    ]);
    mockCallerAttributeFindUnique.mockResolvedValue({ stringValue: "low" });
    // No prior target — current value defaults to 0.5 in the runner.
    mockCallerTargetFindUnique.mockResolvedValue(null);

    const result = await runAdaptSpecs("caller-bertie");

    expect(result.rulesFired).toBe(1);
    expect(result.targetsCreated).toBe(1);
    expect(mockCallerTargetUpsert).toHaveBeenCalledTimes(1);

    const upsertCall = mockCallerTargetUpsert.mock.calls[0][0];
    expect(upsertCall.where.callerId_parameterId).toEqual({
      callerId: "caller-bertie",
      parameterId: "BEH-DEFINITION-PRECISION",
    });
    // 0.5 default + 0.10 delta = 0.6
    expect(upsertCall.update.targetValue).toBeCloseTo(0.6, 5);
    expect(upsertCall.create.targetValue).toBeCloseTo(0.6, 5);
    // Confidence wired from spec-level defaultAdaptConfidence.
    expect(upsertCall.create.confidence).toBe(0.75);
  });

  it("ROUND-TRIP: CallerAttribute(call_frequency_fidelity=drift) → CallerTarget(BEH-ENGAGEMENT).targetValue SET to 0.8", async () => {
    mockAnalysisSpecFindMany.mockResolvedValue([
      ADAPT_BEH_001_ENGAGEMENT_DRIFT_SPEC,
    ]);
    mockCallerAttributeFindUnique.mockResolvedValue({ stringValue: "drift" });
    mockCallerTargetFindUnique.mockResolvedValue({ targetValue: 0.4 });

    const result = await runAdaptSpecs("caller-bertie");

    expect(result.rulesFired).toBe(1);
    const upsertCall = mockCallerTargetUpsert.mock.calls[0][0];
    expect(upsertCall.update.targetValue).toBe(0.8);
    expect(upsertCall.update.confidence).toBe(0.75);
  });

  it("NULL CallerAttribute (AGGREGATE not yet met minimumObservations) → rule silently skips, no CallerTarget write", async () => {
    mockAnalysisSpecFindMany.mockResolvedValue([
      ADAPT_BEH_001_SUPERVISION_TUTOR_FIDELITY_SPEC,
    ]);
    mockCallerAttributeFindUnique.mockResolvedValue(null);

    const result = await runAdaptSpecs("caller-bertie");

    expect(result.rulesFired).toBe(0);
    expect(result.targetsCreated).toBe(0);
    expect(result.targetsUpdated).toBe(0);
    expect(mockCallerTargetUpsert).not.toHaveBeenCalled();
  });

  it("Non-matching CallerAttribute value (e.g. 'high' when rule fires on 'low') → no write", async () => {
    mockAnalysisSpecFindMany.mockResolvedValue([
      ADAPT_BEH_001_SUPERVISION_TUTOR_FIDELITY_SPEC,
    ]);
    mockCallerAttributeFindUnique.mockResolvedValue({ stringValue: "high" });

    const result = await runAdaptSpecs("caller-bertie");

    expect(result.rulesFired).toBe(0);
    expect(mockCallerTargetUpsert).not.toHaveBeenCalled();
  });

  it("Spec-supplied scope override (not the default) is honoured", async () => {
    const specWithCustomScope = {
      slug: "ADAPT-OTHER",
      outputType: "ADAPT",
      isActive: true,
      config: {
        defaultAdaptConfidence: 0.7,
        parameters: [
          {
            id: "custom_scope_rule",
            config: {
              adaptationRules: [
                {
                  condition: {
                    profileKey: "behavior_profile:something:else",
                    operator: "eq",
                    value: "yes",
                    dataSource: "callerAttribute",
                    scope: "DISC-AGG-001",
                  },
                  actions: [
                    {
                      targetParameter: "BEH-WARMTH",
                      adjustment: "increase",
                      delta: 0.05,
                      rationale: "test",
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    };
    mockAnalysisSpecFindMany.mockResolvedValue([specWithCustomScope]);
    mockCallerAttributeFindUnique.mockResolvedValue({ stringValue: "yes" });

    await runAdaptSpecs("caller-bertie");

    expect(mockCallerAttributeFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          callerId_key_scope: {
            callerId: "caller-bertie",
            key: "behavior_profile:something:else",
            scope: "DISC-AGG-001",
          },
        },
      }),
    );
  });

  it("Spec missing scope (older spec) defaults to BEH-AGG-001", async () => {
    const specWithoutScope = {
      slug: "ADAPT-OLD",
      outputType: "ADAPT",
      isActive: true,
      config: {
        parameters: [
          {
            id: "no_scope_rule",
            config: {
              adaptationRules: [
                {
                  condition: {
                    profileKey: "behavior_profile:companion:engagement_level",
                    operator: "eq",
                    value: "low",
                    dataSource: "callerAttribute",
                    // no scope — defaults
                  },
                  actions: [
                    {
                      targetParameter: "BEH-ENGAGEMENT",
                      adjustment: "increase",
                      delta: 0.1,
                      rationale: "test",
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    };
    mockAnalysisSpecFindMany.mockResolvedValue([specWithoutScope]);
    mockCallerAttributeFindUnique.mockResolvedValue({ stringValue: "low" });

    await runAdaptSpecs("caller-bertie");

    expect(mockCallerAttributeFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          callerId_key_scope: expect.objectContaining({ scope: "BEH-AGG-001" }),
        },
      }),
    );
  });
});

// ────────────────────────────────────────────────────────────
// Back-compat — existing dataSource branches are not regressed
// ────────────────────────────────────────────────────────────

describe("runAdaptSpecs — back-compat", () => {
  it("parameterValues dataSource still works (ADAPT-PERS-001 path unchanged)", async () => {
    const persSpec = {
      slug: "ADAPT-PERS-001",
      outputType: "ADAPT",
      isActive: true,
      config: {
        defaultAdaptConfidence: 0.7,
        parameters: [
          {
            id: "openness_adaptation",
            config: {
              adaptationRules: [
                {
                  condition: {
                    profileKey: "B5-O",
                    operator: "gt",
                    threshold: 0.65,
                    dataSource: "parameterValues",
                  },
                  actions: [
                    {
                      targetParameter: "BEH-WARMTH",
                      adjustment: "set",
                      value: 0.8,
                      rationale: "high openness",
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    };
    mockAnalysisSpecFindMany.mockResolvedValue([persSpec]);
    mockCallerPersonalityProfileFindUnique.mockResolvedValue({
      parameterValues: { "B5-O": 0.8 },
    });

    const result = await runAdaptSpecs("caller-bertie");

    expect(result.rulesFired).toBe(1);
    // CRITICAL: the callerAttribute branch must NOT fire for parameterValues
    // rules. If it did, parameterValues semantics would silently flip to
    // string lookup.
    expect(mockCallerAttributeFindUnique).not.toHaveBeenCalled();
    const upsertCall = mockCallerTargetUpsert.mock.calls[0][0];
    expect(upsertCall.update.targetValue).toBe(0.8);
  });
});

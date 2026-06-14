/**
 * writer-completeness-invariant.test.ts (#1620 + #1621 / Epic #1618)
 *
 * Pins the I-WC1 per-call writer-completeness invariant. The check
 * iterates `WRITER_REGISTRY` entries with `expectedTrigger: "per-call"`
 * and verifies each field is populated on this call's row.
 *
 * Three categories of result:
 *   - populated = true                      → no alarm
 *   - populated = false, skipReason !== null → silenced (by-design absence)
 *   - populated = false, skipReason === null → ALARM (I-WC1 violation)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const logSpy = vi.fn();
vi.mock("@/lib/logger", () => ({ log: (...args: unknown[]) => logSpy(...args) }));

// Prisma method mocks — overwrite per-test as needed.
const mockBehaviorMeasurementCount = vi.fn();
const mockRewardScoreFindFirst = vi.fn();
const mockGoalCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    behaviorMeasurement: {
      count: (...args: unknown[]) => mockBehaviorMeasurementCount(...args),
    },
    rewardScore: {
      findFirst: (...args: unknown[]) => mockRewardScoreFindFirst(...args),
    },
    goal: {
      count: (...args: unknown[]) => mockGoalCount(...args),
    },
  },
}));

import {
  checkWriterCompletenessAfterPipeline,
  I_WC1_STAGE,
} from "@/lib/pipeline/writer-completeness-invariant";

const ARGS_STRUCTURED = {
  callId: "call-A",
  callerId: "caller-1",
  playbookId: "pb-1",
  courseStyle: "structured" as const,
  engine: "claude",
};

const ARGS_CONTINUOUS = { ...ARGS_STRUCTURED, courseStyle: "continuous" as const };
const ARGS_MOCK = { ...ARGS_STRUCTURED, engine: "mock" };

describe("I-WC1 writer-completeness per-call invariant", () => {
  beforeEach(() => {
    logSpy.mockClear();
    mockBehaviorMeasurementCount.mockReset();
    mockRewardScoreFindFirst.mockReset();
    mockGoalCount.mockReset();
  });

  it("returns one finding per per-call registry entry", async () => {
    mockBehaviorMeasurementCount.mockResolvedValue(0); // no rows → skipReason
    mockRewardScoreFindFirst.mockResolvedValue(null);  // no row → skipReason
    mockGoalCount.mockResolvedValue(0); // no goals → skipReason
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_STRUCTURED);
    expect(findings.length).toBeGreaterThanOrEqual(4);
    const fields = findings.map((f) => f.field);
    expect(fields).toContain("BehaviorMeasurement.evidence");
    expect(fields).toContain("RewardScore.targetUpdatesApplied");
    expect(fields).toContain("Goal.progressMetrics");
    expect(fields).toContain("RewardScore.effectiveTargets");
  });

  it("BehaviorMeasurement.evidence — populated when at least one row has non-empty evidence", async () => {
    // First call: total count. Second call: count with evidence non-empty.
    mockBehaviorMeasurementCount
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3);
    mockRewardScoreFindFirst.mockResolvedValue(null);
    mockGoalCount.mockResolvedValue(0);
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_STRUCTURED);
    const evidence = findings.find((f) => f.field === "BehaviorMeasurement.evidence");
    expect(evidence?.populated).toBe(true);
    expect(evidence?.skipReason).toBeNull();
  });

  it("BehaviorMeasurement.evidence — FIRES alarm when all rows have empty evidence", async () => {
    mockBehaviorMeasurementCount
      .mockResolvedValueOnce(5) // total rows
      .mockResolvedValueOnce(0); // rows with non-empty evidence
    mockRewardScoreFindFirst.mockResolvedValue(null);
    mockGoalCount.mockResolvedValue(0);
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_STRUCTURED);
    const evidence = findings.find((f) => f.field === "BehaviorMeasurement.evidence");
    expect(evidence?.populated).toBe(false);
    expect(evidence?.skipReason).toBeNull();
    // Should have emitted an AppLog row with the I-WC1 subject.
    const wc1Calls = logSpy.mock.calls.filter((c) => c[1] === I_WC1_STAGE);
    expect(wc1Calls.some((c) => c[2].field === "BehaviorMeasurement.evidence")).toBe(true);
  });

  it("BehaviorMeasurement.evidence — skipped on mock engine", async () => {
    mockBehaviorMeasurementCount.mockResolvedValue(5);
    mockRewardScoreFindFirst.mockResolvedValue(null);
    mockGoalCount.mockResolvedValue(0);
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_MOCK);
    const evidence = findings.find((f) => f.field === "BehaviorMeasurement.evidence");
    expect(evidence?.populated).toBe(true);
    expect(evidence?.skipReason).toContain("mock engine");
  });

  it("RewardScore writers — skipped on continuous courses", async () => {
    mockBehaviorMeasurementCount.mockResolvedValue(0);
    mockGoalCount.mockResolvedValue(0);
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_CONTINUOUS);
    const tua = findings.find((f) => f.field === "RewardScore.targetUpdatesApplied");
    const eff = findings.find((f) => f.field === "RewardScore.effectiveTargets");
    expect(tua?.skipReason).toContain("continuous course");
    expect(eff?.skipReason).toContain("continuous course");
  });

  it("RewardScore.targetUpdatesApplied — populated when not NULL on the row", async () => {
    mockBehaviorMeasurementCount.mockResolvedValue(0);
    mockRewardScoreFindFirst.mockResolvedValueOnce({ targetUpdatesApplied: [] });
    mockGoalCount.mockResolvedValue(0);
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_STRUCTURED);
    const tua = findings.find((f) => f.field === "RewardScore.targetUpdatesApplied");
    expect(tua?.populated).toBe(true);
  });

  it("RewardScore.targetUpdatesApplied — FIRES alarm when NULL on the row", async () => {
    mockBehaviorMeasurementCount.mockResolvedValue(0);
    mockRewardScoreFindFirst.mockResolvedValueOnce({ targetUpdatesApplied: null });
    mockGoalCount.mockResolvedValue(0);
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_STRUCTURED);
    const tua = findings.find((f) => f.field === "RewardScore.targetUpdatesApplied");
    expect(tua?.populated).toBe(false);
    expect(tua?.skipReason).toBeNull();
  });

  it("Goal.progressMetrics — skipped when caller has no active goals", async () => {
    mockBehaviorMeasurementCount.mockResolvedValue(0);
    mockRewardScoreFindFirst.mockResolvedValue(null);
    mockGoalCount.mockResolvedValueOnce(0); // total ACTIVE/PAUSED goals
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_STRUCTURED);
    const trail = findings.find((f) => f.field === "Goal.progressMetrics");
    expect(trail?.populated).toBe(true);
    expect(trail?.skipReason).toContain("no ACTIVE / PAUSED goals");
  });

  it("Goal.progressMetrics — populated when at least one goal references this call", async () => {
    mockBehaviorMeasurementCount.mockResolvedValue(0);
    mockRewardScoreFindFirst.mockResolvedValue(null);
    mockGoalCount
      .mockResolvedValueOnce(5)  // total ACTIVE/PAUSED goals
      .mockResolvedValueOnce(2); // goals referencing this call
    const findings = await checkWriterCompletenessAfterPipeline(ARGS_STRUCTURED);
    const trail = findings.find((f) => f.field === "Goal.progressMetrics");
    expect(trail?.populated).toBe(true);
  });

  it("emits an AppLog row only for non-skipped non-populated findings", async () => {
    // All four fields are either populated or skipped → zero alarms.
    mockBehaviorMeasurementCount.mockResolvedValue(0); // no rows → skip
    mockRewardScoreFindFirst.mockResolvedValue(null);  // no row → skip
    mockGoalCount.mockResolvedValue(0);                // no goals → skip
    await checkWriterCompletenessAfterPipeline(ARGS_STRUCTURED);
    const wc1Calls = logSpy.mock.calls.filter((c) => c[1] === I_WC1_STAGE);
    expect(wc1Calls).toHaveLength(0);
  });
});

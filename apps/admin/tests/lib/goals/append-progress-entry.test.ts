/**
 * append-progress-entry.test.ts (#1614)
 *
 * Pins the canonical `Goal.progressMetrics` writer-extension. The
 * pre-fix gap was structural — `trackGoalProgress` incremented
 * `Goal.progress` (the scalar) but never touched `progressMetrics`,
 * so the Attainment tab's evidence trail rendered "First noticed N
 * days ago" indefinitely. This file pins the new contract:
 *
 *   - bootstrapping NULL → `{}` when the goal was programmatically
 *     created (1,000 rows on hf-dev sandbox pre-fix)
 *   - appending evidence to the existing `evidence[]` shape — same
 *     contract `extract-goals.ts` writes and `buildGoalTrail` reads
 *   - preserving extraction metadata (extractionMethod, confidence,
 *     sourceCallId, extractedAt, original evidence[]) on every write
 *   - idempotent on (currentMetrics, callId) so pipeline retry
 *     against the same call doesn't double-count
 *   - cap on evidence[] to keep the JSON column bounded
 */
import { describe, it, expect } from "vitest";
import {
  appendGoalProgressEntry,
  DEFAULT_EVIDENCE_CAP,
  type GoalProgressMetricsShape,
  type NewProgressEntry,
} from "@/lib/goals/append-progress-entry";
import { StrategyKey } from "@/lib/goals/strategies/types";

const ENTRY_BASE: NewProgressEntry = {
  callId: "call-A",
  at: "2026-06-14T12:00:00.000Z",
  evidence: "I think it depends on the situation",
  sourceStrategy: StrategyKey.skill_ema,
};

describe("appendGoalProgressEntry", () => {
  it("bootstraps progressMetrics from null with a single evidence entry", () => {
    // Repairs the 1,000-row pre-fix gap (NULL progressMetrics).
    const result = appendGoalProgressEntry(null, ENTRY_BASE);
    expect(result.evidence).toEqual(["I think it depends on the situation"]);
    expect(result.mentionCount).toBe(1);
    expect(result.lastMentionedCallId).toBe("call-A");
    expect(result.lastMentionedAt).toBe("2026-06-14T12:00:00.000Z");
    expect(result.lastStrategy).toBe("skill_ema");
  });

  it("bootstraps progressMetrics from undefined (treats same as null)", () => {
    const result = appendGoalProgressEntry(undefined, ENTRY_BASE);
    expect(result.evidence).toEqual(["I think it depends on the situation"]);
    expect(result.mentionCount).toBe(1);
  });

  it("preserves extraction metadata when extending the trail", () => {
    // Repairs the 113-row pre-fix gap (frozen extraction metadata).
    const extracted: GoalProgressMetricsShape = {
      extractionMethod: "EXPLICIT",
      confidence: 0.9,
      evidence: ["original quote at extraction"],
      sourceCallId: "call-original",
      extractedAt: "2026-06-01T10:00:00.000Z",
    };
    const result = appendGoalProgressEntry(extracted, ENTRY_BASE);
    expect(result.extractionMethod).toBe("EXPLICIT");
    expect(result.confidence).toBe(0.9);
    expect(result.sourceCallId).toBe("call-original");
    expect(result.extractedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(result.evidence).toEqual([
      "original quote at extraction",
      "I think it depends on the situation",
    ]);
    expect(result.mentionCount).toBe(1);
  });

  it("increments mentionCount across distinct calls", () => {
    let metrics: GoalProgressMetricsShape = appendGoalProgressEntry(null, ENTRY_BASE);
    metrics = appendGoalProgressEntry(metrics, {
      ...ENTRY_BASE,
      callId: "call-B",
      at: "2026-06-14T13:00:00.000Z",
      evidence: "Like for example when I was younger",
    });
    metrics = appendGoalProgressEntry(metrics, {
      ...ENTRY_BASE,
      callId: "call-C",
      at: "2026-06-14T14:00:00.000Z",
      evidence: "So basically I think",
    });
    expect(metrics.mentionCount).toBe(3);
    expect(metrics.evidence).toEqual([
      "I think it depends on the situation",
      "Like for example when I was younger",
      "So basically I think",
    ]);
    expect(metrics.lastMentionedCallId).toBe("call-C");
    expect(metrics.lastMentionedAt).toBe("2026-06-14T14:00:00.000Z");
  });

  it("is idempotent on pipeline retry against the same callId", () => {
    let metrics = appendGoalProgressEntry(null, ENTRY_BASE);
    // Pipeline retry — same callId, possibly different evidence string.
    metrics = appendGoalProgressEntry(metrics, {
      ...ENTRY_BASE,
      evidence: "I think it depends on the situation (retry)",
    });
    metrics = appendGoalProgressEntry(metrics, {
      ...ENTRY_BASE,
      evidence: "I think it depends on the situation (retry 2)",
    });
    // mentionCount stays at 1 — three writes against the same callId.
    expect(metrics.mentionCount).toBe(1);
    // Latest evidence wins (replays in place).
    expect(metrics.evidence).toEqual([
      "I think it depends on the situation (retry 2)",
    ]);
  });

  it("handles strategies that emit no evidence string", () => {
    // lo_rollup typically rolls up per-LO mastery without a quote.
    const result = appendGoalProgressEntry(null, {
      callId: "call-D",
      at: "2026-06-14T15:00:00.000Z",
      sourceStrategy: StrategyKey.lo_rollup,
      // evidence: undefined
    });
    expect(result.evidence).toEqual([]);
    expect(result.mentionCount).toBe(1);
    expect(result.lastMentionedCallId).toBe("call-D");
    expect(result.lastStrategy).toBe("lo_rollup");
  });

  it("caps the evidence array at DEFAULT_EVIDENCE_CAP entries", () => {
    let metrics: GoalProgressMetricsShape = {};
    for (let i = 0; i < DEFAULT_EVIDENCE_CAP + 5; i++) {
      metrics = appendGoalProgressEntry(metrics, {
        callId: `call-${i}`,
        at: `2026-06-14T${String(12 + (i % 12)).padStart(2, "0")}:00:00.000Z`,
        evidence: `quote ${i}`,
        sourceStrategy: StrategyKey.skill_ema,
      });
    }
    expect(metrics.evidence?.length).toBe(DEFAULT_EVIDENCE_CAP);
    // Oldest entries rolled off the front.
    expect(metrics.evidence?.[0]).toBe("quote 5");
    expect(metrics.evidence?.[DEFAULT_EVIDENCE_CAP - 1]).toBe(`quote ${DEFAULT_EVIDENCE_CAP + 4}`);
    // mentionCount tracks ALL invocations, not just the cap.
    expect(metrics.mentionCount).toBe(DEFAULT_EVIDENCE_CAP + 5);
  });

  it("respects custom cap parameter", () => {
    let metrics: GoalProgressMetricsShape = {};
    for (let i = 0; i < 7; i++) {
      metrics = appendGoalProgressEntry(
        metrics,
        {
          callId: `call-${i}`,
          at: `2026-06-14T${String(12 + i).padStart(2, "0")}:00:00.000Z`,
          evidence: `quote ${i}`,
          sourceStrategy: StrategyKey.skill_ema,
        },
        3,
      );
    }
    expect(metrics.evidence).toEqual(["quote 4", "quote 5", "quote 6"]);
  });

  it("does not duplicate the same evidence string when called twice with identical input", () => {
    const first = appendGoalProgressEntry(null, ENTRY_BASE);
    const second = appendGoalProgressEntry(first, ENTRY_BASE);
    expect(second.evidence).toEqual(["I think it depends on the situation"]);
    expect(second.mentionCount).toBe(1);
  });
});

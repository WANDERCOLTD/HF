/**
 * #1870 — Segmented PROSODY consumer.
 *
 * Defends:
 *   - `bySegment` envelope with 3 phases → 3×4 IELTS CallScore rows
 *     written with `segmentKey = "phase:<phaseKey>"` (per #1872 Option 2
 *     namespace decision) + 4 aggregate rows with `segmentKey = null`
 *   - Whole-call envelope (no bySegment) → existing behaviour unchanged
 *     (4 IELTS rows, segmentKey null)
 *   - Per-phase "unavailable" entries skipped silently — no row written
 *
 * Sibling: `prosody-consumer.test.ts` pins the parameter-routing
 * contract for the whole-call branch. This file covers the new
 * `bySegment` branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VoiceProsodyFeatures } from "@/lib/pipeline/prosody-types";
import { withPhaseNamespace } from "@/lib/pipeline/segment-key-namespace";

const { mockPrisma, mockWriteCallScore } = vi.hoisted(() => ({
  mockPrisma: {
    call: { findUnique: vi.fn() },
  },
  mockWriteCallScore: vi.fn().mockResolvedValue({ id: "cs-1", created: true }),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/measurement/write-call-score", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/measurement/write-call-score")
  >("@/lib/measurement/write-call-score");
  return {
    ...actual,
    writeCallScore: (...args: unknown[]) => mockWriteCallScore(...args),
  };
});

describe("prosody-consumer — bySegment branch (#1870)", () => {
  let applyProsodyContractToAggregate: typeof import("@/lib/pipeline/prosody-consumer").applyProsodyContractToAggregate;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/lib/pipeline/prosody-consumer");
    applyProsodyContractToAggregate = mod.applyProsodyContractToAggregate;
  });

  it("3-phase IELTS envelope writes 3×4 per-phase + 4 aggregate rows; all carry phase: prefix or null", async () => {
    const envelope: VoiceProsodyFeatures = {
      mode: "ielts",
      ieltsScores: {
        overall: 7,
        pronunciation: 7,
        fluencyCoherence: 7,
        lexicalResource: 7,
        grammaticalRange: 7,
      },
      bySegment: {
        "phase:p1": {
          mode: "ielts",
          ieltsScores: {
            overall: 6,
            pronunciation: 6,
            fluencyCoherence: 6,
            lexicalResource: 6,
            grammaticalRange: 6,
          },
        },
        "phase:p2_monologue": {
          mode: "ielts",
          ieltsScores: {
            overall: 7,
            pronunciation: 7,
            fluencyCoherence: 7,
            lexicalResource: 7,
            grammaticalRange: 7,
          },
        },
        "phase:p3": {
          mode: "ielts",
          ieltsScores: {
            overall: 8,
            pronunciation: 8,
            fluencyCoherence: 8,
            lexicalResource: 8,
            grammaticalRange: 8,
          },
        },
      },
    };
    mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

    const result = await applyProsodyContractToAggregate("call-1", "caller-1");

    // 3 phases × 4 criteria + 4 aggregate criteria = 16 writes
    expect(result.applied).toBe(true);
    expect(result.mode).toBe("ielts");
    expect(result.scoresWritten).toBe(16);

    const segmentKeys = mockWriteCallScore.mock.calls.map(
      (c) => (c[0] as { segmentKey?: string | null }).segmentKey,
    );
    // 12 rows carry namespaced phase keys — derived via the canonical
    // helper, not hardcoded, so a future namespace change reaches both
    // sides of the assertion atomically (#1872 NO HARDCODING contract).
    expect(segmentKeys.filter((k) => k === withPhaseNamespace("p1")).length).toBe(4);
    expect(segmentKeys.filter((k) => k === withPhaseNamespace("p2_monologue")).length).toBe(4);
    expect(segmentKeys.filter((k) => k === withPhaseNamespace("p3")).length).toBe(4);
    // 4 aggregate rows carry segmentKey null
    expect(segmentKeys.filter((k) => k === null).length).toBe(4);
    // No bare phase names — these would collide with the text segmenter's
    // "part1"/"part2"/"part3" namespace per #1872.
    expect(segmentKeys.some((k) => k === "p1" || k === "p2_monologue" || k === "p3")).toBe(
      false,
    );
  });

  it("3-phase general envelope writes 3×2 per-phase + 2 aggregate rows", async () => {
    const phase = (paceWpm: number, hesitationRate: number) => ({
      mode: "general" as const,
      generalSignals: {
        paceWpm,
        hesitationRate,
        meanEnergyDb: 0,
        pitchRangeHz: 0,
        confidenceProxy: 0.5,
      },
    });
    const envelope: VoiceProsodyFeatures = {
      mode: "general",
      generalSignals: {
        paceWpm: 130,
        hesitationRate: 0.2,
        meanEnergyDb: 0,
        pitchRangeHz: 0,
        confidenceProxy: 0.5,
      },
      bySegment: {
        "phase:intro": phase(110, 0.3),
        "phase:main": phase(130, 0.2),
        "phase:wrap": phase(150, 0.1),
      },
    };
    mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

    const result = await applyProsodyContractToAggregate("call-1", "caller-1");

    // 3 phases × 2 signals + 2 aggregate signals = 8 writes
    expect(result.scoresWritten).toBe(8);
    const paramIds = mockWriteCallScore.mock.calls.map(
      (c) => (c[0] as { parameterId: string }).parameterId,
    );
    expect(paramIds).toContain("prosody_pace_wpm");
    expect(paramIds).toContain("prosody_hesitation_rate");
    // Per-phase keys present
    const segmentKeys = mockWriteCallScore.mock.calls.map(
      (c) => (c[0] as { segmentKey?: string | null }).segmentKey,
    );
    expect(segmentKeys).toContain(withPhaseNamespace("intro"));
    expect(segmentKeys).toContain(withPhaseNamespace("main"));
    expect(segmentKeys).toContain(withPhaseNamespace("wrap"));
  });

  it("per-phase 'unavailable' entries are skipped (no row written for that phase)", async () => {
    const envelope: VoiceProsodyFeatures = {
      mode: "ielts",
      ieltsScores: {
        overall: 7,
        pronunciation: 7,
        fluencyCoherence: 7,
        lexicalResource: 7,
        grammaticalRange: 7,
      },
      bySegment: {
        "phase:p1": {
          mode: "ielts",
          ieltsScores: {
            overall: 6,
            pronunciation: 6,
            fluencyCoherence: 6,
            lexicalResource: 6,
            grammaticalRange: 6,
          },
        },
        "phase:p2_monologue": {
          mode: "unavailable",
          errorReason: "vendor_error",
        },
        "phase:p3": {
          mode: "ielts",
          ieltsScores: {
            overall: 8,
            pronunciation: 8,
            fluencyCoherence: 8,
            lexicalResource: 8,
            grammaticalRange: 8,
          },
        },
      },
    };
    mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

    const result = await applyProsodyContractToAggregate("call-1", "caller-1");

    // 2 ielts phases × 4 + 4 aggregate = 12
    expect(result.scoresWritten).toBe(12);
    const segmentKeys = mockWriteCallScore.mock.calls.map(
      (c) => (c[0] as { segmentKey?: string | null }).segmentKey,
    );
    expect(segmentKeys.filter((k) => k === withPhaseNamespace("p2_monologue")).length).toBe(0);
  });

  it("no bySegment → existing whole-call behaviour unchanged (4 IELTS rows, no segmentKey)", async () => {
    const envelope: VoiceProsodyFeatures = {
      mode: "ielts",
      ieltsScores: {
        overall: 7,
        pronunciation: 7,
        fluencyCoherence: 7,
        lexicalResource: 7,
        grammaticalRange: 7,
      },
    };
    mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

    const result = await applyProsodyContractToAggregate("call-1", "caller-1");

    expect(result.scoresWritten).toBe(4);
    const segmentKeys = mockWriteCallScore.mock.calls.map(
      (c) => (c[0] as { segmentKey?: string | null }).segmentKey,
    );
    // Whole-call rows MUST carry segmentKey null (pinned — adding a
    // phase-prefix here would break backwards-compat with non-Mock
    // readers).
    expect(segmentKeys.every((k) => k === null)).toBe(true);
  });

  it("top-level 'unavailable' WITH bySegment populated still iterates per-phase writes", async () => {
    // Every phase failed but bySegment captured the failures for forensics.
    const envelope: VoiceProsodyFeatures = {
      mode: "unavailable",
      errorReason: "vendor_error",
      bySegment: {
        "phase:p1": { mode: "unavailable", errorReason: "vendor_error" },
        "phase:p2": { mode: "unavailable", errorReason: "vendor_timeout" },
      },
    };
    mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

    const result = await applyProsodyContractToAggregate("call-1", "caller-1");

    // Both phases unavailable → no per-phase rows; no aggregate (top-level
    // also unavailable). applied=true because the segmented branch was
    // entered.
    expect(result.scoresWritten).toBe(0);
    expect(mockWriteCallScore).not.toHaveBeenCalled();
  });
});

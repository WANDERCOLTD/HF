/**
 * Prosody consumer — parameter routing.
 *
 * Pins the canonical writer→param-slot mapping enforced by
 * `lib/pipeline/prosody-consumer.ts::GENERAL_PARAM_IDS` and
 * `IELTS_PARAM_IDS`. If a future refactor changes the constant values,
 * this bank fails before reaching hf_sandbox.
 *
 * Why this matters (2026-06-15 audit):
 *   Pre-split, `GENERAL_PARAM_IDS` pointed at `CONV_PACE` /
 *   `pace_indicators` — also written by EXTRACT from AI transcript
 *   analysis. With `writeCallScore`'s `(callId, parameterId, moduleId)`
 *   idempotency, the AGGREGATE prosody consumer ran AFTER EXTRACT and
 *   overwrote the AI-judged values with vendor-derived ones (today:
 *   hardcoded zeros). This test pins the split that keeps both writers'
 *   surfaces alive.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VoiceProsodyFeatures } from "@/lib/pipeline/prosody-types";

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

describe("prosody-consumer — parameter slot routing", () => {
  let applyProsodyContractToAggregate: typeof import("@/lib/pipeline/prosody-consumer").applyProsodyContractToAggregate;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/lib/pipeline/prosody-consumer");
    applyProsodyContractToAggregate = mod.applyProsodyContractToAggregate;
  });

  describe("general mode — split slots, not CONV_PACE / pace_indicators", () => {
    it("writes paceWpm to the dedicated `prosody_pace_wpm` slot", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "general",
        generalSignals: {
          paceWpm: 130,
          hesitationRate: 0.2,
          meanEnergyDb: 0,
          pitchRangeHz: 0,
          confidenceProxy: 0.5,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      const result = await applyProsodyContractToAggregate("call-1", "caller-1");

      expect(result.applied).toBe(true);
      expect(result.mode).toBe("general");
      expect(result.scoresWritten).toBe(2);

      const paramIds = mockWriteCallScore.mock.calls.map(
        (c) => (c[0] as { parameterId: string }).parameterId,
      );
      expect(paramIds).toContain("prosody_pace_wpm");
      expect(paramIds).toContain("prosody_hesitation_rate");
      // Pre-split slots MUST NOT be written by the consumer — they belong to
      // EXTRACT (AI-judged from transcript). Overwriting them was the 2026-06-15
      // fingerprint.
      expect(paramIds).not.toContain("CONV_PACE");
      expect(paramIds).not.toContain("pace_indicators");
    });

    it("normalises paceWpm 60–200 → 0–1 linearly (130 WPM → 0.5)", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "general",
        generalSignals: {
          paceWpm: 130,
          hesitationRate: 0,
          meanEnergyDb: 0,
          pitchRangeHz: 0,
          confidenceProxy: 0,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      await applyProsodyContractToAggregate("call-1", "caller-1");

      const paceCall = mockWriteCallScore.mock.calls.find(
        (c) => (c[0] as { parameterId: string }).parameterId === "prosody_pace_wpm",
      );
      expect(paceCall).toBeDefined();
      expect((paceCall![0] as { score: number }).score).toBeCloseTo(0.5, 5);
    });

    it("inverts hesitationRate (0.2 → 0.8 — lower hesitation, higher score)", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "general",
        generalSignals: {
          paceWpm: 100,
          hesitationRate: 0.2,
          meanEnergyDb: 0,
          pitchRangeHz: 0,
          confidenceProxy: 0,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      await applyProsodyContractToAggregate("call-1", "caller-1");

      const hesCall = mockWriteCallScore.mock.calls.find(
        (c) => (c[0] as { parameterId: string }).parameterId === "prosody_hesitation_rate",
      );
      expect(hesCall).toBeDefined();
      expect((hesCall![0] as { score: number }).score).toBeCloseTo(0.8, 5);
    });

    it("hardcoded-zero signals still write to prosody_* slots (not CONV_PACE) — isolates the pollution", async () => {
      // Mirrors the current vendor adapter state at prosody-runner.ts:367-373
      // where paceWpm + hesitationRate are hardcoded to 0 until the SpeechAce /
      // SpeechSuper adapter exposes them. The zeros land on prosody_* slots,
      // NOT on CONV_PACE — that's the entire point of the split.
      const envelope: VoiceProsodyFeatures = {
        mode: "general",
        generalSignals: {
          paceWpm: 0,
          hesitationRate: 0,
          meanEnergyDb: 0,
          pitchRangeHz: 0,
          confidenceProxy: 0,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      await applyProsodyContractToAggregate("call-1", "caller-1");

      const paramIds = mockWriteCallScore.mock.calls.map(
        (c) => (c[0] as { parameterId: string }).parameterId,
      );
      expect(paramIds).toEqual(
        expect.arrayContaining(["prosody_pace_wpm", "prosody_hesitation_rate"]),
      );
      expect(paramIds).not.toContain("CONV_PACE");
      expect(paramIds).not.toContain("pace_indicators");
    });
  });

  describe("IELTS mode — 4 skill_* slots untouched by the split", () => {
    it("writes the 4 IELTS skill CallScore rows", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "ielts",
        ieltsScores: {
          fluencyCoherence: 7,
          pronunciation: 6.5,
          lexicalResource: 7.5,
          grammaticalRange: 6,
          overall: 7,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      const result = await applyProsodyContractToAggregate("call-1", "caller-1");

      expect(result.applied).toBe(true);
      expect(result.mode).toBe("ielts");
      expect(result.scoresWritten).toBe(4);

      const paramIds = mockWriteCallScore.mock.calls.map(
        (c) => (c[0] as { parameterId: string }).parameterId,
      );
      expect(paramIds).toEqual(
        expect.arrayContaining([
          "skill_fluency_and_coherence_fc",
          "skill_pronunciation_p",
          "skill_lexical_resource_lr",
          "skill_grammatical_range_and_accuracy_gra",
        ]),
      );
    });
  });

  describe("no-op modes", () => {
    it("returns applied=false when voiceProsody envelope is missing", async () => {
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: null });
      const result = await applyProsodyContractToAggregate("call-1", "caller-1");
      expect(result.applied).toBe(false);
      expect(result.mode).toBe("missing");
      expect(mockWriteCallScore).not.toHaveBeenCalled();
    });

    it("returns applied=false when mode is 'unavailable'", async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        voiceProsody: { mode: "unavailable", errorReason: "no_provider_configured" },
      });
      const result = await applyProsodyContractToAggregate("call-1", "caller-1");
      expect(result.applied).toBe(false);
      expect(result.mode).toBe("unavailable");
      expect(mockWriteCallScore).not.toHaveBeenCalled();
    });
  });
});

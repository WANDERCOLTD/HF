/**
 * Prosody consumer — parameter routing.
 *
 * Pins the canonical writer→param-slot mapping enforced by
 * `lib/pipeline/prosody-consumer.ts::GENERAL_PARAM_IDS` and
 * `PROSODY_RAW_PARAM_IDS`. If a future refactor changes the constant
 * values, this bank fails before reaching hf_sandbox.
 *
 * Why this matters (2026-06-15 audit + #2138 refactor):
 *
 *   GENERAL mode (2026-06-15):
 *     Pre-split, `GENERAL_PARAM_IDS` pointed at `CONV_PACE` /
 *     `pace_indicators` — also written by EXTRACT from AI transcript
 *     analysis. With `writeCallScore`'s `(callId, parameterId,
 *     moduleId)` idempotency, the AGGREGATE prosody consumer ran AFTER
 *     EXTRACT and overwrote the AI-judged values with vendor-derived
 *     ones (today: hardcoded zeros). This test pins the split that
 *     keeps both writers' surfaces alive.
 *
 *   IELTS mode (#2138, epic #2135 S3):
 *     Pre-#2138, the IELTS-mode writer targeted the 4 IELTS skill
 *     parameter IDs (`skill_*`) directly. Those are now owned by the
 *     IELTS-MEASURE-001 LLM spec via the canonical SCORE_AGENT path
 *     (#2155). Prosody now writes its own `prosody_raw_*` namespace —
 *     no collision possible regardless of `HF_IELTS_LLM_MEASURE_V1`
 *     flag state. This test pins the new namespace AND the negative
 *     assertion that prosody NEVER writes the IELTS skill IDs.
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

  describe("#2138 — IELTS mode writes to prosody_raw_* slots (NEVER skill_*)", () => {
    it("writes the 4 prosody_raw_* CallScore rows", async () => {
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
      // Prosody-raw IDs land — vendor signal preserved without colliding
      // with the IELTS skill IDs owned by IELTS-MEASURE-001.
      expect(paramIds).toEqual(
        expect.arrayContaining([
          "prosody_raw_fc",
          "prosody_raw_p",
          "prosody_raw_lr",
          "prosody_raw_gra",
        ]),
      );
    });

    it("NEVER writes the 4 IELTS skill IDs — those are owned by IELTS-MEASURE-001 (#2155)", async () => {
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

      await applyProsodyContractToAggregate("call-1", "caller-1");

      const paramIds = mockWriteCallScore.mock.calls.map(
        (c) => (c[0] as { parameterId: string }).parameterId,
      );
      // The structural separation — prosody-consumer NEVER touches the
      // 4 IELTS skill IDs (regardless of HF_IELTS_LLM_MEASURE_V1 flag
      // state). The flag now controls only the LLM-judged path's
      // enablement; prosody-raw writes run unconditionally.
      expect(paramIds).not.toContain("skill_fluency_and_coherence_fc");
      expect(paramIds).not.toContain("skill_pronunciation_p");
      expect(paramIds).not.toContain("skill_lexical_resource_lr");
      expect(paramIds).not.toContain("skill_grammatical_range_and_accuracy_gra");
    });

    it("normalises band 0–9 → score 0–1 (band 7 → 0.778)", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "ielts",
        ieltsScores: {
          fluencyCoherence: 7,
          pronunciation: 0,
          lexicalResource: 0,
          grammaticalRange: 0,
          overall: 7,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      await applyProsodyContractToAggregate("call-1", "caller-1");

      const fcCall = mockWriteCallScore.mock.calls.find(
        (c) => (c[0] as { parameterId: string }).parameterId === "prosody_raw_fc",
      );
      expect(fcCall).toBeDefined();
      expect((fcCall![0] as { score: number }).score).toBeCloseTo(7 / 9, 5);
    });

    it("FC + P stamp confidence 0.9 (vendor's strong suit — audio fluency + phonemes)", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "ielts",
        ieltsScores: {
          fluencyCoherence: 7,
          pronunciation: 6.5,
          lexicalResource: 7,
          grammaticalRange: 6,
          overall: 7,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      await applyProsodyContractToAggregate("call-1", "caller-1");

      const fcCall = mockWriteCallScore.mock.calls.find(
        (c) => (c[0] as { parameterId: string }).parameterId === "prosody_raw_fc",
      );
      const pCall = mockWriteCallScore.mock.calls.find(
        (c) => (c[0] as { parameterId: string }).parameterId === "prosody_raw_p",
      );
      expect((fcCall![0] as { confidence: number }).confidence).toBe(0.9);
      expect((pCall![0] as { confidence: number }).confidence).toBe(0.9);
    });

    it("LR + GRA stamp confidence 0.7 (vendor cannot reliably score vocab/grammar from audio)", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "ielts",
        ieltsScores: {
          fluencyCoherence: 7,
          pronunciation: 6.5,
          lexicalResource: 7,
          grammaticalRange: 6,
          overall: 7,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      await applyProsodyContractToAggregate("call-1", "caller-1");

      const lrCall = mockWriteCallScore.mock.calls.find(
        (c) => (c[0] as { parameterId: string }).parameterId === "prosody_raw_lr",
      );
      const graCall = mockWriteCallScore.mock.calls.find(
        (c) => (c[0] as { parameterId: string }).parameterId === "prosody_raw_gra",
      );
      expect((lrCall![0] as { confidence: number }).confidence).toBe(0.7);
      expect((graCall![0] as { confidence: number }).confidence).toBe(0.7);
    });

    it("skips non-finite bands — null → no write (operator rule: never fabricate defaults)", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "ielts",
        ieltsScores: {
          fluencyCoherence: 7,
          pronunciation: NaN, // vendor returned no signal for P
          lexicalResource: 7,
          grammaticalRange: 6,
          overall: 7,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      const result = await applyProsodyContractToAggregate("call-1", "caller-1");

      // 3 of 4 lands — P is skipped because vendor returned no signal.
      // Honest empty rather than hardcoded zero.
      expect(result.scoresWritten).toBe(3);
      const paramIds = mockWriteCallScore.mock.calls.map(
        (c) => (c[0] as { parameterId: string }).parameterId,
      );
      expect(paramIds).not.toContain("prosody_raw_p");
    });

    it("evidence string identifies the criterion + raw band (forensics)", async () => {
      const envelope: VoiceProsodyFeatures = {
        mode: "ielts",
        ieltsScores: {
          fluencyCoherence: 7,
          pronunciation: 6.5,
          lexicalResource: 7,
          grammaticalRange: 6,
          overall: 7,
        },
      };
      mockPrisma.call.findUnique.mockResolvedValue({ voiceProsody: envelope });

      await applyProsodyContractToAggregate("call-1", "caller-1");

      const fcCall = mockWriteCallScore.mock.calls.find(
        (c) => (c[0] as { parameterId: string }).parameterId === "prosody_raw_fc",
      );
      const evidence = (fcCall![0] as { evidence: string[] }).evidence;
      expect(evidence[0]).toContain("fluencyCoherence");
      expect(evidence[0]).toContain("band=7.0");
    });

    it("flag state irrelevant to prosody-raw writes — flag=true still writes 4 prosody_raw_* rows", async () => {
      // #2138 — post-S3 the flag controls ONLY the LLM-judged path.
      // Prosody-raw writes run unconditionally because the namespaces
      // are disjoint (no dual-writer race possible).
      const originalEnv = process.env.HF_IELTS_LLM_MEASURE_V1;
      process.env.HF_IELTS_LLM_MEASURE_V1 = "true";
      try {
        vi.resetModules();
        const mod = await import("@/lib/pipeline/prosody-consumer");
        const fn = mod.applyProsodyContractToAggregate;

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

        const result = await fn("call-1", "caller-1");

        expect(result.applied).toBe(true);
        expect(result.scoresWritten).toBe(4);
        const paramIds = mockWriteCallScore.mock.calls.map(
          (c) => (c[0] as { parameterId: string }).parameterId,
        );
        expect(paramIds).toEqual(
          expect.arrayContaining([
            "prosody_raw_fc",
            "prosody_raw_p",
            "prosody_raw_lr",
            "prosody_raw_gra",
          ]),
        );
        expect(paramIds).not.toContain("skill_fluency_and_coherence_fc");
      } finally {
        if (originalEnv === undefined) {
          delete process.env.HF_IELTS_LLM_MEASURE_V1;
        } else {
          process.env.HF_IELTS_LLM_MEASURE_V1 = originalEnv;
        }
      }
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

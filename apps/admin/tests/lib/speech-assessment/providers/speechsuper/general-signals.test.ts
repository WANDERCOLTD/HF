/**
 * SpeechSuper general-signal derivation tests (#1871).
 *
 * Covers:
 *   - `speaking_rate` → `paceWpm` direct mapping
 *   - `pause_filler_frequency` → `hesitationRate` mapping (ratio form)
 *   - Percent form (>1) normalises to [0, 1]
 *   - camelCase aliases (`speakingRate`, `pauseFillerFrequency`) accepted
 *   - Missing Pro features → empty partial (no crash)
 *   - meanEnergyDb + pitchRangeHz never populated
 */

import { describe, expect, it } from "vitest";

import { deriveSignalsFromSpeechSuperResponse } from "@/lib/speech-assessment/providers/speechsuper";

describe("deriveSignalsFromSpeechSuperResponse — #1871", () => {
  it("maps speaking_rate → paceWpm directly", () => {
    const out = deriveSignalsFromSpeechSuperResponse({
      result: { speaking_rate: 145 },
    });
    expect(out.paceWpm).toBe(145);
  });

  it("maps pause_filler_frequency → hesitationRate as a ratio", () => {
    const out = deriveSignalsFromSpeechSuperResponse({
      result: { pause_filler_frequency: 0.12 },
    });
    expect(out.hesitationRate).toBeCloseTo(0.12, 5);
  });

  it("treats pause_filler_frequency > 1 as a percent and normalises to ratio", () => {
    const out = deriveSignalsFromSpeechSuperResponse({
      result: { pause_filler_frequency: 25 },
    });
    expect(out.hesitationRate).toBeCloseTo(0.25, 5);
  });

  it("clamps pause_filler_frequency to [0, 1]", () => {
    const out = deriveSignalsFromSpeechSuperResponse({
      result: { pause_filler_frequency: -0.5 },
    });
    expect(out.hesitationRate).toBe(0);
  });

  it("accepts camelCase aliases (speakingRate / pauseFillerFrequency)", () => {
    const out = deriveSignalsFromSpeechSuperResponse({
      result: {
        speakingRate: 130,
        pauseFillerFrequency: 0.08,
      } as never,
    });
    expect(out.paceWpm).toBe(130);
    expect(out.hesitationRate).toBeCloseTo(0.08, 5);
  });

  it("returns empty partial when result block is absent", () => {
    expect(deriveSignalsFromSpeechSuperResponse({})).toEqual({});
  });

  it("returns empty partial when Pro features are missing", () => {
    const out = deriveSignalsFromSpeechSuperResponse({
      result: { overall: 6.5, pronunciation: 7.0 },
    });
    expect(out).toEqual({});
  });

  it("never populates meanEnergyDb or pitchRangeHz", () => {
    const out = deriveSignalsFromSpeechSuperResponse({
      result: { speaking_rate: 130, pause_filler_frequency: 0.1 },
    });
    expect(out.meanEnergyDb).toBeUndefined();
    expect(out.pitchRangeHz).toBeUndefined();
  });

  it("ignores NaN / Infinity values", () => {
    const out = deriveSignalsFromSpeechSuperResponse({
      result: { speaking_rate: NaN as number, pause_filler_frequency: Infinity as number },
    });
    expect(out.paceWpm).toBeUndefined();
    expect(out.hesitationRate).toBeUndefined();
  });
});

/**
 * SpeechAce general-signal derivation tests (#1871).
 *
 * Covers:
 *   - Word-timing → paceWpm correctness (≥2 words required)
 *   - Transcript filler-token count → hesitationRate (bounded [0, 1])
 *   - Response missing word-timings → empty partial (no crash)
 *   - Response missing transcript → no hesitationRate populated
 *   - Single-word response → no paceWpm populated (need ≥2 to span a duration)
 *   - meanEnergyDb + pitchRangeHz never populated (vendor doesn't expose)
 *
 * Live adapter HTTP path tested separately — these tests exercise the pure
 * derivation so they don't need a fetch mock.
 */

import { describe, expect, it } from "vitest";

import {
  deriveSignalsFromSpeechAceResponse,
  computeHesitationRate,
} from "@/lib/speech-assessment/providers/speechace";

describe("deriveSignalsFromSpeechAceResponse — #1871", () => {
  it("derives paceWpm from word-timing across ≥2 words", () => {
    const out = deriveSignalsFromSpeechAceResponse({
      speech_score: {
        word_score_list: [
          { word: "I", start_time: 0.0, end_time: 0.1 },
          { word: "want", start_time: 0.1, end_time: 0.3 },
          { word: "to", start_time: 0.3, end_time: 0.4 },
          { word: "speak", start_time: 0.4, end_time: 1.0 },
          { word: "now", start_time: 1.0, end_time: 2.0 },
        ],
        transcript: "I want to speak now",
      },
    });
    expect(out.paceWpm).toBeCloseTo(150, 1);
  });

  it("derives hesitationRate from filler tokens in transcript", () => {
    const out = deriveSignalsFromSpeechAceResponse({
      speech_score: {
        word_score_list: [
          { word: "um", start_time: 0.0, end_time: 0.3 },
          { word: "I", start_time: 0.3, end_time: 0.4 },
          { word: "think", start_time: 0.4, end_time: 0.6 },
          { word: "uh", start_time: 0.6, end_time: 0.9 },
        ],
        transcript: "um I think uh",
      },
    });
    expect(out.hesitationRate).toBeCloseTo(0.5, 5);
  });

  it("returns empty partial when response has no word-timings AND no transcript", () => {
    const out = deriveSignalsFromSpeechAceResponse({ speech_score: {} });
    expect(out.paceWpm).toBeUndefined();
    expect(out.hesitationRate).toBeUndefined();
  });

  it("returns empty partial when speech_score is absent", () => {
    const out = deriveSignalsFromSpeechAceResponse({});
    expect(out).toEqual({});
  });

  it("single-word response → no paceWpm (needs ≥2 to span a duration)", () => {
    const out = deriveSignalsFromSpeechAceResponse({
      speech_score: {
        word_score_list: [{ word: "yes", start_time: 0.0, end_time: 0.4 }],
        transcript: "yes",
      },
    });
    expect(out.paceWpm).toBeUndefined();
    expect(out.hesitationRate).toBe(0);
  });

  it("never populates meanEnergyDb or pitchRangeHz (vendor doesn't expose)", () => {
    const out = deriveSignalsFromSpeechAceResponse({
      speech_score: {
        word_score_list: [
          { word: "I", start_time: 0.0, end_time: 0.1 },
          { word: "speak", start_time: 0.1, end_time: 0.6 },
        ],
        transcript: "I speak",
      },
    });
    expect(out.meanEnergyDb).toBeUndefined();
    expect(out.pitchRangeHz).toBeUndefined();
  });

  it("tolerates alternate field-name aliases (start/end vs start_time/end_time)", () => {
    const out = deriveSignalsFromSpeechAceResponse({
      speech_score: {
        word_score_list: [
          { word: "I", start: 0.0, end: 0.1 },
          { word: "speak", start: 0.1, end: 1.0 } as never,
        ],
        transcript: "I speak",
      },
    });
    expect(out.paceWpm).toBeCloseTo(120, 1);
  });

  it("non-positive duration → no paceWpm (defensive against vendor timing bugs)", () => {
    const out = deriveSignalsFromSpeechAceResponse({
      speech_score: {
        word_score_list: [
          { word: "I", start_time: 0.0, end_time: 0.1 },
          { word: "speak", start_time: 0.0, end_time: 0.0 },
        ],
        transcript: "I speak",
      },
    });
    expect(out.paceWpm).toBeUndefined();
  });
});

describe("computeHesitationRate — #1871", () => {
  it("returns 0 for an empty transcript", () => {
    expect(computeHesitationRate("")).toBe(0);
    expect(computeHesitationRate("   ")).toBe(0);
  });

  it("returns 0 when no filler tokens are present", () => {
    expect(computeHesitationRate("hello world")).toBe(0);
  });

  it("strips punctuation when tokenising", () => {
    expect(computeHesitationRate("um, I think, uh.")).toBeCloseTo(0.5, 5);
  });

  it("is case-insensitive", () => {
    expect(computeHesitationRate("UM Hello UH")).toBeCloseTo(2 / 3, 5);
  });

  it("bounded to [0, 1]", () => {
    expect(computeHesitationRate("um uh er ah")).toBe(1);
  });
});

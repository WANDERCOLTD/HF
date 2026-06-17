/**
 * compute-overall-band.test.ts — pins the canonical overall-band
 * computation (#1823). The pipeline writer + Results-screen reader both
 * call this helper; the round-trip pin guarantees they cannot diverge.
 */
import { describe, it, expect } from "vitest";
import {
  computeOverallBandFromScores,
  roundHalfBand,
} from "@/lib/pipeline/compute-overall-band";
import type { SkillTierMapping } from "@/lib/goals/track-progress";

// Mirrors `scripts/migrate-ielts-playbook-mapping.ts::IELTS_MAPPING` —
// the per-Playbook override the live IELTS Speaking Practice carries.
const IELTS_MAPPING: SkillTierMapping = {
  thresholds: {
    approachingEmerging: 0.3,
    emerging: 0.55,
    developing: 0.7,
    secure: 1.0,
  },
  tierBands: {
    approachingEmerging: 3,
    emerging: 4,
    developing: 5.5,
    secure: 7,
  },
};

describe("roundHalfBand", () => {
  it("rounds to nearest 0.5", () => {
    expect(roundHalfBand(6.0)).toBe(6.0);
    expect(roundHalfBand(6.24)).toBe(6.0);
    expect(roundHalfBand(6.25)).toBe(6.5);
    expect(roundHalfBand(6.74)).toBe(6.5);
    expect(roundHalfBand(6.75)).toBe(7.0);
  });
});

describe("computeOverallBandFromScores", () => {
  it("returns null when no per-segment rows exist", () => {
    expect(computeOverallBandFromScores([], IELTS_MAPPING)).toBeNull();
  });

  it("ignores rows with null segmentKey (whole-call / bound-module writes)", () => {
    const rows = [
      { parameterId: "p1", segmentKey: null, score: 0.9 },
      { parameterId: "p2", segmentKey: null, score: 0.9 },
    ];
    expect(computeOverallBandFromScores(rows, IELTS_MAPPING)).toBeNull();
  });

  it("averages buckets across (parameterId, segmentKey) — IELTS 4-tier mapping", () => {
    // IELTS mapping bands: <0.3 → 3, <0.55 → 4, <0.7 → 5.5, ≥0.7 → 7.
    const rows = [
      // Part 1 — scores 0.6/0.7/0.6/0.6 → bands 5.5/7/5.5/5.5
      { parameterId: "fluency", segmentKey: "p1", score: 0.6 },
      { parameterId: "lexical", segmentKey: "p1", score: 0.7 },
      { parameterId: "grammar", segmentKey: "p1", score: 0.6 },
      { parameterId: "pronunciation", segmentKey: "p1", score: 0.6 },
      // Part 2 — 0.7/0.7/0.6/0.7 → 7/7/5.5/7
      { parameterId: "fluency", segmentKey: "p2", score: 0.7 },
      { parameterId: "lexical", segmentKey: "p2", score: 0.7 },
      { parameterId: "grammar", segmentKey: "p2", score: 0.6 },
      { parameterId: "pronunciation", segmentKey: "p2", score: 0.7 },
      // Part 3 — 0.6/0.7/0.7/0.7 → 5.5/7/7/7
      { parameterId: "fluency", segmentKey: "p3", score: 0.6 },
      { parameterId: "lexical", segmentKey: "p3", score: 0.7 },
      { parameterId: "grammar", segmentKey: "p3", score: 0.7 },
      { parameterId: "pronunciation", segmentKey: "p3", score: 0.7 },
    ];
    // Sum of 12 bands = (5.5+7+5.5+5.5) + (7+7+5.5+7) + (5.5+7+7+7) = 23.5+26.5+26.5 = 76.5
    // Mean = 76.5/12 = 6.375 → roundHalfBand → 6.5
    expect(computeOverallBandFromScores(rows, IELTS_MAPPING)).toBe(6.5);
  });

  it("collapses duplicate (parameterId, segmentKey) entries via mean before banding", () => {
    const rows = [
      { parameterId: "fluency", segmentKey: "p1", score: 0.6 },
      { parameterId: "fluency", segmentKey: "p1", score: 0.7 },
    ];
    // Mean of bucket = 0.65 → band 5.5 (developing, since 0.55 ≤ 0.65 < 0.7).
    expect(computeOverallBandFromScores(rows, IELTS_MAPPING)).toBe(5.5);
  });

  it("rounds half-band up via the helper boundary (mean 0.25 → 0.5)", () => {
    // Two buckets — bands 7 and 5.5 → mean 6.25 → roundHalfBand → 6.5.
    const rows = [
      { parameterId: "a", segmentKey: "p1", score: 0.8 },
      { parameterId: "b", segmentKey: "p1", score: 0.6 },
    ];
    expect(computeOverallBandFromScores(rows, IELTS_MAPPING)).toBe(6.5);
  });

  it("returns whole-number band when all buckets land in the same tier", () => {
    const rows = [
      { parameterId: "a", segmentKey: "p1", score: 0.85 },
      { parameterId: "b", segmentKey: "p1", score: 0.9 },
      { parameterId: "c", segmentKey: "p2", score: 0.95 },
    ];
    // All ≥ 0.7 → all band 7 → mean 7 → 7.
    expect(computeOverallBandFromScores(rows, IELTS_MAPPING)).toBe(7);
  });
});

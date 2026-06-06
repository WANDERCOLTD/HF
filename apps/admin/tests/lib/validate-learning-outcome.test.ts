/**
 * G10 / #1160 — validateLearningOutcomeEntry + filterLearningOutcomes
 *
 * Defends Goal-table semantics: tutor-briefing fragments (which the
 * IELTS V1.0 wizard author dumped into `learningOutcomes[]`) MUST NOT
 * become `Goal.type=LEARN` rows.
 *
 * AC defended:
 *   - The 6 known IELTS V1.0 tutor-briefing fragments are all rejected
 *   - Real IELTS learner outcomes (the 8 OUT-NN entries) all pass
 *   - Short/empty entries are rejected
 *   - `filterLearningOutcomes` calls onReject for each drop and returns
 *     only validator-passing entries
 */

import { describe, it, expect, vi } from "vitest";
import {
  validateLearningOutcomeEntry,
  filterLearningOutcomes,
} from "@/lib/domain/validate-learning-outcome";

/**
 * The 6 distinct tutor-briefing strings observed on IELTS V1.0 (audit
 * 2026-06-06). Each replicated across 20 callers → 120 dirty rows.
 */
const TUTOR_BRIEFING_FIXTURES = [
  "Call 1 is a topic-led warm-up only with special rules that differ from subsequent calls",
  "From Call 2 onwards the tutor's coaching is explicitly criterion-referenced and each call ends with a concrete, criterion-specific gain the student can name",
  "P is partially independent — a student can have excellent vocabulary but poor pronunciation, or vice versa",
  "FC is the most visible criterion — poor fluency masks good vocabulary and grammar",
  "The four criteria below must NOT be named, listed, or explained on Call 1",
  "On Call 1 the tutor scores silently in the background",
];

/**
 * The 8 legitimate `lo_rollup` outcomes from IELTS V1.0 (OUT-01..OUT-08).
 * Each must pass the validator unchanged.
 */
const LEGITIMATE_OUTCOMES = [
  "Speak naturally about familiar topics for 4–5 minutes without long pauses or repeated self-correction",
  "Extend Part 1 answers with one supporting detail or example beyond the direct answer",
  "Speak for 90 seconds on a Part 2 cue card without stalling on word-search",
  "Cover all four cue-card bullets in a structured Part 2 monologue",
  "Vary sentence structure across a Part 2 monologue (simple → complex → conditional or hypothetical)",
  "Sustain abstract Part 3 discussion with hedging, paraphrase, and concession-then-reassertion moves",
  "Compare across time, generalise, and speculate using conditional structures in Part 3",
  "Maintain clear pronunciation with appropriate stress, rhythm, and intonation throughout the test",
];

describe("validateLearningOutcomeEntry", () => {
  it.each(TUTOR_BRIEFING_FIXTURES)("rejects tutor-briefing fixture: %s", (entry) => {
    const r = validateLearningOutcomeEntry(entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/.+/);
  });

  it.each(LEGITIMATE_OUTCOMES)("accepts legitimate IELTS V1.0 outcome: %s", (entry) => {
    expect(validateLearningOutcomeEntry(entry)).toEqual({ ok: true });
  });

  it("rejects empty string", () => {
    expect(validateLearningOutcomeEntry("")).toEqual({ ok: false, reason: "empty string" });
  });

  it("rejects whitespace-only string", () => {
    expect(validateLearningOutcomeEntry("   ")).toEqual({ ok: false, reason: "empty string" });
  });

  it("rejects too-short entries (fewer than 3 tokens)", () => {
    const r = validateLearningOutcomeEntry("Pass IELTS");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("too short");
  });

  it("accepts an entry exactly at the 3-token minimum", () => {
    expect(validateLearningOutcomeEntry("Pass IELTS Speaking")).toEqual({ ok: true });
  });

  it("does NOT false-positive on outcomes that reference call count as a learner target", () => {
    // "Complete 5 practice calls" is a learner outcome, not a rule-of-engagement.
    expect(
      validateLearningOutcomeEntry(
        "Complete 5 practice calls on Part 2 within 4 weeks",
      ),
    ).toEqual({ ok: true });
  });
});

describe("filterLearningOutcomes", () => {
  it("filters a mixed list — keeps real outcomes, drops briefing", () => {
    const mixed = [
      ...TUTOR_BRIEFING_FIXTURES,
      ...LEGITIMATE_OUTCOMES,
    ];
    const passed = filterLearningOutcomes(mixed);
    expect(passed).toHaveLength(LEGITIMATE_OUTCOMES.length);
    expect(passed).toEqual(LEGITIMATE_OUTCOMES);
  });

  it("calls onReject for each dropped entry with its rejection reason", () => {
    const onReject = vi.fn();
    filterLearningOutcomes(TUTOR_BRIEFING_FIXTURES, onReject);
    expect(onReject).toHaveBeenCalledTimes(TUTOR_BRIEFING_FIXTURES.length);
    for (const call of onReject.mock.calls) {
      expect(call[0]).toEqual(expect.any(String)); // the entry
      expect(call[1]).toEqual(expect.any(String)); // the reason
      expect(call[1].length).toBeGreaterThan(5);
    }
  });

  it("returns an empty array when given only tutor-briefing entries", () => {
    expect(filterLearningOutcomes(TUTOR_BRIEFING_FIXTURES)).toEqual([]);
  });

  it("preserves order of legitimate outcomes", () => {
    const passed = filterLearningOutcomes([
      LEGITIMATE_OUTCOMES[2],
      TUTOR_BRIEFING_FIXTURES[0],
      LEGITIMATE_OUTCOMES[0],
      TUTOR_BRIEFING_FIXTURES[3],
      LEGITIMATE_OUTCOMES[5],
    ]);
    expect(passed).toEqual([
      LEGITIMATE_OUTCOMES[2],
      LEGITIMATE_OUTCOMES[0],
      LEGITIMATE_OUTCOMES[5],
    ]);
  });
});

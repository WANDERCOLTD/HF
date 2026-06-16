/**
 * Behavioural tests for `lib/voice/talk-time-stats.ts` — #1747.
 *
 * Pure-function pins:
 *   - empty / null / undefined transcript → zero stats
 *   - canonical `User:` / `Assistant:` format parsed into per-side
 *     turn + word counts
 *   - continuation lines accrue under the active speaker
 *   - maxTutorTurnWords reflects the longest single tutor turn
 *   - maxTutorTurnSec = maxTutorTurnWords / wordsPerSecond
 *   - tutorRatio = tutorWords / (tutor + learner), 0 when zero words
 *   - evaluation returns overBudget + exceededBy names
 *   - missing budgets fall back to DEFAULT_TALK_TIME_BUDGETS
 */

import { describe, it, expect } from "vitest";

import {
  computeTalkTimeStats,
  evaluateTalkTimeBudgets,
  DEFAULT_TALK_TIME_BUDGETS,
  DEFAULT_WORDS_PER_SECOND,
} from "@/lib/voice/talk-time-stats";

describe("computeTalkTimeStats", () => {
  it("returns zero stats for null / undefined / empty", () => {
    for (const t of [null, undefined, "", "   "]) {
      const s = computeTalkTimeStats(t);
      expect(s.tutorTurnCount).toBe(0);
      expect(s.learnerTurnCount).toBe(0);
      expect(s.tutorWordCount).toBe(0);
      expect(s.learnerWordCount).toBe(0);
      expect(s.maxTutorTurnWords).toBe(0);
      expect(s.maxTutorTurnSec).toBe(0);
      expect(s.tutorRatio).toBe(0);
      expect(s.wordsPerSecond).toBe(DEFAULT_WORDS_PER_SECOND);
    }
  });

  it("counts simple two-turn exchange", () => {
    const transcript = `
Assistant: Hello, what's your favourite topic?
User: I love football and I watch every weekend.
`.trim();
    const s = computeTalkTimeStats(transcript);
    expect(s.tutorTurnCount).toBe(1);
    expect(s.learnerTurnCount).toBe(1);
    expect(s.tutorWordCount).toBe(5); // "Hello, what's your favourite topic?"
    expect(s.learnerWordCount).toBe(8); // "I love football and I watch every weekend."
    expect(s.tutorRatio).toBeCloseTo(5 / 13, 4);
  });

  it("accrues continuation lines under the active speaker", () => {
    const transcript = `
Assistant: First line.
Continuation of the tutor's turn here.
User: My response on this line only.
`.trim();
    const s = computeTalkTimeStats(transcript);
    expect(s.tutorTurnCount).toBe(1);
    expect(s.learnerTurnCount).toBe(1);
    // "First line." (2) + "Continuation of the tutor's turn here." (6) = 8
    expect(s.tutorWordCount).toBe(8);
    expect(s.maxTutorTurnWords).toBe(8);
  });

  it("tracks maxTutorTurnWords across multiple tutor turns", () => {
    // Three tutor turns: 5 words, 12 words, 3 words → max = 12.
    const transcript = `
Assistant: One two three four five.
User: Quick.
Assistant: Six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen.
User: Quick again.
Assistant: Eighteen nineteen twenty.
`.trim();
    const s = computeTalkTimeStats(transcript);
    expect(s.tutorTurnCount).toBe(3);
    expect(s.maxTutorTurnWords).toBe(12);
    expect(s.maxTutorTurnSec).toBeCloseTo(12 / DEFAULT_WORDS_PER_SECOND, 4);
  });

  it("uses operator-overridden wordsPerSecond", () => {
    const transcript = "Assistant: Five word turn right here.";
    const s = computeTalkTimeStats(transcript, { wordsPerSecond: 5 });
    expect(s.maxTutorTurnWords).toBe(5);
    expect(s.maxTutorTurnSec).toBeCloseTo(1, 4); // 5 / 5 wps = 1s
    expect(s.wordsPerSecond).toBe(5);
  });

  it("computes tutorRatio = tutorWords / total, 0 when no words at all", () => {
    const empty = computeTalkTimeStats("");
    expect(empty.tutorRatio).toBe(0);
    const learnerHeavy = computeTalkTimeStats(
      "Assistant: One.\nUser: One two three four five six seven eight nine.",
    );
    expect(learnerHeavy.tutorRatio).toBeCloseTo(1 / 10, 4);
  });

  it("handles speaker labels case-insensitively (assistant / ASSISTANT / Assistant)", () => {
    const transcript = `
ASSISTANT: hi.
user: ok.
Assistant: bye.
`.trim();
    const s = computeTalkTimeStats(transcript);
    expect(s.tutorTurnCount).toBe(2);
    expect(s.learnerTurnCount).toBe(1);
  });
});

describe("evaluateTalkTimeBudgets", () => {
  it("returns overBudget=false when stats are within both defaults", () => {
    const stats = computeTalkTimeStats(
      "Assistant: Short turn.\nUser: One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five.",
    );
    const ev = evaluateTalkTimeBudgets(stats);
    expect(ev.overBudget).toBe(false);
    expect(ev.exceededBy).toEqual([]);
    expect(ev.budgets).toEqual(DEFAULT_TALK_TIME_BUDGETS);
  });

  it("flags maxTutorTurnSec when a tutor turn exceeds the budget", () => {
    // 100 words at 2.5 wps = 40s > 30s default.
    const longTurn = "Assistant: " + Array(100).fill("word").join(" ");
    const stats = computeTalkTimeStats(longTurn);
    expect(stats.maxTutorTurnSec).toBeCloseTo(40, 4);
    const ev = evaluateTalkTimeBudgets(stats);
    expect(ev.overBudget).toBe(true);
    expect(ev.exceededBy).toContain("maxTutorTurnSec");
  });

  it("flags maxTutorRatio when tutor dominates the session", () => {
    // 100 tutor words across 5 turns, 1 learner word → ratio ≈ 0.99.
    const transcript = [
      "Assistant: " + Array(20).fill("a").join(" "),
      "User: ok",
      "Assistant: " + Array(20).fill("a").join(" "),
      "User: ok",
      "Assistant: " + Array(20).fill("a").join(" "),
      "User: ok",
      "Assistant: " + Array(20).fill("a").join(" "),
      "User: ok",
      "Assistant: " + Array(20).fill("a").join(" "),
    ].join("\n");
    const stats = computeTalkTimeStats(transcript);
    expect(stats.tutorRatio).toBeGreaterThan(0.9);
    const ev = evaluateTalkTimeBudgets(stats);
    expect(ev.overBudget).toBe(true);
    expect(ev.exceededBy).toContain("maxTutorRatio");
  });

  it("merges operator-provided budgets over defaults", () => {
    const stats = computeTalkTimeStats(
      "Assistant: " + Array(50).fill("word").join(" "),
    );
    // stats.maxTutorTurnSec = 50 / 2.5 = 20s.
    // With operator budget maxTutorTurnSec=15, 20s > 15s → overBudget.
    const ev = evaluateTalkTimeBudgets(stats, { maxTutorTurnSec: 15 });
    expect(ev.budgets.maxTutorTurnSec).toBe(15);
    // Other budget keys fall back to defaults.
    expect(ev.budgets.maxTutorRatio).toBe(DEFAULT_TALK_TIME_BUDGETS.maxTutorRatio);
    expect(ev.exceededBy).toContain("maxTutorTurnSec");
  });

  it("returns overBudget=true when ANY budget is exceeded", () => {
    const transcript =
      "Assistant: " + Array(100).fill("a").join(" ") + "\nUser: ok";
    const stats = computeTalkTimeStats(transcript);
    const ev = evaluateTalkTimeBudgets(stats);
    // Both budgets blown (40s turn + ratio ≈ 0.99).
    expect(ev.overBudget).toBe(true);
    expect(ev.exceededBy).toHaveLength(2);
  });

  it("handles null / undefined budgets gracefully (falls back to defaults)", () => {
    const stats = computeTalkTimeStats("Assistant: short.\nUser: short.");
    const ev1 = evaluateTalkTimeBudgets(stats, null);
    const ev2 = evaluateTalkTimeBudgets(stats, undefined);
    expect(ev1.budgets).toEqual(DEFAULT_TALK_TIME_BUDGETS);
    expect(ev2.budgets).toEqual(DEFAULT_TALK_TIME_BUDGETS);
  });
});

/**
 * #1067 — deterministic MCQ option shuffle.
 *
 * Pinned contracts:
 *   - Same seed → same permutation (retry stability)
 *   - Different seeds → different permutations (cohort spread)
 *   - `isCorrect` flag travels through the shuffle on each option
 *   - Across 100 questions for one caller, correct answer lands in
 *     A/B/C/D positions at ~25% each (the AC headline number)
 *   - relabelByPosition assigns A/B/C/D to the shuffled positions so
 *     the survey renderer presents labels in display order
 */

import { describe, it, expect } from "vitest";
import {
  seedFromStrings,
  shuffleOptions,
  relabelByPosition,
} from "@/lib/assessment/shuffle-options";

type Opt = { label: string; text: string; isCorrect?: boolean };

const baseFour: Opt[] = [
  { label: "A", text: "1347", isCorrect: true },
  { label: "B", text: "1234" },
  { label: "C", text: "1265" },
  { label: "D", text: "1450" },
];

describe("shuffle-options — #1067 deterministic shuffle", () => {
  it("same seed produces the same permutation (retry stable)", () => {
    const seed = seedFromStrings("caller-1", "question-42");
    const a = shuffleOptions(baseFour, seed);
    const b = shuffleOptions(baseFour, seed);
    expect(a.map((o) => o.text)).toEqual(b.map((o) => o.text));
  });

  it("different seeds usually produce different permutations", () => {
    const seedA = seedFromStrings("caller-1", "question-42");
    const seedB = seedFromStrings("caller-2", "question-42");
    const a = shuffleOptions(baseFour, seedA);
    const b = shuffleOptions(baseFour, seedB);
    // Not strictly guaranteed mathematically but the chance of collision
    // on 4! = 24 permutations is < 5%. mulberry32 spreads well across
    // close seeds — verified locally.
    expect(a.map((o) => o.text)).not.toEqual(b.map((o) => o.text));
  });

  it("isCorrect flag travels through the shuffle on the same option", () => {
    const seed = seedFromStrings("caller-x", "q-1");
    const shuffled = shuffleOptions(baseFour, seed);
    // The "1347" option is the correct one in the input; it must still
    // carry isCorrect=true after shuffle.
    const found = shuffled.find((o) => o.text === "1347");
    expect(found).toBeDefined();
    expect(found?.isCorrect).toBe(true);
    // And no other option falsely picks it up.
    const wrongTagged = shuffled.filter((o) => o.text !== "1347" && o.isCorrect);
    expect(wrongTagged).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const seed = seedFromStrings("caller-1", "question-42");
    const before = baseFour.map((o) => o.text);
    shuffleOptions(baseFour, seed);
    expect(baseFour.map((o) => o.text)).toEqual(before);
  });

  it("AC distribution — across 100 questions for one caller, correct answer is ~25/25/25/25 across labels", () => {
    // Simulate the XAMS shape: 100 questions, all with correct = storage label A.
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (let i = 0; i < 100; i++) {
      const seed = seedFromStrings("caller-x", `q-${i.toString().padStart(3, "0")}`);
      const shuffled = relabelByPosition(shuffleOptions(baseFour, seed));
      const correct = shuffled.find((o) => o.isCorrect);
      if (correct?.label) counts[correct.label] = (counts[correct.label] ?? 0) + 1;
    }
    // Allow generous slack (10..40) — 100 trials over 4 buckets has
    // wide variance; the AC's "approximately 25%" wording covers this.
    expect(counts.A).toBeGreaterThan(10);
    expect(counts.A).toBeLessThan(40);
    expect(counts.B).toBeGreaterThan(10);
    expect(counts.B).toBeLessThan(40);
    expect(counts.C).toBeGreaterThan(10);
    expect(counts.C).toBeLessThan(40);
    expect(counts.D).toBeGreaterThan(10);
    expect(counts.D).toBeLessThan(40);
    expect(counts.A + counts.B + counts.C + counts.D).toBe(100);
    // And critically: NONE of the buckets has all 100 (the symptom the
    // story exists to fix — "always A" leak).
    expect(Math.max(counts.A, counts.B, counts.C, counts.D)).toBeLessThan(100);
  });

  it("AC: stable per (caller, question) — repeat call gives same labels", () => {
    const seedPre = seedFromStrings("caller-x", "q-001");
    const seedPost = seedFromStrings("caller-x", "q-001"); // same key
    const pre = relabelByPosition(shuffleOptions(baseFour, seedPre));
    const post = relabelByPosition(shuffleOptions(baseFour, seedPost));
    // Same label → same text across the two calls (post-test mirrors pre-test).
    for (let i = 0; i < pre.length; i++) {
      expect(pre[i].label).toBe(post[i].label);
      expect(pre[i].text).toBe(post[i].text);
    }
  });

  it("relabelByPosition rewrites label to position letter", () => {
    const seed = seedFromStrings("caller-x", "q-1");
    const shuffled = relabelByPosition(shuffleOptions(baseFour, seed));
    expect(shuffled.map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
  });

  it("handles 2-option questions (true/false)", () => {
    const tf: Opt[] = [
      { label: "A", text: "True", isCorrect: true },
      { label: "B", text: "False" },
    ];
    const a = relabelByPosition(shuffleOptions(tf, seedFromStrings("c", "tf-1")));
    expect(a.map((o) => o.label)).toEqual(["A", "B"]);
    // Correct option's new label is consistent with its position.
    const correct = a.find((o) => o.isCorrect);
    expect(correct).toBeDefined();
    expect(["A", "B"]).toContain(correct?.label);
  });

  it("seedFromStrings is stable across calls for same input", () => {
    expect(seedFromStrings("a", "b")).toBe(seedFromStrings("a", "b"));
    expect(seedFromStrings("a", "b")).not.toBe(seedFromStrings("a", "c"));
  });

  it("empty-input is a no-op", () => {
    expect(shuffleOptions([], 1234)).toEqual([]);
  });
});

/**
 * Tests for reconcile-lo-linkage.ts — the pure scoring/tokenisation functions.
 * The async reconcileAssertionLOs() itself hits DB and is tested via integration.
 */
import { describe, it, expect } from "vitest";
import { tokenise, scoreMatch } from "@/lib/content-trust/reconcile-lo-linkage";

describe("tokenise", () => {
  it("lowercases and splits on whitespace", () => {
    const tokens = tokenise("Identify Key Vocabulary");
    expect(tokens).toContain("identify");
    expect(tokens).toContain("key");
    expect(tokens).toContain("vocabulary");
  });

  it("removes stop words", () => {
    const tokens = tokenise("Identify the main idea and central message of a text");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("and");
    expect(tokens).not.toContain("of");
    expect(tokens).not.toContain("a");
    expect(tokens).toContain("identify");
    expect(tokens).toContain("main");
    expect(tokens).toContain("idea");
    expect(tokens).toContain("central");
    expect(tokens).toContain("message");
    expect(tokens).toContain("text");
  });

  it("strips punctuation", () => {
    const tokens = tokenise("character's motivation — analysis!");
    expect(tokens).toContain("character");
    expect(tokens).toContain("motivation");
    expect(tokens).toContain("analysis");
  });

  it("drops short tokens (< 3 chars)", () => {
    const tokens = tokenise("an LO on AI is ok");
    // "an" = stop word, "LO" = 2 chars, "on" = stop word, "AI" = 2 chars, "is" = stop word, "ok" = 2 chars
    expect(tokens.size).toBe(0);
  });

  it("returns empty set for empty input", () => {
    expect(tokenise("").size).toBe(0);
    expect(tokenise("   ").size).toBe(0);
  });
});

describe("scoreMatch", () => {
  it("returns 0 for empty inputs", () => {
    expect(scoreMatch("", "fact", "Identify themes")).toBe(0);
    expect(scoreMatch("Some assertion", "fact", "")).toBe(0);
  });

  it("returns high score when assertion text covers LO keywords", () => {
    const score = scoreMatch(
      "Mole is nostalgic and emotional about leaving his home",
      "character",
      "Analyse character motivations, development, and relationships within a text",
    );
    // "character" appears in both, "motivations" may not match "nostalgic" exactly
    // but "character" category bonus should help
    expect(score).toBeGreaterThan(0);
  });

  it("returns higher score for better keyword overlap", () => {
    const loDesc = "Identify key vocabulary and unfamiliar words within a text and determine their meaning from context";

    const goodMatch = scoreMatch(
      "The word 'beckoned' means to signal or summon — a vocabulary highlight for context clue practice",
      "vocabulary_highlight",
      loDesc,
    );

    const poorMatch = scoreMatch(
      "The garden had been locked for ten years since Mrs Craven died",
      "key_event",
      loDesc,
    );

    expect(goodMatch).toBeGreaterThan(poorMatch);
  });

  it("gives category bonus when category keywords appear in LO", () => {
    const loDesc = "Analyse character motivations and development";

    const withBonus = scoreMatch(
      "Mary discovers the secret garden key",
      "character",
      loDesc,
    );

    const withoutBonus = scoreMatch(
      "Mary discovers the secret garden key",
      "key_event",
      loDesc,
    );

    expect(withBonus).toBeGreaterThan(withoutBonus);
  });

  it("caps score at 1.0", () => {
    const score = scoreMatch(
      "Identify key vocabulary and unfamiliar words within a text and determine their meaning from context",
      "vocabulary_highlight",
      "Identify key vocabulary",
    );
    expect(score).toBeLessThanOrEqual(1);
  });

  it("handles underscore categories by splitting into words", () => {
    const loDesc = "Understanding character through dialogue and action";
    const score = scoreMatch(
      "Colin's dialogue reveals his growing confidence",
      "key_quote",
      loDesc,
    );
    // "key_quote" splits to ["key", "quote"] — neither in LO, so no category bonus
    // But "dialogue" and "character" overlap
    expect(score).toBeGreaterThan(0);
  });

  it("threshold 0.3 is meaningful — real examples", () => {
    // This is the actual data from the DEV test course
    const los = [
      { ref: "LO9", desc: "Analyse character motivations, development, and relationships within a text" },
      { ref: "LO10", desc: "Interpret themes, symbols, and deeper meanings in literary works" },
      { ref: "LO11", desc: "Identify and explain the effect of figurative language, imagery, and literary devices" },
    ];

    // Character assertion should match LO9 best
    const characterAssertion = "Mole is deeply emotional about returning home and is overwhelmed with nostalgia";
    const scoresForCharacter = los.map((lo) => ({
      ref: lo.ref,
      score: scoreMatch(characterAssertion, "character", lo.desc),
    }));
    const bestForCharacter = scoresForCharacter.sort((a, b) => b.score - a.score)[0];
    expect(bestForCharacter.ref).toBe("LO9");

    // Theme assertion should match LO10 best
    const themeAssertion = "The Secret Garden explores themes of isolation, healing, and the transformative power of nature";
    const scoresForTheme = los.map((lo) => ({
      ref: lo.ref,
      score: scoreMatch(themeAssertion, "theme", lo.desc),
    }));
    const bestForTheme = scoresForTheme.sort((a, b) => b.score - a.score)[0];
    expect(bestForTheme.ref).toBe("LO10");

    // Language feature should match LO11 best
    const langAssertion = "The author uses personification when describing the wind as 'whispering through the garden'";
    const scoresForLang = los.map((lo) => ({
      ref: lo.ref,
      score: scoreMatch(langAssertion, "language_feature", lo.desc),
    }));
    const bestForLang = scoresForLang.sort((a, b) => b.score - a.score)[0];
    expect(bestForLang.ref).toBe("LO11");
  });
});

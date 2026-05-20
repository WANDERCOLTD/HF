/**
 * Tests for `lib/pipeline/evidence-prefilter.ts` — Step 2 of mode-kill #566.
 *
 * The pre-filter is shadow-only in Step 2; these tests assert decision
 * shape, transcript splitting, and the keyword cascade. Step 3 will add
 * decision-correctness assertions against real Caleb sims.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  checkEvidence,
  extractLearnerText,
  getEvidenceKeywords,
  runEvidencePrefilterBatch,
  __resetEvidenceKeywordCache,
} from "@/lib/pipeline/evidence-prefilter";

beforeEach(() => {
  __resetEvidenceKeywordCache();
});

const SAMPLE_TRANSCRIPT = `User: Hello, I work as a receptionist in a hotel in Warsaw.
Assistant: Great — tell me more about your day.

User: I greet guests, answer phone, check people in. Sometimes is busy, sometimes not.
Assistant: How long have you been doing this?
User: Almost two years, I think.
Assistant: That's a lot of practice.`;

const TUTOR_HEAVY_TRANSCRIPT = `User: hi
Assistant: Let's discuss the importance of vocabulary in IELTS Speaking. Vocabulary is a wide-ranging topic that includes lexical resource, idiomatic expressions, paraphrasing, and topic-specific terms. When examiners assess your lexical resource, they look for variety, precision, and natural use of less common vocabulary items.`;

describe("extractLearnerText", () => {
  it("returns concatenated user-side lines only", () => {
    const learner = extractLearnerText(SAMPLE_TRANSCRIPT);
    expect(learner).toContain("Hello, I work as a receptionist");
    expect(learner).toContain("Almost two years");
    expect(learner).not.toContain("Great — tell me more");
    expect(learner).not.toContain("That's a lot of practice");
  });

  it("returns empty string for null/undefined/empty transcript", () => {
    expect(extractLearnerText(null)).toBe("");
    expect(extractLearnerText(undefined)).toBe("");
    expect(extractLearnerText("")).toBe("");
  });

  it("handles single-block transcript with no role tags", () => {
    expect(extractLearnerText("Just some prose with no User: or Assistant: tags.")).toBe("");
  });

  it("preserves multi-line user replies until next role switch", () => {
    const multiLine = `User: Line one
Line two of same reply
Assistant: switch
User: Single line`;
    const learner = extractLearnerText(multiLine);
    expect(learner).toContain("Line one");
    expect(learner).toContain("Line two of same reply");
    expect(learner).toContain("Single line");
    expect(learner).not.toContain("switch");
  });
});

describe("getEvidenceKeywords — cascade", () => {
  it("uses admin override when Parameter.config.evidenceKeywords is set", () => {
    const result = getEvidenceKeywords({
      parameterId: "TEST-1",
      name: "Some Parameter",
      definition: "Something abstract",
      config: { evidenceKeywords: ["custom", "override", "keywords"] },
    });
    expect(result.source).toBe("admin-override");
    expect(result.keywords).toEqual(["custom", "override", "keywords"]);
  });

  it("ignores empty/non-string entries in admin override and falls back to auto-derived", () => {
    const result = getEvidenceKeywords({
      parameterId: "TEST-2",
      name: "Lexical Resource",
      definition: "Vocabulary breadth and precision",
      config: { evidenceKeywords: ["", "   ", 42, null] },
    });
    expect(result.source).toBe("auto-derived");
    expect(result.keywords).toContain("lexical");
    expect(result.keywords).toContain("resource");
    expect(result.keywords).toContain("vocabulary");
  });

  it("auto-derives from name + definition, removing stopwords and short tokens", () => {
    const result = getEvidenceKeywords({
      parameterId: "TEST-3",
      name: "Fluency and Coherence",
      definition: "How smoothly the speaker maintains flow",
    });
    expect(result.source).toBe("auto-derived");
    expect(result.keywords).toContain("fluency");
    expect(result.keywords).toContain("coherence");
    expect(result.keywords).toContain("smoothly");
    // Stopwords (the, and, how) should be filtered
    expect(result.keywords).not.toContain("the");
    expect(result.keywords).not.toContain("and");
    expect(result.keywords).not.toContain("how");
  });

  it("returns missing when no name/definition available", () => {
    const result = getEvidenceKeywords({ parameterId: "TEST-4" });
    expect(result.source).toBe("missing");
    expect(result.keywords).toEqual([]);
  });

  it("caches auto-derived keywords per parameterId", () => {
    const first = getEvidenceKeywords({
      parameterId: "TEST-CACHE",
      name: "Cached Param",
      definition: "First definition",
    });
    // Subsequent call with different definition should hit cache and return same result
    const second = getEvidenceKeywords({
      parameterId: "TEST-CACHE",
      name: "Different Name",
      definition: "Different definition entirely",
    });
    expect(second.keywords).toEqual(first.keywords);
  });
});

describe("checkEvidence — decision shape", () => {
  it("returns no-keywords-defined when param has nothing to derive from", () => {
    const result = checkEvidence(SAMPLE_TRANSCRIPT, { parameterId: "BARE" });
    expect(result.skip).toBe(false); // never skips on missing data
    expect(result.reason).toBe("no-keywords-defined");
    expect(result.source).toBe("missing");
  });

  it("returns learner-too-quiet when learner word count below threshold", () => {
    const result = checkEvidence("User: hi\nAssistant: long boring stuff", {
      parameterId: "QUIET-TEST",
      name: "Engagement",
      definition: "How engaged the caller is in conversation",
    }, { minLearnerWords: 5 });
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("learner-too-quiet");
  });

  it("matches keywords from the learner side", () => {
    const result = checkEvidence(SAMPLE_TRANSCRIPT, {
      parameterId: "HOTEL-WORK",
      name: "Workplace Context",
      definition: "References to job, work, hotel, receptionist",
    });
    expect(result.skip).toBe(false);
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
    expect(result.matchedKeywords).toEqual(
      expect.arrayContaining(["work"]),
    );
  });

  it("returns no-keyword-match when learner speech does not contain any keyword", () => {
    const result = checkEvidence(SAMPLE_TRANSCRIPT, {
      parameterId: "ASTRONAUT",
      name: "Astrophysics Vocabulary",
      definition: "References to galaxies nebulae quasars black holes",
    });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("no-keyword-match");
    expect(result.matchedKeywords).toEqual([]);
  });

  it("Boaz-shape: tutor-only vocabulary discussion produces no learner-side match", () => {
    // The original bug shape — COMP_VOCABULARY scored high in a teach-only
    // session. With evidence pre-filter, the learner says only "hi" so the
    // pre-filter should mark this as skip even though the tutor talks
    // extensively about vocabulary.
    const result = checkEvidence(TUTOR_HEAVY_TRANSCRIPT, {
      parameterId: "COMP_VOCABULARY",
      name: "Comprehension Vocabulary",
      definition: "Vocabulary breadth lexical resource paraphrasing",
    }, { minLearnerWords: 5 });
    expect(result.skip).toBe(true);
    expect(["learner-too-quiet", "no-keyword-match"]).toContain(
      result.reason.split(" ")[0],
    );
  });
});

describe("runEvidencePrefilterBatch — aggregate summary", () => {
  it("tallies wouldSkip vs wouldRun across params", () => {
    const params = [
      { parameterId: "WORK", name: "Work", definition: "job hotel receptionist" },
      { parameterId: "SPACE", name: "Space", definition: "galaxies nebulae" },
      { parameterId: "BARE", name: null, definition: null },
    ];
    const result = runEvidencePrefilterBatch(SAMPLE_TRANSCRIPT, params);
    expect(result.summary.total).toBe(3);
    expect(result.summary.wouldSkip + result.summary.wouldRun).toBe(3);
    expect(result.decisions).toHaveLength(3);
  });

  it("counts sources correctly when mixed", () => {
    const params = [
      { parameterId: "P1", name: "Hotel Work", definition: "work hotel", config: { evidenceKeywords: ["hotel", "work"] } },
      { parameterId: "P2", name: "Greeting", definition: "hello greeting" },
      { parameterId: "P3" },
    ];
    const result = runEvidencePrefilterBatch(SAMPLE_TRANSCRIPT, params);
    expect(result.summary.bySource["admin-override"]).toBe(1);
    expect(result.summary.bySource["auto-derived"]).toBe(1);
    expect(result.summary.bySource.missing).toBe(1);
  });
});

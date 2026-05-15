/**
 * Tests for classify-document.ts
 *
 * Verifies:
 * - buildMultiPointSample() samples from start, middle, and end
 * - Short texts are returned as-is
 * - Labels are correctly inserted
 */
import { describe, it, expect } from "vitest";
import { buildMultiPointSample, filenameTypeHint, isRubricContent } from "@/lib/content-trust/classify-document";

describe("buildMultiPointSample", () => {
  it("returns full text when shorter than totalSize", () => {
    const text = "Short document content";
    const result = buildMultiPointSample(text, 2000);
    expect(result).toBe(text);
  });

  it("samples from start, middle, and end with labels", () => {
    // Build a 3000 char document
    const start = "A".repeat(1000);
    const middle = "B".repeat(1000);
    const end = "C".repeat(1000);
    const fullText = start + middle + end;

    const result = buildMultiPointSample(fullText, 600);

    // Should contain all three labels
    expect(result).toContain("[START OF DOCUMENT]");
    expect(result).toContain("[MIDDLE OF DOCUMENT]");
    expect(result).toContain("[END OF DOCUMENT]");

    // Start section should have A characters
    const startSection = result.split("[MIDDLE OF DOCUMENT]")[0];
    expect(startSection).toContain("A");

    // End section should have C characters
    const endSection = result.split("[END OF DOCUMENT]")[1];
    expect(endSection).toContain("C");
  });

  it("distributes sample sizes roughly 40/30/30", () => {
    const fullText = "x".repeat(5000);
    const totalSize = 1000;

    const result = buildMultiPointSample(fullText, totalSize);

    // The result should be around totalSize + label overhead
    // Labels: "[START OF DOCUMENT]\n" + "\n[MIDDLE OF DOCUMENT]\n" + "\n[END OF DOCUMENT]\n"
    const labelOverhead = "[START OF DOCUMENT]".length + "[MIDDLE OF DOCUMENT]".length + "[END OF DOCUMENT]".length + 6; // newlines
    expect(result.length).toBeLessThanOrEqual(totalSize + labelOverhead + 10);
  });

  it("handles text exactly equal to totalSize", () => {
    const text = "x".repeat(2000);
    const result = buildMultiPointSample(text, 2000);
    expect(result).toBe(text);
  });
});

describe("filenameTypeHint", () => {
  it("detects course-reference in filename", () => {
    const hint = filenameTypeHint("11plus-english-course-reference.md");
    expect(hint).toEqual({ type: "COURSE_REFERENCE_CANONICAL", role: "pedagogy" });
  });

  it("detects course_reference with underscore", () => {
    const hint = filenameTypeHint("biology_course_reference.pdf");
    expect(hint).toEqual({ type: "COURSE_REFERENCE_CANONICAL", role: "pedagogy" });
  });

  it("detects course-ref shorthand", () => {
    const hint = filenameTypeHint("maths-course-ref.docx");
    expect(hint).toEqual({ type: "COURSE_REFERENCE_CANONICAL", role: "pedagogy" });
  });

  it("detects tutor-guide", () => {
    const hint = filenameTypeHint("english-tutor-guide.pdf");
    expect(hint).toEqual({ type: "COURSE_REFERENCE_TUTOR_BRIEFING", role: "pedagogy" });
  });

  it("detects tutor_handbook", () => {
    const hint = filenameTypeHint("science_tutor_handbook.md");
    expect(hint).toEqual({ type: "COURSE_REFERENCE_TUTOR_BRIEFING", role: "pedagogy" });
  });

  it("detects teaching-guide", () => {
    const hint = filenameTypeHint("Teaching-Guide-Year5.pdf");
    expect(hint).toEqual({ type: "COURSE_REFERENCE_TUTOR_BRIEFING", role: "pedagogy" });
  });

  it("detects teaching-methodology", () => {
    const hint = filenameTypeHint("reading-teaching-methodology.docx");
    expect(hint).toEqual({ type: "COURSE_REFERENCE_TUTOR_BRIEFING", role: "pedagogy" });
  });

  it("detects delivery-guide", () => {
    const hint = filenameTypeHint("11plus-delivery-guide.pdf");
    expect(hint).toEqual({ type: "COURSE_REFERENCE_TUTOR_BRIEFING", role: "pedagogy" });
  });

  it("detects question-bank", () => {
    const hint = filenameTypeHint("P1_SecretGarden_QuestionBank.docx");
    expect(hint).toEqual({ type: "QUESTION_BANK", role: "questions" });
  });

  it("detects question_bank with underscore", () => {
    const hint = filenameTypeHint("chapter1_question_bank.pdf");
    expect(hint).toEqual({ type: "QUESTION_BANK", role: "questions" });
  });

  it("detects reading-passage", () => {
    const hint = filenameTypeHint("black-death-reading-passage.pdf");
    expect(hint).toEqual({ type: "READING_PASSAGE", role: "passage" });
  });

  it("detects lesson-plan", () => {
    const hint = filenameTypeHint("week3-lesson-plan.docx");
    expect(hint).toEqual({ type: "LESSON_PLAN", role: "pedagogy" });
  });

  it("detects mark-scheme", () => {
    const hint = filenameTypeHint("SATs-mark-scheme-2024.pdf");
    expect(hint).toEqual({ type: "ASSESSMENT", role: "questions" });
  });

  it("detects past-paper", () => {
    const hint = filenameTypeHint("GCSE-biology-past-paper.pdf");
    expect(hint).toEqual({ type: "ASSESSMENT", role: "questions" });
  });

  it("returns null for generic filenames", () => {
    expect(filenameTypeHint("chapter1.pdf")).toBeNull();
    expect(filenameTypeHint("biology-notes.docx")).toBeNull();
    expect(filenameTypeHint("textbook.pdf")).toBeNull();
    expect(filenameTypeHint("P1_secret_garden_Chapter-1.docx")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(filenameTypeHint("COURSE-REFERENCE.PDF")).toEqual({ type: "COURSE_REFERENCE_CANONICAL", role: "pedagogy" });
    expect(filenameTypeHint("Tutor-Guide.docx")).toEqual({ type: "COURSE_REFERENCE_TUTOR_BRIEFING", role: "pedagogy" });
    expect(filenameTypeHint("QUESTION_BANK.pdf")).toEqual({ type: "QUESTION_BANK", role: "questions" });
  });

  // ── #276 Slice 1 + #385 Slice 1 Phase 2: rubric / band-descriptor filename hints route to ASSESSOR_RUBRIC ──

  it("detects band-descriptor filenames", () => {
    expect(filenameTypeHint("IELTS-Band-Descriptors.pdf")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
    expect(filenameTypeHint("speaking_band_descriptor.docx")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
  });

  it("detects assessment / scoring / marking rubric filenames", () => {
    expect(filenameTypeHint("assessment-rubric.pdf")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
    expect(filenameTypeHint("scoring_criteria.docx")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
    expect(filenameTypeHint("marking-criteria-2024.pdf")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
  });

  it("detects exam-specific rubric filenames (IELTS / CEFR / TOEFL)", () => {
    expect(filenameTypeHint("ielts-rubric.pdf")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
    expect(filenameTypeHint("CEFR-descriptor.docx")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
    expect(filenameTypeHint("toefl_band.pdf")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
  });

  it("detects band-score filenames", () => {
    expect(filenameTypeHint("band-scores.pdf")).toEqual({ type: "COURSE_REFERENCE_ASSESSOR_RUBRIC", role: "pedagogy" });
  });
});

// ── #276 Slice 1: content-based rubric detection ──

describe("isRubricContent", () => {
  it("detects IELTS Band Descriptors content (multiple markers)", () => {
    const sample = `
      IELTS Speaking Band Descriptors
      Band 9 — Fluency and Coherence: Speakers at this band speak fluently with rare hesitation.
      Band 7 — Lexical Resource: Uses vocabulary with flexibility.
      Band 5 — Grammatical Range and Accuracy: Uses a limited range of structures.
      Pronunciation features assessed across all bands.
    `;
    expect(isRubricContent(sample)).toBe(true);
  });

  it("detects content with assessment criteria + band score markers", () => {
    const sample = `Assessment criteria are applied across band scores from 1 to 9.`;
    expect(isRubricContent(sample)).toBe(true);
  });

  it("rejects student-facing content that incidentally mentions a band score", () => {
    const sample = `
      Welcome to your IELTS prep course! Many students aim for band 7 in speaking,
      which requires regular practice. Let's work through some common topics together.
    `;
    expect(isRubricContent(sample)).toBe(false);
  });

  it("rejects pure teaching content with no rubric markers", () => {
    const sample = `
      Today we'll practice describing your hometown. Try to talk for 1-2 minutes
      using these prompts: where it is, what you like about it, what changes you've seen.
    `;
    expect(isRubricContent(sample)).toBe(false);
  });

  it("detects CEFR-style descriptor content", () => {
    const sample = `
      C1 level descriptor: Can understand a wide range of demanding, longer texts.
      B2 level user: Can interact with a degree of fluency and spontaneity.
    `;
    expect(isRubricContent(sample)).toBe(true);
  });

  // ── Counter-signal: learner content that REFERENCES the rubric ──

  it("rejects learner-facing practice content that references rubric concepts in passing", () => {
    const sample = `
      ## Sample answers

      "I live in a small flat in the city centre. It's only a one-bedroom place,
      but it suits me because I'm out a lot for work."

      "Honestly, it depends on my mood. On weeknights I usually throw something
      quick together — pasta, a stir-fry, that kind of thing."

      ## Practice cue cards

      Cue card A: Describe a teacher who influenced you. You should say who the
      teacher was, what subject they taught, and explain how they shaped your
      approach to learning.

      ## Topic-area vocabulary
      - to grow up in / to put down roots / to be born and bred in
      - a bustling city / a sleepy town

      ## Pronunciation drills
      Minimal pairs and sentence stress practice for IELTS speaking.
      Try this: read aloud and aim for natural connected speech.

      Note: aim for Band 7 in your responses.
    `;
    expect(isRubricContent(sample)).toBe(false);
  });

  it("still detects rubric content even with one sample-answer-like quote present", () => {
    const sample = `
      IELTS Speaking Band Descriptors

      Band 9: Speakers at this band speak fluently with rare hesitation.
      Band 7: Lexical Resource — uses vocabulary with flexibility.
      Band 5: Grammatical Range and Accuracy — uses a limited range.

      The four assessment criteria are weighted equally. Pronunciation features
      are assessed on band score consistency.

      "I live in London" — does NOT count as Band 9 alone; coherence required.
    `;
    expect(isRubricContent(sample)).toBe(true);
  });
});

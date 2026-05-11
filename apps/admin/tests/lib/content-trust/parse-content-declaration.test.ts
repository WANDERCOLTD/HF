/**
 * Tests for parse-content-declaration.ts
 *
 * Covers both supported surface forms (YAML front-matter, blockquote
 * header), enum validation + warning behaviour, and the no-declaration
 * fallback path.
 */
import { describe, it, expect } from "vitest";
import { parseContentDeclaration } from "@/lib/content-trust/parse-content-declaration";

describe("parseContentDeclaration", () => {
  describe("YAML front-matter (Form A)", () => {
    it("parses a complete declaration", () => {
      const md = [
        "---",
        "hf-document-type: COURSE_REFERENCE",
        "hf-default-category: session_flow",
        "hf-audience: tutor-only",
        "hf-lo-system-role: TEACHING_INSTRUCTION",
        "hf-question-assessment-use: TUTOR_ONLY",
        "---",
        "",
        "# Title",
        "Body.",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.format).toBe("yaml");
      expect(result.hasDeclaration).toBe(true);
      expect(result.documentType).toBe("COURSE_REFERENCE");
      expect(result.defaultCategory).toBe("session_flow");
      expect(result.audience).toBe("tutor-only");
      expect(result.loSystemRole).toBe("TEACHING_INSTRUCTION");
      expect(result.questionAssessmentUse).toBe("TUTOR_ONLY");
      expect(result.sourceWarnings).toEqual([]);
    });

    it("tolerates quoted values, comments, and case variation", () => {
      const md = [
        "---",
        "# Educator-authored declaration",
        'hf-document-type: "QUESTION_BANK"',
        "hf-lo-system-role: 'TEACHING_INSTRUCTION'",
        "hf-audience: TUTOR-ONLY",
        "---",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.documentType).toBe("QUESTION_BANK");
      expect(result.loSystemRole).toBe("TEACHING_INSTRUCTION");
      expect(result.audience).toBe("tutor-only");
      expect(result.sourceWarnings).toEqual([]);
    });

    it("rejects invalid DocumentType with a warning, leaves field unset", () => {
      const md = [
        "---",
        "hf-document-type: BANANA",
        "hf-audience: tutor-only",
        "---",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.documentType).toBeUndefined();
      expect(result.audience).toBe("tutor-only");
      expect(result.hasDeclaration).toBe(true);
      expect(result.sourceWarnings).toHaveLength(1);
      expect(result.sourceWarnings[0]).toMatch(/BANANA/);
      expect(result.sourceWarnings[0]).toMatch(/DocumentType/);
    });

    it("rejects invalid LoSystemRole and AssessmentUse with warnings", () => {
      const md = [
        "---",
        "hf-lo-system-role: WHATEVER",
        "hf-question-assessment-use: FOR_FUN",
        "---",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.loSystemRole).toBeUndefined();
      expect(result.questionAssessmentUse).toBeUndefined();
      expect(result.hasDeclaration).toBe(false);
      expect(result.sourceWarnings).toHaveLength(2);
    });

    it("warns on unknown hf-* keys but accepts known ones", () => {
      const md = [
        "---",
        "hf-document-type: COURSE_REFERENCE",
        "hf-favourite-colour: blue",
        "---",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.documentType).toBe("COURSE_REFERENCE");
      expect(result.sourceWarnings.some((w) => w.includes("hf-favourite-colour"))).toBe(true);
    });
  });

  describe("Blockquote header (Form B)", () => {
    it("parses the IELTS tutor-briefing header verbatim", () => {
      const md = [
        "# IELTS Speaking — Tutor Briefing",
        "",
        "> **Document type:** COURSE_REFERENCE · **Intended assertion category:** `session_flow` / `session_metadata` / `skill_framework` (INSTRUCTION_CATEGORIES) · **LO systemRole if generated:** `TEACHING_INSTRUCTION` · **Audience: tutor-only**",
        "",
        "Body content here.",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.format).toBe("blockquote");
      expect(result.hasDeclaration).toBe(true);
      expect(result.documentType).toBe("COURSE_REFERENCE");
      // First category in the slash-list wins.
      expect(result.defaultCategory).toBe("session_flow");
      expect(result.loSystemRole).toBe("TEACHING_INSTRUCTION");
      expect(result.audience).toBe("tutor-only");
      expect(result.sourceWarnings).toEqual([]);
    });

    it("parses the assessor-rubric header with TUTOR_ONLY question use", () => {
      const md = [
        "# IELTS Speaking — Assessor Rubric",
        "",
        "> **Document type:** COURSE_REFERENCE · **Intended assertion category:** `assessment_guidance` / `assessment_approach` (INSTRUCTION_CATEGORIES) · **LO systemRole if generated:** `ASSESSOR_RUBRIC` · **Question assessmentUse if generated:** `TUTOR_ONLY` · **Audience: assessor / scoring loop only**",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.documentType).toBe("COURSE_REFERENCE");
      expect(result.defaultCategory).toBe("assessment_guidance");
      expect(result.loSystemRole).toBe("ASSESSOR_RUBRIC");
      expect(result.questionAssessmentUse).toBe("TUTOR_ONLY");
      // "assessor / scoring loop only" is not a known audience value → warning,
      // audience left unset rather than corrupted.
      expect(result.audience).toBeUndefined();
      expect(result.sourceWarnings.length).toBeGreaterThan(0);
    });

    it("parses the question-bank header with QUESTION_BANK + FORMATIVE", () => {
      const md = [
        "# IELTS Speaking Question Bank — Part 1",
        "",
        "> **Document type:** QUESTION_BANK · **Intended classification:** practice prompts for the Part 1 module · **Question type:** TUTOR_QUESTION · **Assessment use:** FORMATIVE · **Bloom:** APPLY",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.documentType).toBe("QUESTION_BANK");
      expect(result.questionAssessmentUse).toBe("FORMATIVE");
      expect(result.hasDeclaration).toBe(true);
    });

    it("tolerates multi-line wrapped blockquotes", () => {
      const md = [
        "# Title",
        "",
        "> **Document type:** TEXTBOOK",
        "> · **Audience: learner**",
      ].join("\n");

      const result = parseContentDeclaration(md);

      expect(result.documentType).toBe("TEXTBOOK");
      expect(result.audience).toBe("learner");
    });
  });

  describe("No declaration / passthrough", () => {
    it("returns empty declaration when neither form is present", () => {
      const md = "# Some Heading\n\nJust prose. No declaration at all.";
      const result = parseContentDeclaration(md);

      expect(result.hasDeclaration).toBe(false);
      expect(result.documentType).toBeUndefined();
      expect(result.audience).toBeUndefined();
      expect(result.sourceWarnings).toEqual([]);
      expect(result.format).toBeUndefined();
    });

    it("returns empty declaration on empty / non-string input", () => {
      expect(parseContentDeclaration("")).toEqual({ sourceWarnings: [], hasDeclaration: false });
      // @ts-expect-error — runtime safety
      expect(parseContentDeclaration(null)).toEqual({ sourceWarnings: [], hasDeclaration: false });
    });

    it("ignores a blockquote that is not the first block after the heading", () => {
      const md = [
        "# Title",
        "",
        "Some intro paragraph.",
        "",
        "> **Document type:** COURSE_REFERENCE",
      ].join("\n");

      const result = parseContentDeclaration(md);
      // First block after heading is prose, not the declaration blockquote.
      expect(result.documentType).toBeUndefined();
      expect(result.hasDeclaration).toBe(false);
    });

    it("YAML form takes precedence when both are present", () => {
      const md = [
        "---",
        "hf-document-type: QUESTION_BANK",
        "---",
        "",
        "# Title",
        "",
        "> **Document type:** TEXTBOOK",
      ].join("\n");

      const result = parseContentDeclaration(md);
      expect(result.format).toBe("yaml");
      expect(result.documentType).toBe("QUESTION_BANK");
    });
  });
});

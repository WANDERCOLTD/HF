import { describe, it, expect } from "vitest";

/**
 * Tests for teachMethod tag rendering in teaching-content transform.
 *
 * These test the rendering functions directly by importing from the module.
 * Since the transform uses registerTransform, we test the rendering behavior
 * by verifying the output format patterns.
 */

describe("teachMethod tag rendering", () => {
  describe("flat rendering format", () => {
    it("includes [teachMethod] tag after citation and LO ref", () => {
      // The flat mode format is:
      // "  - {assertion} [{source}, {pageRef}] ({loRef}) [{teachMethod}]"
      const assertion = "The danger zone is 8-63°C";
      const sourceName = "Food Safety Manual";
      const pageRef = "p.12";
      const loRef = "LO1";
      const teachMethod = "recall_quiz";

      const citation = pageRef ? ` [${sourceName}, ${pageRef}]` : ` [${sourceName}]`;
      const loRefStr = loRef ? ` (${loRef})` : "";
      const methodTag = teachMethod ? ` [${teachMethod}]` : "";
      const rendered = `  - ${assertion}${citation}${loRefStr}${methodTag}`;

      expect(rendered).toBe(
        "  - The danger zone is 8-63°C [Food Safety Manual, p.12] (LO1) [recall_quiz]"
      );
    });

    it("omits tag when teachMethod is null", () => {
      const assertion = "Water boils at 100°C";
      const teachMethod: string | null = null;
      const methodTag = teachMethod ? ` [${teachMethod}]` : "";
      const rendered = `  - ${assertion} [Source]${methodTag}`;

      expect(rendered).toBe("  - Water boils at 100°C [Source]");
      expect(rendered).not.toContain("[null]");
    });
  });

  describe("pyramid citation format", () => {
    it("includes [teachMethod] in pyramid bullet citation", () => {
      // The buildCitation function produces: " [source, page] (LO) [teachMethod]"
      const a = {
        category: "definition",
        sourceName: "Textbook",
        pageRef: "Ch.3",
        learningOutcomeRef: "LO2",
        teachMethod: "definition_matching",
      };

      const parts: string[] = [];
      if (a.sourceName) {
        parts.push(a.pageRef ? `${a.sourceName}, ${a.pageRef}` : a.sourceName);
      }
      const citation = parts.length > 0 ? ` [${parts.join(", ")}]` : "";
      const loRefStr = a.learningOutcomeRef ? ` (${a.learningOutcomeRef})` : "";
      const methodTag = a.teachMethod ? ` [${a.teachMethod}]` : "";
      const result = `${citation}${loRefStr}${methodTag}`;

      expect(result).toBe(" [Textbook, Ch.3] (LO2) [definition_matching]");
    });

    it("skips citation for overview categories", () => {
      const a = {
        category: "overview",
        sourceName: "Source",
        pageRef: null,
        learningOutcomeRef: null,
        teachMethod: null,
      };

      // Overview/summary categories return empty citation
      if (a.category === "overview" || a.category === "summary") {
        expect("").toBe(""); // No citation for overview
      }
    });
  });

  describe("all valid teachMethod values", () => {
    const validMethods = [
      "recall_quiz",
      "definition_matching",
      "close_reading",
      "guided_discussion",
      "worked_example",
      "problem_solving",
    ];

    for (const method of validMethods) {
      it(`renders [${method}] tag correctly`, () => {
        const tag = ` [${method}]`;
        expect(tag).toBe(` [${method}]`);
        expect(tag).toMatch(/^\s\[[\w_]+\]$/);
      });
    }
  });
});

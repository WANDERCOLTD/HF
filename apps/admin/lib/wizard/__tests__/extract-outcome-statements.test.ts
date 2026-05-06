/**
 * Tests for extractOutcomeStatements (#258).
 *
 * Parses `**OUT-NN: <statement>.**` bold headings out of a Course Reference
 * markdown body into a Record<id, statement> map. Tolerates variant
 * whitespace, optional trailing periods, and outcome ID widths.
 */

import { describe, it, expect } from "vitest";
import { extractOutcomeStatements } from "@/lib/wizard/detect-authored-modules";

describe("extractOutcomeStatements", () => {
  it("returns empty object when no OUT-NN headings exist", () => {
    const md = `# Some doc\n\nNo outcome headings here.\n\nOUT-01 in prose isn't a heading.\n`;
    expect(extractOutcomeStatements(md)).toEqual({});
  });

  it("extracts a single statement on its own line", () => {
    const md = `before\n**OUT-01: Extends every answer to the minimum length expected for Part 1.**\nafter`;
    expect(extractOutcomeStatements(md)).toEqual({
      "OUT-01": "Extends every answer to the minimum length expected for Part 1",
    });
  });

  it("extracts multiple statements", () => {
    const md = [
      "**OUT-01: Extends every answer to the minimum length expected for Part 1.**",
      "",
      "Body prose.",
      "",
      "**OUT-02: Selects the framework opening matched to the question type.**",
      "**OUT-24: Improves pronunciation on 2–3 targeted problem sounds.**",
    ].join("\n");

    const out = extractOutcomeStatements(md);
    expect(Object.keys(out)).toEqual(["OUT-01", "OUT-02", "OUT-24"]);
    expect(out["OUT-02"]).toBe("Selects the framework opening matched to the question type");
    expect(out["OUT-24"]).toBe("Improves pronunciation on 2–3 targeted problem sounds");
  });

  it("strips a trailing period from the statement", () => {
    const md = `**OUT-05: Produces natural 2–3 sentence Part 1 answers.**`;
    expect(extractOutcomeStatements(md)["OUT-05"]).toBe(
      "Produces natural 2–3 sentence Part 1 answers",
    );
  });

  it("preserves a statement with no trailing period", () => {
    const md = `**OUT-09: Open-ended outcome with no period**`;
    expect(extractOutcomeStatements(md)["OUT-09"]).toBe(
      "Open-ended outcome with no period",
    );
  });

  it("ignores OUT-NN references inline in prose (not bold-on-its-own-line)", () => {
    const md = `*Outcomes served:* OUT-01, OUT-02, OUT-05.\n\nInline mention of **OUT-01** is also ignored unless followed by ': statement'.`;
    expect(extractOutcomeStatements(md)).toEqual({});
  });

  it("tolerates extra surrounding whitespace", () => {
    const md = `   **OUT-07:    Demonstrates confidence on the four most common Part 1 topic clusters.**   \n`;
    expect(extractOutcomeStatements(md)["OUT-07"]).toBe(
      "Demonstrates confidence on the four most common Part 1 topic clusters",
    );
  });

  it("later occurrence wins on duplicate IDs", () => {
    const md = [
      "**OUT-01: First definition.**",
      "**OUT-01: Refined definition that supersedes the first.**",
    ].join("\n");
    expect(extractOutcomeStatements(md)["OUT-01"]).toBe(
      "Refined definition that supersedes the first",
    );
  });
});

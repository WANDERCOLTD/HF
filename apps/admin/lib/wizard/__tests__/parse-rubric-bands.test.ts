import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseRubricBands } from "@/lib/wizard/parse-rubric-bands";

describe("parseRubricBands — synthetic input", () => {
  it("parses a single RUB heading + 10-band table", () => {
    const md = `# Rubric

Some intro text.

## RUB-FC: Fluency and Coherence — band descriptors

| Band | Descriptor |
| ---- | ---------- |
| 9 | Fluent with only very occasional repetition. |
| 8 | Fluent with only very occasional repetition. |
| 7 | Keeps going and produces long turns without noticeable effort. |
| 6 | Keeps going and produces long turns. |
| 5 | Usually keeps going but relies on repetition. |
| 4 | Unable to keep going without noticeable pauses. |
| 3 | Frequent, sometimes long pauses. |
| 2 | Lengthy pauses before nearly every word. |
| 1 | Essentially none. Speech is totally incoherent. |
| 0 | Does not attend / does not complete. |
`;
    const r = parseRubricBands(md);
    expect(r.criteria).toHaveLength(1);
    expect(r.criteria[0].code).toBe("fc");
    expect(r.criteria[0].criterionName).toBe("Fluency and Coherence — band descriptors");
    expect(Object.keys(r.criteria[0].bands)).toHaveLength(10);
    expect(r.criteria[0].bands["9"]).toContain("Fluent");
    expect(r.criteria[0].bands["0"]).toContain("Does not attend");
    expect(r.warnings).toHaveLength(0);
  });

  it("parses multiple RUB headings independently", () => {
    const md = `## RUB-FC: Fluency

| Band | Descriptor |
| 9 | Top FC band descriptor |
| 5 | Mid FC band descriptor |

## RUB-LR: Lexical Resource

| Band | Descriptor |
| 9 | Top LR band descriptor |
| 5 | Mid LR band descriptor |
`;
    const r = parseRubricBands(md);
    expect(r.criteria).toHaveLength(2);
    expect(r.criteria[0].code).toBe("fc");
    expect(r.criteria[1].code).toBe("lr");
    expect(r.criteria[0].bands["9"]).toContain("Top FC");
    expect(r.criteria[1].bands["9"]).toContain("Top LR");
  });

  it("stops parsing a section at a non-RUB H2 boundary", () => {
    const md = `## RUB-FC: Fluency

| Band | Descriptor |
| 9 | Stays in scope |

## Scoring rules (assessor-only)

| Band | Descriptor |
| 9 | NOT a band table — should be ignored |
`;
    const r = parseRubricBands(md);
    expect(r.criteria).toHaveLength(1);
    expect(r.criteria[0].bands["9"]).toBe("Stays in scope");
  });

  it("warns when a RUB heading has no following band table", () => {
    const md = `## RUB-FC: Fluency

Some prose but no table.

## RUB-LR: Lexical

| Band | Descriptor |
| 9 | Has bands |
`;
    const r = parseRubricBands(md);
    expect(r.criteria).toHaveLength(1);
    expect(r.criteria[0].code).toBe("lr");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("RUB-FC");
  });

  it("skips alignment + header rows", () => {
    const md = `## RUB-FC: Fluency

| Band | Descriptor |
| ---- | ---------- |
| 9 | Real descriptor here |
`;
    const r = parseRubricBands(md);
    expect(Object.keys(r.criteria[0].bands)).toEqual(["9"]);
  });

  it("returns empty result for input with no RUB headings", () => {
    const r = parseRubricBands("# Just a doc\n\nNo rubric content.");
    expect(r.criteria).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("handles decimal band numbers (e.g. half-bands)", () => {
    const md = `## RUB-FC: Fluency

| Band | Descriptor |
| 6.5 | Half-band descriptor |
| 7 | Whole-band descriptor |
`;
    const r = parseRubricBands(md);
    expect(r.criteria[0].bands["6.5"]).toContain("Half");
    expect(r.criteria[0].bands["7"]).toContain("Whole");
  });
});

describe("parseRubricBands — real IELTS rubric", () => {
  const rubricPath = path.resolve(
    __dirname,
    "../../../../docs/external/ielts/ielts-speaking/Upload Docs/assessor-rubric.md",
  );

  it.runIf(fs.existsSync(rubricPath))(
    "parses 4 criteria × 10 bands from the live IELTS rubric file",
    () => {
      const text = fs.readFileSync(rubricPath, "utf-8");
      const r = parseRubricBands(text);
      expect(r.criteria.map((c) => c.code)).toEqual(["fc", "lr", "gra", "p"]);
      for (const c of r.criteria) {
        expect(
          Object.keys(c.bands),
          `${c.code} should have at least 10 bands`,
        ).toEqual(expect.arrayContaining(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]));
      }
      expect(r.warnings).toHaveLength(0);
    },
  );
});

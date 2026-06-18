/**
 * parse-source-content.test.ts (#1850 P3f)
 *
 * Unit tests for the per-format parsers.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseCueCardBank,
  parseProfileFields,
  parseStallScaffolds,
  parseTopicPool,
} from "../parse-source-content";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

describe("parseCueCardBank — IELTS Part 2 question bank", () => {
  const text = readFileSync(
    join(
      REPO_ROOT,
      "docs",
      "external",
      "ielts",
      "ielts-speaking",
      "Upload Docs",
      "ielts-speaking-question-bank-part2.md",
    ),
    "utf-8",
  );

  it("parses every card with a non-empty topic + bullet list", () => {
    const cards = parseCueCardBank(text);
    expect(cards.length).toBeGreaterThanOrEqual(80);
    for (const c of cards) {
      expect(c.topic.length).toBeGreaterThan(0);
      expect(c.bullets.length).toBeGreaterThan(0);
    }
  });

  it("extracts the canonical first card cleanly", () => {
    const cards = parseCueCardBank(text);
    expect(cards[0]).toEqual({
      topic: "Family member you admire",
      bullets: ["who this person is", "how often you see them", "what kind of personality they have"],
    });
  });

  it("returns empty when no cards are present", () => {
    expect(parseCueCardBank("# Some doc\n\nNo cards here.\n")).toEqual([]);
  });

  it("skips the 'Describe …' verb-line and the 'and explain …' closer", () => {
    const cards = parseCueCardBank(text);
    for (const c of cards) {
      for (const b of c.bullets) {
        expect(b).not.toMatch(/^describe\b/i);
        expect(b).not.toMatch(/^and\s+explain\b/i);
        expect(b).not.toMatch(/^you should say:?$/i);
      }
    }
  });
});

describe("parseStallScaffolds — IELTS Part 2 + Part 3 scaffolds", () => {
  it("parses the Part 2 monologue pool into flat strings (tag dropped)", () => {
    const text = readFileSync(
      join(
        REPO_ROOT,
        "docs",
        "external",
        "ielts",
        "ielts-speaking",
        "stall-scaffolds-monologue.md",
      ),
      "utf-8",
    );
    const items = parseStallScaffolds(text);
    expect(items.length).toBe(14);
    expect(items[0]).toBe("Take another moment.");
    expect(items[1]).toBe("Take your time.");
    // Item 14 carries a trailing italic parenthetical; it must be stripped.
    expect(items[13]).toBe("Mm.");
    // No item should be empty or carry a markdown bullet/asterisks.
    for (const s of items) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toContain("*");
    }
  });

  it("parses the Part 3 discussion pool", () => {
    const text = readFileSync(
      join(
        REPO_ROOT,
        "docs",
        "external",
        "ielts",
        "ielts-speaking",
        "stall-scaffolds-discussion.md",
      ),
      "utf-8",
    );
    const items = parseStallScaffolds(text);
    expect(items.length).toBe(15);
    expect(items[0]).toBe("Take your time.");
    expect(items[4]).toBe("Could you give an example?");
  });

  it("returns empty when no Scaffold pool section is present", () => {
    expect(parseStallScaffolds("# A doc without the section.\n")).toEqual([]);
  });
});

// #1932 (epic #1931 Template Authority) — Part 1 + Part 3 question banks
// normalise to a single `Array<{ topic, questions[] }>` shape.

describe("parseTopicPool — IELTS Part 1 + Part 3 question banks", () => {
  it("parses Part 1 `## Frame N — Topic` format", () => {
    const text = [
      "# Bank",
      "",
      "## Frame 1 — Home town / village",
      "",
      "_Let's talk about your home town or village._",
      "",
      "1. What kind of place is it?",
      "2. What's the most interesting part of your town?",
      "3. Has your home town changed much since you were a child?",
      "",
      "_(source: ielts.org official sample — `speaking-sample-tasks-2023.pdf`, p. 3.)_",
      "",
      "---",
      "",
      "## Frame 2 — Accommodation",
      "",
      "1. Tell me about the kind of accommodation you live in.",
      "2. How long have you lived there?",
      "",
    ].join("\n");

    const out = parseTopicPool(text);
    expect(out.length).toBe(2);
    expect(out[0].topic).toBe("Home town / village");
    expect(out[0].questions).toEqual([
      "What kind of place is it?",
      "What's the most interesting part of your town?",
      "Has your home town changed much since you were a child?",
    ]);
    expect(out[1].topic).toBe("Accommodation");
    expect(out[1].questions.length).toBe(2);
  });

  it("parses Part 3 `## Theme: / ### Set N — Title` format (Theme is grouping, Set is topic)", () => {
    const text = [
      "# Bank",
      "",
      "## Theme: Society and generations",
      "",
      "### Set 1 — Possessions and status (linked to Part 2 \"Object\" cards)",
      "",
      "_Let's consider how people's values have changed._",
      "",
      "1. What kind of things give status?",
      "2. Have things changed since your parents' time?",
      "",
      "### Set 2 — Generational differences",
      "",
      "1. In what ways are young people different?",
      "2. Why do you think those differences exist?",
      "3. Do older and younger people generally get on well?",
      "",
      "## Theme: Education",
      "",
      "### Set 3 — Schooling",
      "",
      "1. How important is formal schooling?",
      "",
    ].join("\n");

    const out = parseTopicPool(text);
    expect(out.length).toBe(3);
    expect(out[0].topic).toBe('Possessions and status (linked to Part 2 "Object" cards)');
    expect(out[0].questions).toEqual([
      "What kind of things give status?",
      "Have things changed since your parents' time?",
    ]);
    expect(out[1].topic).toBe("Generational differences");
    expect(out[1].questions.length).toBe(3);
    expect(out[2].topic).toBe("Schooling");
    expect(out[2].questions.length).toBe(1);
  });

  it("drops topics that produced zero questions (defensive)", () => {
    const text = [
      "## Frame 1 — Empty frame",
      "",
      "_no question list — just prose._",
      "",
      "## Frame 2 — Real frame",
      "",
      "1. A real question?",
      "",
    ].join("\n");
    const out = parseTopicPool(text);
    expect(out.length).toBe(1);
    expect(out[0].topic).toBe("Real frame");
  });

  it("returns empty for an empty doc", () => {
    expect(parseTopicPool("")).toEqual([]);
    expect(parseTopicPool("# A doc with no topic blocks.\n")).toEqual([]);
  });

  it("parses the real Part 1 question-bank file end-to-end", () => {
    const text = readFileSync(
      join(__dirname, "..", "..", "..", "..", "..", "docs", "external", "ielts", "ielts-speaking", "Upload Docs", "ielts-speaking-question-bank-part1.md"),
      "utf-8",
    );
    const out = parseTopicPool(text);
    // 52 `## Frame N` topics live in the file.
    expect(out.length).toBeGreaterThanOrEqual(50);
    expect(out.length).toBeLessThanOrEqual(52);
    for (const t of out) {
      expect(t.topic.length).toBeGreaterThan(0);
      expect(t.questions.length).toBeGreaterThan(0);
    }
  });

  it("parses the real Part 3 question-bank file end-to-end", () => {
    const text = readFileSync(
      join(__dirname, "..", "..", "..", "..", "..", "docs", "external", "ielts", "ielts-speaking", "Upload Docs", "ielts-speaking-question-bank-part3.md"),
      "utf-8",
    );
    const out = parseTopicPool(text);
    // 64 `### Set N` topics under 13 `## Theme:` parents — Theme lines
    // are NOT topics so the count matches Set headings.
    expect(out.length).toBeGreaterThanOrEqual(60);
    expect(out.length).toBeLessThanOrEqual(64);
    for (const t of out) {
      expect(t.topic.length).toBeGreaterThan(0);
      expect(t.questions.length).toBeGreaterThan(0);
    }
  });
});

describe("parseProfileFields — IELTS Baseline profile fields", () => {
  const text = readFileSync(
    join(
      REPO_ROOT,
      "docs",
      "external",
      "ielts",
      "ielts-speaking",
      "Upload Docs",
      "ielts-speaking-profile-fields.md",
    ),
    "utf-8",
  );

  it("parses the four canonical fields in source order", () => {
    const fields = parseProfileFields(text);
    expect(fields).toHaveLength(4);
    expect(fields[0].key).toBe("profile:reason");
    expect(fields[1].key).toBe("profile:targetBand");
    expect(fields[2].key).toBe("profile:timeline");
    expect(fields[3].key).toBe("profile:selfLevel");
  });

  it("extracts the verbatim prompt + type for the band field", () => {
    const fields = parseProfileFields(text);
    const band = fields.find((f) => f.key === "profile:targetBand");
    expect(band).toBeDefined();
    expect(band!.type).toBe("band");
    expect(band!.prompt).toBe("What band score are you aiming for?");
  });

  it("each field carries non-empty key + prompt + valid type", () => {
    const fields = parseProfileFields(text);
    for (const f of fields) {
      expect(f.key.length).toBeGreaterThan(0);
      expect(f.prompt.length).toBeGreaterThan(0);
      expect(["text", "number", "band"]).toContain(f.type);
    }
  });

  it("returns empty when no field headers are present", () => {
    expect(parseProfileFields("# A doc with no fields\n\nSome prose.\n")).toEqual([]);
  });

  it("drops a field missing prompt", () => {
    const partial = [
      "### Field 1 — incomplete",
      "",
      "- **key:** `profile:x`",
      "- **type:** text",
      "",
      "### Field 2 — complete",
      "",
      "- **key:** `profile:y`",
      "- **type:** text",
      "- **prompt:** What about Y?",
      "",
    ].join("\n");
    const fields = parseProfileFields(partial);
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("profile:y");
  });

  it("drops a field with an invalid type", () => {
    const bad = [
      "### Field 1 — bad type",
      "",
      "- **key:** `profile:x`",
      "- **type:** integer",
      "- **prompt:** What is X?",
      "",
    ].join("\n");
    expect(parseProfileFields(bad)).toEqual([]);
  });

  it("parses 'number' and 'text' types alongside 'band'", () => {
    const mixed = [
      "### Field 1 — text field",
      "",
      "- **key:** `profile:a`",
      "- **type:** text",
      "- **prompt:** A?",
      "",
      "### Field 2 — number field",
      "",
      "- **key:** `profile:b`",
      "- **type:** number",
      "- **prompt:** B?",
      "",
      "### Field 3 — band field",
      "",
      "- **key:** `profile:c`",
      "- **type:** band",
      "- **prompt:** C?",
      "",
    ].join("\n");
    const fields = parseProfileFields(mixed);
    expect(fields).toHaveLength(3);
    expect(fields.map((f) => f.type)).toEqual(["text", "number", "band"]);
  });

  it("ignores prose outside Field blocks", () => {
    const mixed = [
      "# Header",
      "",
      "Some intro prose with `- **key:**` looking text in a code block.",
      "",
      "### Field 1 — real",
      "",
      "- **key:** `profile:real`",
      "- **type:** text",
      "- **prompt:** What is real?",
      "",
      "## Footer notes",
      "",
      "- **key:** `profile:ignored` (this is in a different ## section)",
    ].join("\n");
    const fields = parseProfileFields(mixed);
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("profile:real");
  });
});

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

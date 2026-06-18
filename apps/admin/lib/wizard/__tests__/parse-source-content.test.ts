/**
 * parse-source-content.test.ts (#1850 P3f)
 *
 * Unit tests for the per-format parsers.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCueCardBank, parseStallScaffolds } from "../parse-source-content";

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

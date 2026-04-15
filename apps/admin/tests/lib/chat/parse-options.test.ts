import { describe, it, expect } from "vitest";
import { parseOptionsFromText, stripParameterTags, type ParsedOption } from "@/lib/chat/parse-options";

describe("parseOptionsFromText", () => {
  // ── Numbered options ────────────────────────────────

  it("parses numbered options with period", () => {
    const text = "Which would you prefer?\n1. Grammar\n2. Vocabulary\n3. Pronunciation";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ marker: "1", label: "Grammar" });
    expect(result[1]).toMatchObject({ marker: "2", label: "Vocabulary" });
    expect(result[2]).toMatchObject({ marker: "3", label: "Pronunciation" });
  });

  it("parses numbered options with parenthesis", () => {
    const text = "1) Upload content\n2) Skip for now";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Upload content");
    expect(result[1].label).toBe("Skip for now");
  });

  it("parses numbered options with dash separator", () => {
    const text = "1 - Grammar\n2 - Vocabulary";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Grammar");
  });

  it("extracts short labels from descriptions", () => {
    const text = "1. Grammar — practice sentence structures\n2. Vocabulary — learn new words\n3. Reading — comprehension exercises";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Grammar");
    expect(result[0].fullText).toBe("Grammar — practice sentence structures");
    expect(result[1].label).toBe("Vocabulary");
  });

  it("handles colon descriptions", () => {
    const text = "1. Socratic: ask guiding questions\n2. Direct: explain clearly\n3. Discovery: let them explore";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Socratic");
    expect(result[1].label).toBe("Direct");
  });

  // ── Lettered options ────────────────────────────────

  it("parses uppercase lettered options", () => {
    const text = "A. Keep as is\nB. Change something";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ marker: "A", label: "Keep as is" });
    expect(result[1]).toMatchObject({ marker: "B", label: "Change something" });
  });

  it("parses lowercase lettered options with parenthesis", () => {
    const text = "a) Grammar\nb) Vocabulary\nc) Reading";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ marker: "a", label: "Grammar" });
  });

  // ── Prefixed options ────────────────────────────────

  it("parses 'Option N:' pattern", () => {
    const text = "Option 1: Upload materials\nOption 2: Skip for now";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Upload materials");
  });

  it("parses 'Choice A:' pattern", () => {
    const text = "Choice A: Socratic approach\nChoice B: Direct instruction";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Socratic approach");
  });

  // ── Bulleted options ────────────────────────────────

  it("parses dash-bulleted options", () => {
    const text = "Here are your choices:\n- Grammar\n- Vocabulary\n- Pronunciation";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ marker: "•", label: "Grammar" });
  });

  it("parses unicode bullet options", () => {
    const text = "• Upload content\n• Skip for now";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Upload content");
  });

  it("parses asterisk-bulleted options", () => {
    const text = "* Socratic\n* Direct\n* Discovery";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Socratic");
  });

  // ── Edge cases: should return empty ─────────────────

  it("returns empty for single option (not a choice)", () => {
    const text = "1. Grammar";
    expect(parseOptionsFromText(text)).toEqual([]);
  });

  it("returns empty for plain text with no options", () => {
    const text = "Let's start with grammar today. I recommend the socratic approach.";
    expect(parseOptionsFromText(text)).toEqual([]);
  });

  it("returns empty for non-contiguous numbers", () => {
    const text = "1. Foo\n\nSome paragraph in between.\n\n2. Bar";
    expect(parseOptionsFromText(text)).toEqual([]);
  });

  it("returns empty for non-consecutive numbering", () => {
    const text = "1. Grammar\n3. Vocabulary\n5. Pronunciation";
    expect(parseOptionsFromText(text)).toEqual([]);
  });

  it("returns empty for non-consecutive lettering", () => {
    const text = "A. Grammar\nC. Vocabulary";
    expect(parseOptionsFromText(text)).toEqual([]);
  });

  it("returns empty for more than 10 options", () => {
    const lines = Array.from({ length: 11 }, (_, i) => `${i + 1}. Option ${i + 1}`);
    expect(parseOptionsFromText(lines.join("\n"))).toEqual([]);
  });

  // ── Mixed prose + list ──────────────────────────────

  it("parses options embedded in prose", () => {
    const text = "Would you like to focus on:\n1. Grammar\n2. Vocabulary\n3. Pronunciation\nLet me know!";
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Grammar");
  });

  it("ignores inline mentions that look like options", () => {
    // "I recommend option 1 or option 2" — no newlines, not a list
    const text = "I recommend option 1 or option 2 for this lesson.";
    expect(parseOptionsFromText(text)).toEqual([]);
  });

  // ── XML parameter tags ──────────────────────────────

  it("parses <parameter name='options'> XML tags", () => {
    const text = `Teaching materials uploaded\n<parameter name="options">[ {"value": "PAW10", "label": "Create new PAW10 course", "description": "Set up PAW10 as a fresh course.", "recommended": true}, {"value": "PAW8", "label": "Update existing PAW8", "description": "Modify PAW8 with new materials."} ]</parameter>`;
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ marker: "1", label: "Create new PAW10 course" });
    expect(result[0].description).toBe("Set up PAW10 as a fresh course.");
    expect(result[1]).toMatchObject({ marker: "2", label: "Update existing PAW8" });
  });

  it("ignores malformed parameter tags", () => {
    const text = `<parameter name="options">not valid json</parameter>`;
    expect(parseOptionsFromText(text)).toEqual([]);
  });

  // ── stripParameterTags ─────────────────────────────

  it("strips parameter tags from text", () => {
    const text = `Here are your options:\n<parameter name="options">[{"value":"a","label":"A"}]</parameter>`;
    expect(stripParameterTags(text)).toBe("Here are your options:");
  });

  it("preserves text without parameter tags", () => {
    expect(stripParameterTags("Hello world")).toBe("Hello world");
  });

  // ── Label truncation ────────────────────────────────

  it("truncates very long labels", () => {
    const longOption = "A".repeat(80);
    const text = `1. ${longOption}\n2. Short`;
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0].label.length).toBeLessThanOrEqual(60);
    expect(result[0].label).toContain("\u2026");
  });

  // ── Bold-prefixed fallback removal (2026-04-15 regression fix) ──
  //
  // The April 1 wizard prompt mandated bolding the opening concept of every
  // sentence/bullet. That made the old `parseBoldPrefixedOptions` fallback
  // misfire on summary messages — it extracted section headings as chip
  // labels, so a yes/no question like "Does that capture how you want me to
  // teach?" rendered chips like "Question bank" / "Course reference guide"
  // instead of "Yes, that's right" / "I'd change something". The fallback
  // was removed; show_suggestions is now the authoritative path for chips.

  it("does NOT extract chips from bold-prefixed section headings (#155 smoke test)", () => {
    const text = `Perfect! I've pulled together the teaching methodology from your course reference.

**Socratic questioning** — the core approach. The AI teaches through guided questioning and scaffolding, never by supplying themes directly.

**Skills framework** — students start with basic plot recall, then move to distinguishing plot from theme, then to articulating themes with supporting evidence from the text.

**Assessment focuses on mastery criteria** like recalling themes without plot-only answers and connecting them to specific textual moments.

Does that capture how you want me to teach?`;
    const result = parseOptionsFromText(text);
    expect(result).toEqual([]);
  });

  it("does NOT extract chips from bold-prefixed upload summaries (Secret Garden smoke test)", () => {
    const text = `I can see what you uploaded:

**Secret Garden Chapter 1 passage** — the literary text the student will read before each call.
**Question bank** — practice material with structured questions and model responses.
**Course reference guide** — your detailed teaching methodology.

Does that capture how you want me to teach?`;
    const result = parseOptionsFromText(text);
    expect(result).toEqual([]);
  });

  it("still extracts chips from explicit numbered lists even when bold is present", () => {
    const text = `Some **bold prose** with highlights. Here are your options:
1. Continue with the current plan
2. Start over from scratch`;
    const result = parseOptionsFromText(text);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Continue with the current plan");
    expect(result[1].label).toBe("Start over from scratch");
  });
});

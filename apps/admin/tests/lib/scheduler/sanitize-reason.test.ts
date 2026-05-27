/**
 * Unit tests for `sanitizeReason()` — the learner-facing sanitizer applied to
 * the scheduler's `reason` narrative before it reaches the SimProgressPanel.
 *
 * #917 Slice 2 — see issue for full AC list.
 */

import { describe, it, expect } from "vitest";
import { sanitizeReason } from "@/lib/scheduler/sanitize-reason";

describe("sanitizeReason", () => {
  it("returns null for empty input", () => {
    expect(sanitizeReason("")).toBeNull();
  });

  it("strips tag-shaped content before identifiers", () => {
    // The script-tag content collapses to whitespace; the surrounding prose
    // remains. Result must contain no `<` or `>`.
    const out = sanitizeReason(
      "<script>alert(1)</script>foo bar baz qux quux quuz",
    );
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("foo bar baz qux quux quuz");
  });

  it("strips UUIDs", () => {
    const out = sanitizeReason(
      "Reviewing playbookId f17d8616-3c31-4814-8de1-626fb42f16f6 weak LOs from last call",
    );
    expect(out).not.toBeNull();
    expect(out).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(out).toContain("Reviewing");
    expect(out).toContain("weak LOs");
  });

  it("strips spec-slug-shaped patterns", () => {
    const out = sanitizeReason(
      "Module MOD-PART1-001 weak performance on recent call",
    );
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/\b[A-Z]+-[A-Z0-9]+-\d{3}\b/);
    expect(out).toContain("Module");
    expect(out).toContain("weak performance");
  });

  it("truncates long input to 137 chars at last word boundary, appends ellipsis", () => {
    // Build a deterministic 200-char input made of words.
    const word = "elephants ";
    const long = word.repeat(25).trim(); // 25 * 10 = 250 → trimmed to 249, plenty
    const out = sanitizeReason(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(138); // 137 chars + 1 ellipsis char
    expect(out!.endsWith("…")).toBe(true);
    // No mid-word cut: the character before the ellipsis must NOT be a letter
    // followed by a partial word (i.e. the part before "…" ends on a full word).
    const beforeEllipsis = out!.slice(0, -1);
    expect(beforeEllipsis.endsWith(" ")).toBe(false); // trimmed
    expect(beforeEllipsis.split(" ").pop()).toBe("elephants");
  });

  it("returns null when post-sanitize length is below the useful threshold", () => {
    // Pure slug strips to nothing.
    expect(sanitizeReason("[GUARD-001]")).toBeNull();
  });

  it("returns null when input is entirely a UUID", () => {
    expect(sanitizeReason("f17d8616-3c31-4814-8de1-626fb42f16f6")).toBeNull();
  });

  it("passes through normal natural-language reasons unchanged", () => {
    const reason = "You're 70% mastered on Module 1. Reviewing weak LO.";
    expect(sanitizeReason(reason)).toBe(reason);
  });

  it("collapses runs of whitespace", () => {
    const out = sanitizeReason("Hello    world   foo   bar  baz  qux");
    expect(out).toBe("Hello world foo bar baz qux");
  });
});

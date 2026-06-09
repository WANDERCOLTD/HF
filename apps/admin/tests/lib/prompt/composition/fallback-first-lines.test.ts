/**
 * Tests for `lib/prompt/composition/defaults/fallback-first-lines.ts`
 * (#1385). Pins the contract that the rehomed voice-fallback literals
 * stay byte-equal to what shipped pre-rollback — so VAPI behaviour is
 * net-zero — and that the `noActivePromptFirstLine` interpolation
 * handles name presence/absence the same way the inline templates did.
 */

import { describe, expect, it } from "vitest";

import {
  UNKNOWN_CALLER_FIRST_LINE,
  noActivePromptFirstLine,
} from "@/lib/prompt/composition/defaults/fallback-first-lines";

describe("UNKNOWN_CALLER_FIRST_LINE", () => {
  it("is the byte-equal string the inline literals used pre-rollback", () => {
    expect(UNKNOWN_CALLER_FIRST_LINE).toBe(
      "Hello! I don't think we've spoken before. What's your name?",
    );
  });

  it("is a non-empty string (VAPI dead-airs on empty firstMessage)", () => {
    expect(UNKNOWN_CALLER_FIRST_LINE.length).toBeGreaterThan(0);
  });
});

describe("noActivePromptFirstLine", () => {
  it("emits the name-bearing greeting when a name is supplied", () => {
    expect(noActivePromptFirstLine("Peter")).toBe(
      "Hi Peter! Good to hear from you.",
    );
  });

  it("emits the no-name greeting when name is null", () => {
    expect(noActivePromptFirstLine(null)).toBe("Hi! Good to hear from you.");
  });

  it("emits the no-name greeting when name is undefined", () => {
    expect(noActivePromptFirstLine(undefined)).toBe(
      "Hi! Good to hear from you.",
    );
  });

  it("emits the no-name greeting when name is an empty string", () => {
    expect(noActivePromptFirstLine("")).toBe("Hi! Good to hear from you.");
  });

  it("preserves the name with whitespace+punctuation pattern the original used", () => {
    // The pre-rollback template was:
    //   `Hi${caller.name ? ` ${caller.name}` : ""}! Good to hear from you.`
    // Net-zero check: single space before the name, exclamation immediately
    // after, full sentence terminator at the end.
    const out = noActivePromptFirstLine("Bertie Tallstaff");
    expect(out).toBe("Hi Bertie Tallstaff! Good to hear from you.");
    expect(out.startsWith("Hi ")).toBe(true);
    expect(out.endsWith(".")).toBe(true);
  });
});

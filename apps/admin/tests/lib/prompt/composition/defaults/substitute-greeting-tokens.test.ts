/**
 * #1403 — Tests for token substitution helper.
 *
 * Pins the contract documented in `lib/rules/ai-read-grounding.md` +
 * `substitute-greeting-tokens.ts` JSDoc:
 *
 *   1. Only `{firstName}` and `{courseName}` are substituted.
 *   2. Empty / null values fall back to safe defaults.
 *   3. Arbitrary `{...}` markers pass through verbatim.
 */

import { describe, it, expect } from "vitest";
import {
  substituteGreetingTokens,
  templateContainsSupportedToken,
  DEFAULT_FIRST_NAME,
  DEFAULT_COURSE_NAME,
} from "../../../../../lib/prompt/composition/defaults/substitute-greeting-tokens";

describe("substituteGreetingTokens", () => {
  it("substitutes {firstName} when name is supplied", () => {
    const out = substituteGreetingTokens({
      template: "Hi {firstName}, welcome!",
      firstName: "Beckett",
    });
    expect(out).toBe("Hi Beckett, welcome!");
  });

  it("substitutes {courseName} when courseName is supplied", () => {
    const out = substituteGreetingTokens({
      template: "Today, we're learning about {courseName}. Ready?",
      courseName: "OCEAN Personality Model",
    });
    expect(out).toBe(
      "Today, we're learning about OCEAN Personality Model. Ready?",
    );
  });

  it("substitutes both tokens in one pass", () => {
    const out = substituteGreetingTokens({
      template: "Hi {firstName}, today we're on {courseName}!",
      firstName: "Beckett",
      courseName: "OCEAN",
    });
    expect(out).toBe("Hi Beckett, today we're on OCEAN!");
  });

  it("falls back to default firstName when name is null/empty", () => {
    expect(
      substituteGreetingTokens({ template: "Hi {firstName}!", firstName: null }),
    ).toBe(`Hi ${DEFAULT_FIRST_NAME}!`);
    expect(
      substituteGreetingTokens({ template: "Hi {firstName}!", firstName: "" }),
    ).toBe(`Hi ${DEFAULT_FIRST_NAME}!`);
    expect(
      substituteGreetingTokens({ template: "Hi {firstName}!", firstName: "  " }),
    ).toBe(`Hi ${DEFAULT_FIRST_NAME}!`);
  });

  it("falls back to default courseName when missing", () => {
    expect(
      substituteGreetingTokens({ template: "About {courseName}.", courseName: null }),
    ).toBe(`About ${DEFAULT_COURSE_NAME}.`);
  });

  it("leaves unsupported {...} markers verbatim (no arbitrary expansion)", () => {
    const out = substituteGreetingTokens({
      template: "Hi {firstName}! Your phone is {phone} and grade is {level}.",
      firstName: "Beckett",
    });
    // {phone} and {level} stay verbatim — they're not in the allow-list.
    expect(out).toBe(
      `Hi Beckett! Your phone is {phone} and grade is {level}.`,
    );
  });

  it("returns empty string for null / undefined / blank templates", () => {
    expect(substituteGreetingTokens({ template: null })).toBe("");
    expect(substituteGreetingTokens({ template: undefined })).toBe("");
    expect(substituteGreetingTokens({ template: "" })).toBe("");
    expect(substituteGreetingTokens({ template: "   \n\t " })).toBe("");
  });

  it("trims surrounding whitespace from the template", () => {
    const out = substituteGreetingTokens({
      template: "  Hi {firstName}!  ",
      firstName: "Beckett",
    });
    expect(out).toBe("Hi Beckett!");
  });

  it("handles repeated tokens", () => {
    const out = substituteGreetingTokens({
      template: "{firstName}, are you ready {firstName}?",
      firstName: "Beckett",
    });
    expect(out).toBe("Beckett, are you ready Beckett?");
  });
});

describe("templateContainsSupportedToken", () => {
  it("detects {firstName}", () => {
    expect(templateContainsSupportedToken("Hi {firstName}!")).toBe(true);
  });
  it("detects {courseName}", () => {
    expect(templateContainsSupportedToken("About {courseName}.")).toBe(true);
  });
  it("returns false for unsupported {...}", () => {
    expect(templateContainsSupportedToken("Your phone is {phone}.")).toBe(false);
  });
  it("returns false for null / empty", () => {
    expect(templateContainsSupportedToken(null)).toBe(false);
    expect(templateContainsSupportedToken(undefined)).toBe(false);
    expect(templateContainsSupportedToken("")).toBe(false);
    expect(templateContainsSupportedToken("plain text")).toBe(false);
  });
});

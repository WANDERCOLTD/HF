// @vitest-environment node
//
// #1246 — assistant CapturedTurn payload.content must never be empty in
// the audit bundle. Pre-fix, the final-turn assistant row was written
// with `content: ""` because `nextQuestionFor` returned "" once all
// required fields were captured, and the AI itself returned just a
// tool_use with no narration. The bundle then carried tokens + cost +
// an outputHash but no recoverable assistant text — a compliance gap
// on "what did the AI actually say to the learner". This test pins the
// helpers that fill that gap.

import { describe, it, expect } from "vitest";
import {
  nextQuestionFor,
  closingMessageFor,
} from "@/app/api/intake/chat/route";

describe("nextQuestionFor — empty signals 'no more fields to ask'", () => {
  it("returns empty when every required field is captured", () => {
    const result = nextQuestionFor({
      firstName: "warren",
      lastName: "Warner",
      email: "warren@example.com",
      ageRange: "35-44",
    });
    expect(result).toBe("");
  });

  it("returns a question when a required field is missing", () => {
    const result = nextQuestionFor({
      firstName: "warren",
      lastName: "Warner",
      email: "warren@example.com",
      // ageRange missing
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/age band/i);
  });
});

describe("closingMessageFor — non-empty closing for the final turn (#1246)", () => {
  it("includes the learner's first name when present", () => {
    const out = closingMessageFor({
      firstName: "warren",
      lastName: "Warner",
      email: "warren@example.com",
      ageRange: "35-44",
    });
    expect(out).toContain("warren");
    expect(out).toContain("all set");
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(200); // cap sanity
  });

  it("falls back to a generic closing when firstName is missing/empty", () => {
    for (const values of [
      { firstName: "" },
      { firstName: "   " },
      {},
    ]) {
      const out = closingMessageFor(values);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toContain("all set");
      // No leading comma/space artifact from missing name interpolation
      expect(out).not.toMatch(/^Thanks,\s*—/);
    }
  });

  it("never returns an empty string — the whole point of #1246", () => {
    // Combinations that previously could surface via nextQuestionFor()=""
    // → audit row carried content:"". closingMessageFor must always
    // produce non-empty text.
    const cases: Array<Record<string, unknown>> = [
      {},
      { firstName: "a" },
      { firstName: "a", lastName: "b" },
      { firstName: "a", lastName: "b", email: "c@d.e" },
      { firstName: "a", lastName: "b", email: "c@d.e", ageRange: "35-44" },
    ];
    for (const values of cases) {
      const out = closingMessageFor(values);
      expect(out.trim().length).toBeGreaterThan(0);
    }
  });
});

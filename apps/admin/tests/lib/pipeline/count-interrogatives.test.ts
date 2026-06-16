/**
 * #1748 (epic #1700 Theme 8) — countInterrogatives pure-function pins.
 *
 * Counts tutor questions in a transcript, filtering common rhetorical
 * tags. Reads canonical `User:` / `Assistant:` format.
 */

import { describe, it, expect } from "vitest";
import { countInterrogatives } from "@/lib/pipeline/count-interrogatives";

describe("countInterrogatives", () => {
  it("returns zero counts on null / undefined / empty", () => {
    for (const t of [null, undefined, "", "   "]) {
      const r = countInterrogatives(t);
      expect(r.count).toBe(0);
      expect(r.tutorTurnCount).toBe(0);
      expect(r.rawCount).toBe(0);
      expect(r.rhetoricalFiltered).toBe(0);
    }
  });

  it("counts a single tutor question ending in '?'", () => {
    const transcript = `
Assistant: What is your name?
User: Maya.
`.trim();
    const r = countInterrogatives(transcript);
    expect(r.count).toBe(1);
    expect(r.tutorTurnCount).toBe(1);
    expect(r.rawCount).toBe(1);
    expect(r.rhetoricalFiltered).toBe(0);
  });

  it("does NOT count tutor turns that don't end with '?'", () => {
    const transcript = `
Assistant: Hello there.
User: Hi.
Assistant: Tell me about your weekend.
User: It was great.
`.trim();
    const r = countInterrogatives(transcript);
    expect(r.count).toBe(0);
    expect(r.tutorTurnCount).toBe(2);
  });

  it("counts multiple tutor questions across the transcript", () => {
    const transcript = `
Assistant: What is your favourite food?
User: Pizza.
Assistant: Where did you first try it?
User: Italy.
Assistant: Would you cook it yourself?
User: Yes, sometimes.
`.trim();
    const r = countInterrogatives(transcript);
    expect(r.count).toBe(3);
    expect(r.tutorTurnCount).toBe(3);
  });

  it("filters rhetorical tags (right? / okay? / you know?)", () => {
    const transcript = `
Assistant: Great, right?
User: Yes.
Assistant: That makes sense, okay?
User: Sure.
Assistant: It's tough, you know?
User: Mm.
Assistant: What is your favourite colour?
User: Blue.
`.trim();
    const r = countInterrogatives(transcript);
    expect(r.rawCount).toBe(4);
    expect(r.rhetoricalFiltered).toBe(3);
    expect(r.count).toBe(1);
  });

  it("counts multi-line turns by checking the last char", () => {
    const transcript = `
Assistant: I want to ask you something important.
Have you been to London before?
User: Yes once.
`.trim();
    const r = countInterrogatives(transcript);
    expect(r.count).toBe(1);
    expect(r.tutorTurnCount).toBe(1);
  });

  it("handles case-insensitive speaker labels", () => {
    const transcript = `
ASSISTANT: What did you study?
user: Maths.
Assistant: Why did you choose it?
`.trim();
    const r = countInterrogatives(transcript);
    expect(r.count).toBe(2);
  });

  it("custom rhetoricalPhrases option overrides defaults", () => {
    const transcript = `
Assistant: That's nice, eh?
User: Yes.
Assistant: Right?
User: Sure.
`.trim();
    // Override only with "eh?" — "right?" no longer skipped.
    const r = countInterrogatives(transcript, { rhetoricalPhrases: ["eh?"] });
    expect(r.rawCount).toBe(2);
    expect(r.rhetoricalFiltered).toBe(1); // "eh?"
    expect(r.count).toBe(1); // "right?" survives
  });

  it("ignores learner-side '?' (only tutor questions count)", () => {
    const transcript = `
Assistant: I think English is hard.
User: Really? Why do you think that?
Assistant: There are many irregular verbs.
`.trim();
    const r = countInterrogatives(transcript);
    expect(r.count).toBe(0);
    expect(r.tutorTurnCount).toBe(2);
  });
});

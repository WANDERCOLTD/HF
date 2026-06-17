/**
 * Tests for lib/voice/transcript-detailed.ts (epic #1762, Story B).
 *
 * Pins the contract that downstream Stories C (phase boundaries),
 * D (audio slicer), and E (PROSODY_AUDIO stage) consume:
 *   - Per-turn `secondsFromStart` + `duration` → `{startSec, endSec}`
 *   - System / tool messages dropped
 *   - Empty / missing-time messages dropped
 *   - Role mapping mirrors `parseVapiCustomerTranscript`
 *   - Turns sorted by startSec
 *   - Window filter (mid-point inclusion, no double-count on touching ranges)
 *
 * Real-call fixture comes from hf-dev Call 57c9d831-3aa1-496f-9951-96bcd32c2607
 * (2026-06-09, 52s duration, 6 messages — 1 system + 3 bot + 2 user).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveDetailedTranscriptFromVapi,
  turnsInWindow,
} from "@/lib/voice/transcript-detailed";

const FIXTURE_PATH = join(
  __dirname,
  "../../fixtures/vapi-artifact-messages-57c9d831.json",
);
const FIXTURE_MESSAGES = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown[];

function withMessages(messages: unknown): { artifact: { messages: unknown } } {
  return { artifact: { messages } };
}

describe("deriveDetailedTranscriptFromVapi — real fixture (call 57c9d831)", () => {
  const transcript = deriveDetailedTranscriptFromVapi(withMessages(FIXTURE_MESSAGES));

  it("returns 5 scoreable turns (drops the single system message)", () => {
    expect(transcript).not.toBeNull();
    expect(transcript!.turns).toHaveLength(5);
  });

  it("maps VAPI bot/user roles to assistant/learner", () => {
    const roles = transcript!.turns.map((t) => t.role);
    expect(roles).toEqual(["assistant", "learner", "assistant", "learner", "assistant"]);
  });

  it("computes endSec = secondsFromStart + duration/1000", () => {
    const first = transcript!.turns[0];
    expect(first.startSec).toBeCloseTo(1.36, 2);
    expect(first.endSec).toBeCloseTo(1.36 + 3610 / 1000, 2);
  });

  it("preserves message text verbatim", () => {
    expect(transcript!.turns[1].text).toBe("Hello?");
  });

  it("sets totalDurationSec to the last turn's endSec", () => {
    const last = transcript!.turns[transcript!.turns.length - 1];
    expect(transcript!.totalDurationSec).toBe(last.endSec);
    expect(transcript!.totalDurationSec).toBeGreaterThan(40);
    expect(transcript!.totalDurationSec).toBeLessThan(60);
  });
});

describe("deriveDetailedTranscriptFromVapi — shape guards", () => {
  it("returns null on null input", () => {
    expect(deriveDetailedTranscriptFromVapi(null)).toBeNull();
  });

  it("returns null on undefined input", () => {
    expect(deriveDetailedTranscriptFromVapi(undefined)).toBeNull();
  });

  it("returns null when artifact key is missing", () => {
    expect(deriveDetailedTranscriptFromVapi({ foo: "bar" })).toBeNull();
  });

  it("returns null when artifact.messages is missing", () => {
    expect(deriveDetailedTranscriptFromVapi({ artifact: {} })).toBeNull();
  });

  it("returns null when artifact.messages is not an array", () => {
    expect(deriveDetailedTranscriptFromVapi({ artifact: { messages: "nope" } })).toBeNull();
  });

  it("returns empty-turns transcript when messages array is empty", () => {
    const result = deriveDetailedTranscriptFromVapi(withMessages([]));
    expect(result).toEqual({ turns: [], totalDurationSec: 0 });
  });
});

describe("deriveDetailedTranscriptFromVapi — filtering", () => {
  it("drops system and tool messages", () => {
    const input = withMessages([
      { role: "system", message: "prompt", secondsFromStart: 0, duration: 0 },
      { role: "tool", message: "tool call", secondsFromStart: 1, duration: 0 },
      { role: "bot", message: "real turn", secondsFromStart: 2, duration: 1000 },
    ]);
    const result = deriveDetailedTranscriptFromVapi(input)!;
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].text).toBe("real turn");
  });

  it("drops messages with empty text", () => {
    const input = withMessages([
      { role: "bot", message: "", secondsFromStart: 0, duration: 1000 },
      { role: "user", message: "hi", secondsFromStart: 1, duration: 500 },
    ]);
    expect(deriveDetailedTranscriptFromVapi(input)!.turns).toHaveLength(1);
  });

  it("drops messages with non-numeric secondsFromStart", () => {
    const input = withMessages([
      { role: "bot", message: "no time", duration: 1000 },
      { role: "user", message: "ok", secondsFromStart: 5, duration: 500 },
    ]);
    expect(deriveDetailedTranscriptFromVapi(input)!.turns).toHaveLength(1);
  });

  it("treats missing duration as zero-length turn", () => {
    const input = withMessages([
      { role: "bot", message: "instant", secondsFromStart: 10 },
    ]);
    const result = deriveDetailedTranscriptFromVapi(input)!;
    expect(result.turns[0].startSec).toBe(10);
    expect(result.turns[0].endSec).toBe(10);
  });

  it("treats negative duration as zero", () => {
    const input = withMessages([
      { role: "bot", message: "weird", secondsFromStart: 5, duration: -1000 },
    ]);
    const result = deriveDetailedTranscriptFromVapi(input)!;
    expect(result.turns[0].endSec).toBe(5);
  });
});

describe("deriveDetailedTranscriptFromVapi — sorting", () => {
  it("sorts out-of-order messages by startSec", () => {
    const input = withMessages([
      { role: "bot", message: "third", secondsFromStart: 20, duration: 500 },
      { role: "user", message: "first", secondsFromStart: 5, duration: 500 },
      { role: "bot", message: "second", secondsFromStart: 10, duration: 500 },
    ]);
    const result = deriveDetailedTranscriptFromVapi(input)!;
    expect(result.turns.map((t) => t.text)).toEqual(["first", "second", "third"]);
  });
});

describe("turnsInWindow", () => {
  const transcript = {
    turns: [
      { role: "assistant" as const, text: "0-5", startSec: 0, endSec: 5 },
      { role: "learner" as const, text: "5-15", startSec: 5, endSec: 15 },
      { role: "assistant" as const, text: "15-20", startSec: 15, endSec: 20 },
      { role: "learner" as const, text: "20-30", startSec: 20, endSec: 30 },
    ],
    totalDurationSec: 30,
  };

  it("returns turns whose midpoint falls inside the window", () => {
    // Window [10,20): turn 5-15 (mid=10) ✓, turn 15-20 (mid=17.5) ✓
    const result = turnsInWindow(transcript, 10, 20);
    expect(result.map((t) => t.text)).toEqual(["5-15", "15-20"]);
  });

  it("does not double-count a turn straddling touching windows", () => {
    const a = turnsInWindow(transcript, 0, 10);
    const b = turnsInWindow(transcript, 10, 20);
    const all = new Set([...a, ...b].map((t) => t.text));
    expect(all.size).toBe(a.length + b.length);
  });

  it("returns empty array on inverted window", () => {
    expect(turnsInWindow(transcript, 20, 10)).toEqual([]);
  });

  it("returns empty array on zero-width window", () => {
    expect(turnsInWindow(transcript, 10, 10)).toEqual([]);
  });

  it("includes both halves of the transcript across full window", () => {
    expect(turnsInWindow(transcript, 0, 30)).toHaveLength(4);
  });
});

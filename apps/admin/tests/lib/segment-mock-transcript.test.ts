/**
 * Tests for lib/curriculum/segment-mock-transcript.ts
 *
 * Covers:
 * - Clean transcript with all three part cues → heuristic path produces 3 segments
 * - Tutor missing Part 2 cue but Parts 1+3 present → AI fallback + merged result
 * - Tutor missing all cues → AI returns valid boundaries → segments built
 * - Tutor missing all cues → AI fails → empty array (caller falls back)
 * - AI returns disallowed slug → validator rejects → empty array
 * - AI returns out-of-range offset → validator rejects → empty array
 * - Single-slug coversModules → produces one whole-transcript segment
 * - Empty transcript → empty array
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetConfiguredMeteredAICompletion = vi.fn();

vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: (...args: any[]) =>
    mockGetConfiguredMeteredAICompletion(...args),
}));

import { segmentMockTranscript, __internals } from "@/lib/curriculum/segment-mock-transcript";

function makeLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  } as any;
}

describe("segmentMockTranscript — heuristic path", () => {
  beforeEach(() => {
    mockGetConfiguredMeteredAICompletion.mockReset();
  });

  it("clean three-part transcript → 3 segments resolved by heuristic, no AI call", async () => {
    const transcript = [
      "Assistant: Hi! Let's start with Part 1. Tell me about where you live.",
      "User: I live in Warsaw, Poland.",
      "Assistant: Now let's move to Part 2. Here's your cue card. You should say:",
      "User: I want to talk about my morning routine...",
      "Assistant: Now we'll discuss this topic more broadly. What do people in your country think about routines?",
      "User: Most people prefer fixed schedules.",
    ].join("\n\n");

    const segments = await segmentMockTranscript({
      transcript,
      coversModuleSlugs: ["part1", "part2", "part3"],
      engine: "claude",
      log: makeLog(),
    });

    expect(segments.map((s) => s.slug)).toEqual(["part1", "part2", "part3"]);
    expect(segments.every((s) => s.method === "heuristic")).toBe(true);
    // First segment includes the transcript prefix (offset 0)
    expect(segments[0].startOffset).toBe(0);
    // No AI call should have been made
    expect(mockGetConfiguredMeteredAICompletion).not.toHaveBeenCalled();
    // Segments cover the transcript end-to-end with no gaps
    expect(segments[segments.length - 1].endOffset).toBe(transcript.length);
    for (let i = 0; i + 1 < segments.length; i++) {
      expect(segments[i].endOffset).toBe(segments[i + 1].startOffset);
    }
  });

  it("missing Part 2 cue → heuristic finds 2 of 3, triggers AI fallback, merges", async () => {
    const transcript = [
      "Assistant: Hi! Let's start with Part 1. Where are you from?",
      "User: Warsaw, Poland.",
      // No Part 2 cue phrase — tutor jumped straight in with no
      // recognisable transition (no "cue card", no "should say", no
      // "describe a X you/that").
      "Assistant: Alright Marta, talk for two minutes about something you enjoy doing.",
      "User: I really enjoy swimming in the mornings before work...",
      "Assistant: Now we'll discuss this topic more broadly. Why do people pick hobbies?",
      "User: People pick hobbies for many reasons.",
    ].join("\n\n");

    const part2Offset = transcript.indexOf("Alright Marta");
    mockGetConfiguredMeteredAICompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        segments: [{ slug: "part2", startsAt: part2Offset }],
      }),
    });

    const segments = await segmentMockTranscript({
      transcript,
      coversModuleSlugs: ["part1", "part2", "part3"],
      engine: "claude",
      log: makeLog(),
    });

    expect(segments.map((s) => s.slug)).toEqual(["part1", "part2", "part3"]);
    expect(segments[0].method).toBe("ai"); // merged result tagged as ai
    expect(mockGetConfiguredMeteredAICompletion).toHaveBeenCalledTimes(1);
    // AI call must be deterministic
    const [aiArgs] = mockGetConfiguredMeteredAICompletion.mock.calls[0];
    expect(aiArgs.temperature).toBe(0);
  });
});

describe("segmentMockTranscript — AI fallback validation", () => {
  beforeEach(() => {
    mockGetConfiguredMeteredAICompletion.mockReset();
  });

  it("AI returns disallowed slug → empty array (caller falls back)", async () => {
    const transcript = "Some transcript with no recognisable cues at all.";
    mockGetConfiguredMeteredAICompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        segments: [
          { slug: "intro", startsAt: 0 }, // not in coversModuleSlugs
        ],
      }),
    });

    const segments = await segmentMockTranscript({
      transcript,
      coversModuleSlugs: ["part1", "part2", "part3"],
      engine: "claude",
      log: makeLog(),
    });

    expect(segments).toEqual([]);
  });

  it("AI returns out-of-range offset → empty array", async () => {
    const transcript = "Short transcript, no cues.";
    mockGetConfiguredMeteredAICompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        segments: [{ slug: "part1", startsAt: 99999 }],
      }),
    });

    const segments = await segmentMockTranscript({
      transcript,
      coversModuleSlugs: ["part1", "part2", "part3"],
      engine: "claude",
      log: makeLog(),
    });

    expect(segments).toEqual([]);
  });

  it("AI throws → empty array, logs warn", async () => {
    const transcript = "Some transcript without cues.";
    mockGetConfiguredMeteredAICompletion.mockRejectedValueOnce(new Error("timeout"));

    const log = makeLog();
    const segments = await segmentMockTranscript({
      transcript,
      coversModuleSlugs: ["part1", "part2", "part3"],
      engine: "claude",
      log,
    });

    expect(segments).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
  });

  it("max-cap enforcement — AI returns more than N slugs, only first N considered", () => {
    const boundaries = __internals.validateAndExtractBoundaries(
      {
        segments: [
          { slug: "part1", startsAt: 0 },
          { slug: "part2", startsAt: 100 },
          { slug: "part3", startsAt: 200 },
          // These trailing entries are sliced off before validation —
          // we never see them.
          { slug: "part4", startsAt: 300 },
          { slug: "part5", startsAt: 400 },
        ],
      },
      "x".repeat(500),
      ["part1", "part2", "part3"],
    );

    expect(boundaries.size).toBe(3);
    expect([...boundaries.keys()].sort()).toEqual(["part1", "part2", "part3"]);
  });

  it("whitelist enforcement — disallowed slug within the first N rejects whole response", () => {
    const boundaries = __internals.validateAndExtractBoundaries(
      {
        segments: [
          { slug: "part1", startsAt: 0 },
          { slug: "intro", startsAt: 50 }, // disallowed within the cap
          { slug: "part3", startsAt: 200 },
        ],
      },
      "x".repeat(500),
      ["part1", "part2", "part3"],
    );

    expect(boundaries.size).toBe(0);
  });
});

describe("segmentMockTranscript — edge cases", () => {
  beforeEach(() => {
    mockGetConfiguredMeteredAICompletion.mockReset();
  });

  it("empty transcript → empty array, no AI call", async () => {
    const segments = await segmentMockTranscript({
      transcript: "",
      coversModuleSlugs: ["part1", "part2", "part3"],
      engine: "claude",
      log: makeLog(),
    });

    expect(segments).toEqual([]);
    expect(mockGetConfiguredMeteredAICompletion).not.toHaveBeenCalled();
  });

  it("empty slugs → empty array", async () => {
    const segments = await segmentMockTranscript({
      transcript: "Some transcript",
      coversModuleSlugs: [],
      engine: "claude",
      log: makeLog(),
    });

    expect(segments).toEqual([]);
  });
});

describe("segmentMockTranscript — Part 2 cue card phrases", () => {
  beforeEach(() => {
    mockGetConfiguredMeteredAICompletion.mockReset();
  });

  it("Part 2 detected via 'Here's your cue card'", () => {
    const transcript =
      "Assistant: Let's start with Part 1. Hello.\n" +
      "User: Hi.\n" +
      "Assistant: Here's your cue card. Describe something.\n" +
      "User: Okay.\n" +
      "Assistant: Now let's move to Part 3. Final question.\n" +
      "User: Sure.";
    const boundaries = __internals.findHeuristicBoundaries(transcript, ["part1", "part2", "part3"]);
    expect(boundaries.has("part1")).toBe(true);
    expect(boundaries.has("part2")).toBe(true);
    expect(boundaries.has("part3")).toBe(true);
  });

  it("Part 2 detected via 'You should say:'", () => {
    const transcript =
      "Assistant: Let's start with Part 1. Hello.\n" +
      "Assistant: Describe a person. You should say: who they are.\n" +
      "Assistant: Now let's move to Part 3.";
    const boundaries = __internals.findHeuristicBoundaries(transcript, ["part1", "part2", "part3"]);
    expect(boundaries.size).toBeGreaterThanOrEqual(2);
    expect(boundaries.has("part2")).toBe(true);
  });
});

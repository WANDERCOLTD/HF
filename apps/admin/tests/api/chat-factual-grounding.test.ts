/**
 * #1444 — factual-grounding intercept unit tests.
 *
 * Pin the structural suppression rule that protects DATA + COURSE_MANAGE
 * chats from fabricating learner-scoped facts. The 2026-06-10 incident
 * (Bertie Tallstaff enrollment + HERA voice fallback) is the regression
 * the true-positive cases reproduce; the true-negative cases keep
 * course-level / refusal text from being wrongly blocked.
 *
 * The intercept lives at `app/api/chat/factual-grounding-intercept.ts`
 * and is wired into the non-streaming DATA / COURSE_MANAGE tool-loop
 * branch of `app/api/chat/route.ts` at response-flush time.
 */

import { describe, it, expect } from "vitest";
import { detectUngroundedLearnerClaim } from "@/app/api/chat/factual-grounding-intercept";

describe("detectUngroundedLearnerClaim — true positives (must block)", () => {
  it("blocks enrollment claim with no grounding tool call (Bertie + different-course)", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText:
        "Bertie is enrolled in a different course than the one we're looking at — Big Five (OCEAN).",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.replacementText).toContain("look that up");
    expect(result.replacementText).toContain("get_caller_detail");
    expect(result.reason).toMatch(/enrollment|voice/);
    expect(result.suppressedText).toContain("enrolled");
  });

  it("blocks voice-fallback claim with no grounding tool call (HERA fallback)", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText:
        "Voice falls back to HERA because the course has no voiceId configured.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("voice-provider claim");
    expect(result.replacementText).toContain("get_caller_detail");
  });

  it("blocks 'is taking <course>' claim with no grounding tool call", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Mateo is taking Big Five (OCEAN).",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("enrollment claim");
  });
});

describe("detectUngroundedLearnerClaim — true negatives (must NOT block)", () => {
  it("allows the same enrollment claim when get_caller_detail was called this turn", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText:
        "Bertie is enrolled in a different course than the one we're looking at — Big Five (OCEAN).",
      toolUsesInTurn: [{ name: "get_caller_detail" }],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows the same voice claim when get_voice_config was called this turn", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText:
        "Voice falls back to deepgram because the course has no voiceId configured.",
      toolUsesInTurn: [{ name: "get_voice_config" }],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows a course-level voice cascade discussion that names a provider without a fallback verb", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText:
        "The voice cascade for this course resolves to deepgram/arcas.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows a refusal-shaped message offering to call get_caller_detail", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText:
        "I'd need to check Bertie's enrollment — shall I call get_caller_detail?",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows naming providers in the abstract (catalogue-style answer)", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText:
        "We currently support deepgram, elevenlabs, openai, and azure as TTS adapters.",
      toolUsesInTurn: [],
    });
    // Note: this message mentions providers + "TTS" co-located, but no
    // fallback-shaped verb. The pattern requires both. If this ever flips
    // to blocked, the VOICE_CONTEXT_RE got too eager.
    expect(result.blocked).toBe(false);
  });
});

describe("detectUngroundedLearnerClaim — edge cases", () => {
  it("does not block an empty assistantText", () => {
    expect(detectUngroundedLearnerClaim({ assistantText: "", toolUsesInTurn: [] }).blocked).toBe(false);
    expect(detectUngroundedLearnerClaim({ assistantText: "   ", toolUsesInTurn: [] }).blocked).toBe(false);
  });

  it("treats get_voice_config as grounding for a voice-provider claim", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Voice falls back to HERA for this caller.",
      toolUsesInTurn: [{ name: "get_voice_config" }, { name: "list_behavior_targets" }],
    });
    expect(result.blocked).toBe(false);
  });

  it("does NOT treat an unrelated tool call (e.g. query_specs) as grounding", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie is enrolled in Big Five (OCEAN).",
      toolUsesInTurn: [{ name: "query_specs" }, { name: "get_playbook_config" }],
    });
    expect(result.blocked).toBe(true);
  });

  it("tolerates a missing toolUsesInTurn array", () => {
    // Defensive — the caller in route.ts always passes [] but a stray
    // undefined shouldn't crash. Cast through unknown to bypass the
    // explicit type so we exercise the runtime fallback.
    const result = detectUngroundedLearnerClaim({
      assistantText: "Hello, how can I help?",
      toolUsesInTurn: undefined as unknown as Array<{ name: string }>,
    });
    expect(result.blocked).toBe(false);
  });

  it("tolerates a missing assistantText", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: undefined as unknown as string,
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(false);
  });
});

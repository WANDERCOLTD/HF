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
 * branch of `app/api/chat/route.ts`, the BUG branch (for file-path
 * fabrication), and the sibling `app/api/ai/assistant/route.ts`.
 *
 * The 2026-06-10 same-day audit extension covers:
 *   - Progress / mastery / completion claims
 *   - Goal-completion claims
 *   - Score claims with numeric values
 *   - Fabricated file-path citations (`detectFabricatedFilePaths`)
 */

import { describe, it, expect } from "vitest";
import {
  detectUngroundedLearnerClaim,
  detectFabricatedFilePaths,
} from "@/app/api/chat/factual-grounding-intercept";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ESM-compatible __dirname for vitest. The test fixture below uses
// resolve(__dirname, "..", "..") to reach apps/admin from
// apps/admin/tests/api/, so we need a stable absolute path here.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// ─────────────────────────────────────────────────────────────────────────────
// Progress / mastery claims — same allowlist as enrollment + voice
// ─────────────────────────────────────────────────────────────────────────────

describe("detectUngroundedLearnerClaim — progress claims", () => {
  it("blocks 'Bertie is 60% through module X'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie is 60% through module X.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("progress claim");
  });

  it("blocks 'Bertie has mastered the warmth target'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie has mastered the warmth target already.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("progress claim");
  });

  it("blocks 'Bertie completed module 3'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie completed module 3 last week.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("progress claim");
  });

  it("blocks pronoun-form 'they're done with module X'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "They're done with module X — ready for module 4.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("progress claim");
  });

  it("allows 'the average learner finishes module 3' — no caller-name token", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "On average learners finish module 3 in about two weeks.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows progress phrasing when get_caller_detail was called this turn", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie has mastered module 3.",
      toolUsesInTurn: [{ name: "get_caller_detail" }],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows a course-level mastery description ('the mastery threshold for this course is 0.7')", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "The mastery threshold for this course is 0.7 across all LOs.",
      toolUsesInTurn: [],
    });
    // No caller-name token → no block.
    expect(result.blocked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Goal-completion claims
// ─────────────────────────────────────────────────────────────────────────────

describe("detectUngroundedLearnerClaim — goal-completion claims", () => {
  it("blocks 'Bertie achieved their goal of speaking fluently'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie achieved their goal of speaking more fluently.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("goal-completion");
  });

  it("blocks 'they hit her goal'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Mateo hit her goal yesterday, by the way.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("goal-completion");
  });

  it("blocks 'Bertie reached the goal'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie reached the goal earlier than expected.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("goal-completion");
  });

  it("allows 'the goal of this course is to teach X' — no completion verb", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "The goal of this course is to teach X to learners.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows the same claim when get_caller_detail was called this turn", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie achieved their goal of speaking fluently.",
      toolUsesInTurn: [{ name: "get_caller_detail" }],
    });
    expect(result.blocked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Score claims with numeric values
// ─────────────────────────────────────────────────────────────────────────────

describe("detectUngroundedLearnerClaim — score claims", () => {
  it("blocks 'Bertie scored 0.7 on warmth'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie scored 0.7 on warmth in her last call.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("score claim");
  });

  it("blocks 'Bertie is currently at 0.5'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie is currently at 0.5 on the warmth parameter.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("score claim");
  });

  it("blocks 'Mateo with 0.4 last call'", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Mateo with 0.4 last call — that's a regression from 0.6.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("score claim");
  });

  it("allows catalogue talk 'BEH-WARMTH scored 0.7' without a caller-name token", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "BEH-WARMTH scored 0.7 on the most recent cohort run.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows 'the target is 0.7' — catalogue/config talk, no caller token", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "The target is 0.7 by the end of module 4.",
      toolUsesInTurn: [],
    });
    expect(result.blocked).toBe(false);
  });

  it("allows the same score claim when get_caller_detail was called this turn", () => {
    const result = detectUngroundedLearnerClaim({
      assistantText: "Bertie scored 0.7 on warmth in her last call.",
      toolUsesInTurn: [{ name: "get_caller_detail" }],
    });
    expect(result.blocked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectFabricatedFilePaths — chat.bug citation check
// ─────────────────────────────────────────────────────────────────────────────

describe("detectFabricatedFilePaths", () => {
  // The intercept file itself is a known-existing path; we use it as a
  // hermetic test fixture. apps/admin is the project root the citation
  // is relative to — we walk up from this test file's location.
  // This file lives at apps/admin/tests/api/, so apps/admin is two levels up.
  const appAdminRoot = resolve(__dirname, "..", "..");

  it("blocks a fabricated apps/admin/...:N citation", () => {
    const result = detectFabricatedFilePaths({
      assistantText: "Look at apps/admin/app/api/chat/does-not-exist.ts:42 — that's where it lives.",
      appAdminRoot,
    });
    expect(result.blocked).toBe(true);
    expect(result.fabricatedPaths).toContain("apps/admin/app/api/chat/does-not-exist.ts:42");
    expect(result.replacementText).toContain("may not exist");
  });

  it("blocks a fabricated path without a line number", () => {
    const result = detectFabricatedFilePaths({
      assistantText: "Check apps/admin/lib/totally-fake-helper.ts for the bug.",
      appAdminRoot,
    });
    expect(result.blocked).toBe(true);
    expect(result.fabricatedPaths).toContain("apps/admin/lib/totally-fake-helper.ts");
  });

  it("blocks multiple fabricated paths and lists them all", () => {
    const result = detectFabricatedFilePaths({
      assistantText:
        "I see it in apps/admin/lib/ghost-one.ts and also apps/admin/app/ghost-two.tsx:99.",
      appAdminRoot,
    });
    expect(result.blocked).toBe(true);
    expect(result.fabricatedPaths.length).toBe(2);
    expect(result.replacementText).toContain("ghost-one.ts");
    expect(result.replacementText).toContain("ghost-two.tsx:99");
  });

  it("blocks a path that tries to escape the root via ..", () => {
    const result = detectFabricatedFilePaths({
      assistantText: "Look at apps/admin/../../../etc/passwd for the bug.",
      appAdminRoot,
    });
    // Our regex doesn't match `..` (no `.` allowed after `/` in path body);
    // the path is therefore not matched at all and the function returns
    // not-blocked. Verifies the regex is conservative — `..` traversal
    // never even enters the existsSync codepath.
    expect(result.blocked).toBe(false);
  });

  it("does NOT block an existing path", () => {
    const result = detectFabricatedFilePaths({
      assistantText: "The intercept lives at apps/admin/app/api/chat/factual-grounding-intercept.ts.",
      appAdminRoot,
    });
    expect(result.blocked).toBe(false);
    expect(result.fabricatedPaths).toEqual([]);
  });

  it("does NOT block an existing path with a line-number tail", () => {
    const result = detectFabricatedFilePaths({
      assistantText: "See apps/admin/app/api/chat/factual-grounding-intercept.ts:42 for the regex.",
      appAdminRoot,
    });
    // We don't validate the line number itself — file existence is the
    // signal. The path resolves to a real file, so no block.
    expect(result.blocked).toBe(false);
  });

  it("does NOT block when the message has no apps/admin citation at all", () => {
    const result = detectFabricatedFilePaths({
      assistantText: "Looks like a typo in the prompt template. Check the seed JSON.",
      appAdminRoot,
    });
    expect(result.blocked).toBe(false);
  });

  it("does NOT block when appAdminRoot is empty (bails open on misconfig)", () => {
    const result = detectFabricatedFilePaths({
      assistantText: "apps/admin/lib/does-not-exist.ts is the file.",
      appAdminRoot: "",
    });
    expect(result.blocked).toBe(false);
  });

  it("does NOT block an empty assistantText", () => {
    const result = detectFabricatedFilePaths({
      assistantText: "",
      appAdminRoot,
    });
    expect(result.blocked).toBe(false);
  });
});

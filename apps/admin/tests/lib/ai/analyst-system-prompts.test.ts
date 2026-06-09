/**
 * Tests for `lib/ai/analyst-system-prompts.ts` (#1404 B2).
 *
 * Pins the 5 analyst system prompts byte-equal to what shipped pre-B2
 * (the inline literals at pipeline/route.ts:1129,1569,2577 +
 * extract-goals.ts:141,477). Net-zero behavioural contract — the LLM
 * sees the SAME string after the move; the move only changes WHERE the
 * string is sourced from.
 *
 * If any of these strings change in the future, this test should be
 * updated in the same commit that adjusts the analyst behaviour — so
 * a silent drift between expected and actual is caught.
 */

import { describe, expect, it } from "vitest";

import {
  PIPELINE_MEASURE_SYSTEM_PROMPT,
  PIPELINE_SCORE_AGENT_SYSTEM_PROMPT,
  PIPELINE_ADAPT_SYSTEM_PROMPT,
  GOALS_EXTRACT_SYSTEM_PROMPT,
  GOALS_EXTRACT_COMPLETION_SIGNALS_SYSTEM_PROMPT,
} from "@/lib/ai/analyst-system-prompts";

describe("analyst-system-prompts (net-zero contract)", () => {
  it("PIPELINE_MEASURE_SYSTEM_PROMPT matches the pre-B2 inline literal", () => {
    expect(PIPELINE_MEASURE_SYSTEM_PROMPT).toBe(
      "You are an expert behavioral analyst. Always respond with valid JSON.",
    );
  });

  it("PIPELINE_SCORE_AGENT_SYSTEM_PROMPT matches the pre-B2 inline literal", () => {
    expect(PIPELINE_SCORE_AGENT_SYSTEM_PROMPT).toBe(
      "You are an expert at evaluating conversational AI behavior. Always respond with valid JSON. Keep evidence arrays brief (1-2 short quotes max per parameter).",
    );
  });

  it("PIPELINE_ADAPT_SYSTEM_PROMPT matches the pre-B2 inline literal", () => {
    expect(PIPELINE_ADAPT_SYSTEM_PROMPT).toBe(
      "You are an expert at personalizing AI behaviour based on caller profiles. Always respond with valid JSON.",
    );
  });

  it("GOALS_EXTRACT_SYSTEM_PROMPT matches the pre-B2 inline literal", () => {
    expect(GOALS_EXTRACT_SYSTEM_PROMPT).toBe(
      "You are an expert at understanding learner intentions. Extract goals from conversations. Return valid JSON only.",
    );
  });

  it("GOALS_EXTRACT_COMPLETION_SIGNALS_SYSTEM_PROMPT matches the pre-B2 inline literal", () => {
    expect(GOALS_EXTRACT_COMPLETION_SIGNALS_SYSTEM_PROMPT).toBe(
      "You detect when learners claim to have achieved assessment goals. Return valid JSON only.",
    );
  });

  it("every prompt is non-empty (LLM rejects empty system role)", () => {
    expect(PIPELINE_MEASURE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(PIPELINE_SCORE_AGENT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(PIPELINE_ADAPT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(GOALS_EXTRACT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(GOALS_EXTRACT_COMPLETION_SIGNALS_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("every prompt instructs the LLM to return JSON (parser depends on this)", () => {
    // The downstream `recoverBrokenJson` path assumes the model was told
    // to return JSON. If a future edit removes that instruction, the
    // recovery path will silently start failing on free-form prose.
    const all = [
      PIPELINE_MEASURE_SYSTEM_PROMPT,
      PIPELINE_SCORE_AGENT_SYSTEM_PROMPT,
      PIPELINE_ADAPT_SYSTEM_PROMPT,
      GOALS_EXTRACT_SYSTEM_PROMPT,
      GOALS_EXTRACT_COMPLETION_SIGNALS_SYSTEM_PROMPT,
    ];
    for (const p of all) {
      expect(p.toLowerCase()).toMatch(/json/);
    }
  });
});

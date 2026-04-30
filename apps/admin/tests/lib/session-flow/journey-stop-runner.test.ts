/**
 * Tests for the JourneyStop runner — pure function evaluation of
 * which stop to fire next based on pipeline state.
 *
 * Covers:
 *   - Each trigger type (first_session, before_session, after_session,
 *     midpoint, mastery_reached, session_count, course_complete)
 *   - Multiple stops, ordering (first matching wins)
 *   - Disabled stops skipped
 *   - Completed stops skipped
 *   - Empty stops list returns no verdict
 *
 * @see lib/session-flow/journey-stop-runner.ts
 * @see GitHub issue #218
 */

import { describe, it, expect } from "vitest";
import { evaluateStops, triggerSatisfied } from "@/lib/session-flow/journey-stop-runner";
import type { JourneyStopState } from "@/lib/session-flow/journey-stop-runner";
import type { JourneyStop } from "@/lib/types/json-fields";

const baseState = (overrides: Partial<JourneyStopState> = {}): JourneyStopState => ({
  currentSession: 0,
  totalSessions: undefined,
  masteryPct: 0,
  callCount: 0,
  onboardingComplete: true,
  completedStopIds: new Set(),
  courseComplete: false,
  ...overrides,
});

const makeStop = (id: string, trigger: JourneyStop["trigger"], overrides: Partial<JourneyStop> = {}): JourneyStop => ({
  id,
  kind: "assessment",
  trigger,
  delivery: { mode: "either" },
  enabled: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// triggerSatisfied — per-trigger type
// ---------------------------------------------------------------------------

describe("triggerSatisfied — first_session", () => {
  it("true when no calls + onboarding incomplete", () => {
    expect(triggerSatisfied(
      { type: "first_session" },
      baseState({ callCount: 0, onboardingComplete: false }),
    )).toBe(true);
  });

  it("false once onboarding is complete", () => {
    expect(triggerSatisfied(
      { type: "first_session" },
      baseState({ callCount: 0, onboardingComplete: true }),
    )).toBe(false);
  });

  it("false once a call has happened", () => {
    expect(triggerSatisfied(
      { type: "first_session" },
      baseState({ callCount: 1, onboardingComplete: false }),
    )).toBe(false);
  });
});

describe("triggerSatisfied — before_session", () => {
  it("fires before session N (callCount = N-1)", () => {
    expect(triggerSatisfied(
      { type: "before_session", index: 1 },
      baseState({ callCount: 0, onboardingComplete: true }),
    )).toBe(true);
    expect(triggerSatisfied(
      { type: "before_session", index: 3 },
      baseState({ callCount: 2, onboardingComplete: true }),
    )).toBe(true);
  });

  it("does not fire if onboarding incomplete", () => {
    expect(triggerSatisfied(
      { type: "before_session", index: 1 },
      baseState({ callCount: 0, onboardingComplete: false }),
    )).toBe(false);
  });

  it("does not fire after the target session", () => {
    expect(triggerSatisfied(
      { type: "before_session", index: 1 },
      baseState({ callCount: 1 }),
    )).toBe(false);
  });
});

describe("triggerSatisfied — after_session", () => {
  it("fires once callCount reaches N", () => {
    expect(triggerSatisfied(
      { type: "after_session", index: 1 },
      baseState({ callCount: 1 }),
    )).toBe(true);
    expect(triggerSatisfied(
      { type: "after_session", index: 5 },
      baseState({ callCount: 7 }),
    )).toBe(true);
  });

  it("does not fire before N", () => {
    expect(triggerSatisfied(
      { type: "after_session", index: 5 },
      baseState({ callCount: 4 }),
    )).toBe(false);
  });

  it("requires onboarding complete", () => {
    expect(triggerSatisfied(
      { type: "after_session", index: 1 },
      baseState({ callCount: 5, onboardingComplete: false }),
    )).toBe(false);
  });
});

describe("triggerSatisfied — midpoint", () => {
  it("fires at ceil(totalSessions / 2)", () => {
    expect(triggerSatisfied(
      { type: "midpoint" },
      baseState({ totalSessions: 6, callCount: 3 }),
    )).toBe(true);
    expect(triggerSatisfied(
      { type: "midpoint" },
      baseState({ totalSessions: 5, callCount: 3 }),
    )).toBe(true); // ceil(5/2) = 3
  });

  it("does not fire before midpoint", () => {
    expect(triggerSatisfied(
      { type: "midpoint" },
      baseState({ totalSessions: 6, callCount: 2 }),
    )).toBe(false);
  });

  it("does not fire when totalSessions undefined (continuous mode)", () => {
    expect(triggerSatisfied(
      { type: "midpoint" },
      baseState({ totalSessions: undefined, callCount: 99 }),
    )).toBe(false);
  });

  it("does not fire when totalSessions is 0", () => {
    expect(triggerSatisfied(
      { type: "midpoint" },
      baseState({ totalSessions: 0, callCount: 5 }),
    )).toBe(false);
  });
});

describe("triggerSatisfied — mastery_reached", () => {
  it("fires when mastery >= threshold", () => {
    expect(triggerSatisfied(
      { type: "mastery_reached", threshold: 80 },
      baseState({ masteryPct: 80 }),
    )).toBe(true);
    expect(triggerSatisfied(
      { type: "mastery_reached", threshold: 80 },
      baseState({ masteryPct: 85 }),
    )).toBe(true);
  });

  it("does not fire below threshold", () => {
    expect(triggerSatisfied(
      { type: "mastery_reached", threshold: 80 },
      baseState({ masteryPct: 79 }),
    )).toBe(false);
  });
});

describe("triggerSatisfied — session_count", () => {
  it("fires once callCount >= count", () => {
    expect(triggerSatisfied(
      { type: "session_count", count: 5 },
      baseState({ callCount: 5 }),
    )).toBe(true);
    expect(triggerSatisfied(
      { type: "session_count", count: 5 },
      baseState({ callCount: 10 }),
    )).toBe(true);
  });

  it("does not fire below count", () => {
    expect(triggerSatisfied(
      { type: "session_count", count: 5 },
      baseState({ callCount: 4 }),
    )).toBe(false);
  });
});

describe("triggerSatisfied — course_complete", () => {
  it("fires when courseComplete=true", () => {
    expect(triggerSatisfied(
      { type: "course_complete" },
      baseState({ courseComplete: true }),
    )).toBe(true);
  });

  it("does not fire when courseComplete=false", () => {
    expect(triggerSatisfied(
      { type: "course_complete" },
      baseState({ courseComplete: false }),
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateStops — list-level behaviour
// ---------------------------------------------------------------------------

describe("evaluateStops", () => {
  it("returns no verdict for empty stops list", () => {
    expect(evaluateStops(baseState(), [])).toEqual({ fire: false });
  });

  it("fires the first matching stop", () => {
    const preTest = makeStop("pre-test", { type: "after_session", index: 1 });
    const nps = makeStop("nps", { type: "mastery_reached", threshold: 80 }, { kind: "nps" });
    const verdict = evaluateStops(
      baseState({ callCount: 1, masteryPct: 90 }),
      [preTest, nps],
    );
    expect(verdict).toEqual({ fire: true, stop: preTest });
  });

  it("falls through completed stops", () => {
    const preTest = makeStop("pre-test", { type: "after_session", index: 1 });
    const nps = makeStop("nps", { type: "mastery_reached", threshold: 80 }, { kind: "nps" });
    const verdict = evaluateStops(
      baseState({
        callCount: 1,
        masteryPct: 90,
        completedStopIds: new Set(["pre-test"]),
      }),
      [preTest, nps],
    );
    expect(verdict).toEqual({ fire: true, stop: nps });
  });

  it("skips disabled stops even when trigger matches", () => {
    const disabled = makeStop("pre-test", { type: "after_session", index: 1 }, { enabled: false });
    const verdict = evaluateStops(
      baseState({ callCount: 1 }),
      [disabled],
    );
    expect(verdict).toEqual({ fire: false });
  });

  it("returns no verdict when no triggers satisfied", () => {
    const nps = makeStop("nps", { type: "mastery_reached", threshold: 80 }, { kind: "nps" });
    const verdict = evaluateStops(
      baseState({ masteryPct: 50 }),
      [nps],
    );
    expect(verdict).toEqual({ fire: false });
  });

  it("ordering: pre-test before NPS in real-world flow", () => {
    // Mid-course state — pre-test triggered, NPS not yet.
    const stops: JourneyStop[] = [
      makeStop("pre-test", { type: "after_session", index: 1 }),
      makeStop("nps", { type: "mastery_reached", threshold: 80 }, { kind: "nps" }),
    ];
    expect(evaluateStops(
      baseState({ callCount: 1, masteryPct: 30 }),
      stops,
    )).toEqual({ fire: true, stop: stops[0] });

    // Late-course state — pre-test done, NPS triggers.
    expect(evaluateStops(
      baseState({
        callCount: 5,
        masteryPct: 85,
        completedStopIds: new Set(["pre-test"]),
      }),
      stops,
    )).toEqual({ fire: true, stop: stops[1] });
  });

  it("handles structured-mode NPS gap (the #218 fix scenario)", () => {
    // Before this work, structured-mode courses configured for NPS
    // never delivered it. The runner closes that gap.
    const stops: JourneyStop[] = [
      makeStop("nps", { type: "mastery_reached", threshold: 80 }, { kind: "nps" }),
    ];
    const structuredState = baseState({
      callCount: 7,
      masteryPct: 85,
      totalSessions: 10, // structured mode has totalSessions
    });
    expect(evaluateStops(structuredState, stops)).toEqual({
      fire: true,
      stop: stops[0],
    });
  });
});

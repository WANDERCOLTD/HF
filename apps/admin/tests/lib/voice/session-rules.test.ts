/**
 * #1342 — pure-logic tests for session-rules.ts.
 *
 * No mocks, no I/O — every test passes inputs to the function and
 * asserts the output. Locks the class-rule table from the epic body.
 */

import { describe, it, expect } from "vitest";
import {
  initialCounterFlags,
  finaliseCounterFlags,
  deriveSkipStages,
  statusFromOutcome,
} from "@/lib/voice/session-rules";

describe("initialCounterFlags", () => {
  it("VOICE_CALL → both counters true (provisional)", () => {
    expect(initialCounterFlags("VOICE_CALL")).toEqual({
      countsTowardLearnerNumber: true,
      countsTowardPipelineNumber: true,
    });
  });

  it("SIM_CALL → learner false, pipeline true (harness)", () => {
    expect(initialCounterFlags("SIM_CALL")).toEqual({
      countsTowardLearnerNumber: false,
      countsTowardPipelineNumber: true,
    });
  });

  it("ENROLLMENT → learner false, pipeline true", () => {
    expect(initialCounterFlags("ENROLLMENT")).toEqual({
      countsTowardLearnerNumber: false,
      countsTowardPipelineNumber: true,
    });
  });

  it("ASSESSMENT → learner false, pipeline true", () => {
    expect(initialCounterFlags("ASSESSMENT")).toEqual({
      countsTowardLearnerNumber: false,
      countsTowardPipelineNumber: true,
    });
  });

  it("TEXT_CHAT → learner false, pipeline true", () => {
    expect(initialCounterFlags("TEXT_CHAT")).toEqual({
      countsTowardLearnerNumber: false,
      countsTowardPipelineNumber: true,
    });
  });
});

describe("finaliseCounterFlags", () => {
  it("VOICE_CALL ≥ 30s + COMPLETED → both true", () => {
    expect(
      finaliseCounterFlags({
        kind: "VOICE_CALL",
        outcome: "COMPLETED",
        durationSeconds: 60,
      }),
    ).toEqual({ countsTowardLearnerNumber: true, countsTowardPipelineNumber: true });
  });

  it("VOICE_CALL < 30s + COMPLETED → learner false, pipeline true", () => {
    expect(
      finaliseCounterFlags({
        kind: "VOICE_CALL",
        outcome: "COMPLETED",
        durationSeconds: 12,
      }),
    ).toEqual({ countsTowardLearnerNumber: false, countsTowardPipelineNumber: true });
  });

  it("VOICE_CALL ABORTED → learner false even if long", () => {
    expect(
      finaliseCounterFlags({
        kind: "VOICE_CALL",
        outcome: "ABORTED",
        durationSeconds: 120,
      }),
    ).toEqual({ countsTowardLearnerNumber: false, countsTowardPipelineNumber: true });
  });

  it("GHOST → both false (any kind)", () => {
    expect(
      finaliseCounterFlags({
        kind: "VOICE_CALL",
        outcome: "GHOST",
        durationSeconds: 0,
      }),
    ).toEqual({ countsTowardLearnerNumber: false, countsTowardPipelineNumber: false });
    expect(
      finaliseCounterFlags({
        kind: "SIM_CALL",
        outcome: "GHOST",
        durationSeconds: null,
      }),
    ).toEqual({ countsTowardLearnerNumber: false, countsTowardPipelineNumber: false });
  });

  it("SIM_CALL → learner stays false (harness, regardless of outcome/length)", () => {
    expect(
      finaliseCounterFlags({
        kind: "SIM_CALL",
        outcome: "COMPLETED",
        durationSeconds: 300,
      }),
    ).toEqual({ countsTowardLearnerNumber: false, countsTowardPipelineNumber: true });
  });

  it("custom minDurationSeconds overrides default", () => {
    expect(
      finaliseCounterFlags({
        kind: "VOICE_CALL",
        outcome: "COMPLETED",
        durationSeconds: 25,
        minDurationSeconds: 20,
      }),
    ).toEqual({ countsTowardLearnerNumber: true, countsTowardPipelineNumber: true });
  });
});

describe("deriveSkipStages", () => {
  it("VOICE_CALL no outcome → no skips", () => {
    expect(deriveSkipStages({ kind: "VOICE_CALL" })).toEqual([]);
  });

  it("ENROLLMENT → skip EXTRACT/SCORE_AGENT/PROSODY (no transcript scoring)", () => {
    expect(deriveSkipStages({ kind: "ENROLLMENT" })).toEqual([
      "EXTRACT",
      "PROSODY",
      "SCORE_AGENT",
    ]);
  });

  it("ASSESSMENT → skip EXTRACT/SCORE_AGENT/PROSODY", () => {
    expect(deriveSkipStages({ kind: "ASSESSMENT" })).toEqual([
      "EXTRACT",
      "PROSODY",
      "SCORE_AGENT",
    ]);
  });

  it("VOICE_CALL FAILED → skip EXTRACT/SCORE_AGENT/PROSODY/REWARD", () => {
    expect(
      deriveSkipStages({ kind: "VOICE_CALL", outcome: "FAILED" }),
    ).toEqual(["EXTRACT", "PROSODY", "REWARD", "SCORE_AGENT"]);
  });

  it("GHOST adds REWARD on top of the transcript-derived skips", () => {
    expect(
      deriveSkipStages({ kind: "VOICE_CALL", outcome: "GHOST" }),
    ).toEqual(["EXTRACT", "PROSODY", "REWARD", "SCORE_AGENT"]);
  });

  it("SIM_CALL COMPLETED → no skips (pipeline still runs)", () => {
    expect(
      deriveSkipStages({ kind: "SIM_CALL", outcome: "COMPLETED" }),
    ).toEqual([]);
  });
});

describe("statusFromOutcome", () => {
  it("maps COMPLETED → COMPLETED", () => {
    expect(statusFromOutcome("COMPLETED")).toBe("COMPLETED");
  });
  it("maps FAILED → FAILED", () => {
    expect(statusFromOutcome("FAILED")).toBe("FAILED");
  });
  it("maps GHOST → GHOST", () => {
    expect(statusFromOutcome("GHOST")).toBe("GHOST");
  });
  it("maps ABORTED → FAILED (short-duration aborts treated as failures for status)", () => {
    expect(statusFromOutcome("ABORTED")).toBe("FAILED");
  });
});

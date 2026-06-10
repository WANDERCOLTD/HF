/**
 * Regression pin for #1459 — the wire shape returned by
 * `GET /api/callers/[callerId]` `calls[]` must include `sessionId` and
 * the four `voice*` end-state fields. Pre-fix the inline transform
 * stripped them and the calls-prompts tab rendered "previous call has
 * no composition" for every populated call (`buildTimeline` joins via
 * `Call.sessionId → ComposedPrompt.triggerSessionId`).
 */

import { describe, it, expect } from "vitest";
import {
  serializeCallForCallerDetail,
  type CallerDetailCallInput,
} from "@/lib/callers/serialize-call-for-detail";

function callRow(
  overrides: Partial<CallerDetailCallInput> = {},
): CallerDetailCallInput {
  return {
    id: "call-1",
    source: "vapi",
    externalId: "ext-1",
    transcript: "User: hi\nAI: hello",
    createdAt: new Date("2026-06-10T16:22:24.621Z"),
    endedAt: new Date("2026-06-10T16:24:00.000Z"),
    sessionId: "sess-abc",
    session: { sequenceNumber: 7, learnerFacingNumber: 7 },
    playbookId: "pb-1",
    requestedModuleId: "mod-1",
    voiceEndedReason: "customer-ended-call",
    voiceDurationSeconds: 96.5,
    voiceCostUsd: 0.21,
    curriculumModuleId: "cm-1",
    curriculumModule: {
      id: "cm-1",
      slug: "unit-04",
      title: "IT Operations",
      coversModules: null,
    },
    _count: { scores: 3, behaviorMeasurements: 12 },
    rewardScore: { id: "rs-1" },
    ...overrides,
  };
}

describe("serializeCallForCallerDetail (#1459)", () => {
  it("includes sessionId on the wire (root cause of #1459)", () => {
    const row = callRow({ sessionId: "sess-xyz" });
    const wire = serializeCallForCallerDetail(row, 0, false);
    expect(wire.sessionId).toBe("sess-xyz");
  });

  it("passes through all four voice end-state fields", () => {
    const row = callRow({
      voiceEndedReason: "assistant-ended-call",
      voiceDurationSeconds: 42.5,
      voiceCostUsd: 0.0992,
    });
    const wire = serializeCallForCallerDetail(row, 0, false);
    expect(wire.voiceEndedReason).toBe("assistant-ended-call");
    expect(wire.voiceDurationSeconds).toBe(42.5);
    expect(wire.voiceCostUsd).toBe(0.0992);
  });

  it("preserves null voice fields without coercion", () => {
    const row = callRow({
      voiceEndedReason: null,
      voiceDurationSeconds: null,
      voiceCostUsd: null,
    });
    const wire = serializeCallForCallerDetail(row, 0, false);
    expect(wire.voiceEndedReason).toBeNull();
    expect(wire.voiceDurationSeconds).toBeNull();
    expect(wire.voiceCostUsd).toBeNull();
  });

  it("emits callSequence from parent Session.learnerFacingNumber", () => {
    const row = callRow({
      session: { sequenceNumber: 7, learnerFacingNumber: 4 },
    });
    const wire = serializeCallForCallerDetail(row, 0, false);
    expect(wire.callSequence).toBe(4);
  });

  it("emits null callSequence for pre-Slice-3 Calls (no Session parent)", () => {
    const row = callRow({ session: null });
    const wire = serializeCallForCallerDetail(row, 0, false);
    expect(wire.callSequence).toBeNull();
  });

  it("coerces empty playbookId / requestedModuleId to null (existing contract)", () => {
    const row = callRow({
      playbookId: "" as unknown as string,
      requestedModuleId: "" as unknown as string,
    });
    const wire = serializeCallForCallerDetail(row, 0, false);
    expect(wire.playbookId).toBeNull();
    expect(wire.requestedModuleId).toBeNull();
  });

  it("derives analysis flags from _count and explicit args", () => {
    const row = callRow({
      _count: { scores: 0, behaviorMeasurements: 5 },
      rewardScore: null,
    });
    const wire = serializeCallForCallerDetail(row, 3, true);
    expect(wire.hasScores).toBe(false);
    expect(wire.hasMemories).toBe(true);
    expect(wire.hasBehaviorMeasurements).toBe(true);
    expect(wire.hasRewardScore).toBe(false);
    expect(wire.hasPrompt).toBe(true);
  });

  it("hasMemories=false when memory count is zero", () => {
    const row = callRow();
    const wire = serializeCallForCallerDetail(row, 0, false);
    expect(wire.hasMemories).toBe(false);
  });

  it("wire shape pin — exact field set (catches future drift)", () => {
    const row = callRow();
    const wire = serializeCallForCallerDetail(row, 1, true);
    expect(Object.keys(wire).sort()).toEqual(
      [
        "callSequence",
        "createdAt",
        "curriculumModule",
        "curriculumModuleId",
        "endedAt",
        "externalId",
        "hasBehaviorMeasurements",
        "hasMemories",
        "hasPrompt",
        "hasRewardScore",
        "hasScores",
        "id",
        "playbookId",
        "requestedModuleId",
        "sessionId",
        "source",
        "transcript",
        "voiceCostUsd",
        "voiceDurationSeconds",
        "voiceEndedReason",
      ].sort(),
    );
  });
});

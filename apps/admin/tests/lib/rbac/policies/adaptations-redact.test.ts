/**
 * Tests for redactAdaptationsForTier — the per-resource redactor that
 * projects the full AdaptationsResponse onto the tier-appropriate
 * shape. Whitelist-default-safe: a new sensitive field added to the
 * raw response should NOT appear at the `redacted` tier unless the
 * redactor's branch is explicitly updated.
 */

import { describe, it, expect } from "vitest";

import {
  redactAdaptationsForTier,
  isRedacted,
} from "@/lib/rbac/policies/adaptations";
import type { AdaptationsResponse } from "@/app/api/callers/[callerId]/adaptations/route";

function makeRaw(overrides: Partial<AdaptationsResponse> = {}): AdaptationsResponse {
  return {
    callerId: "c1",
    callerName: "Test Learner",
    playbookId: "pb1",
    playbookName: "Sample Course",
    whatWasAdapted: [
      {
        parameterId: "p_clarity",
        parameterName: "Clarity",
        defaultValue: 0.5,
        overrideValue: 0.72,
        sourceScope: "CALLER",
        confidence: 0.84,
        callsApplied: 6,
        updatedAt: "2026-06-12T10:00:00Z",
      },
      {
        parameterId: "p_pace",
        parameterName: "Pace",
        defaultValue: 0.5,
        overrideValue: 0.34,
        sourceScope: "PLAYBOOK",
        confidence: null,
        callsApplied: 0,
        updatedAt: "2026-06-10T10:00:00Z",
      },
    ],
    why: [
      {
        callId: "call_2",
        at: "2026-06-12T10:00:00Z",
        rationale: "Learner asked for clearer recap — push clarity up",
        direction: "up",
        parameterId: "p_clarity",
        parameterName: "Clarity",
        delta: 0.1,
      },
      {
        callId: "call_1",
        at: "2026-06-10T10:00:00Z",
        rationale: "Initial calibration based on intake survey",
        direction: "down",
        parameterId: "p_pace",
        parameterName: "Pace",
        delta: -0.16,
      },
    ],
    nextAdaptation: [
      {
        goalId: "g1",
        goalName: "Master fractions",
        goalType: "LEARN",
        progress: 0.4,
        band: "mid",
        guidance: "Build on prior foundations, connect to what they already know",
        isAssessmentTarget: false,
      },
    ],
    empty: false,
    ...overrides,
  };
}

describe("redactAdaptationsForTier — full tier", () => {
  it("passes through every field of the raw response", () => {
    const raw = makeRaw();
    const out = redactAdaptationsForTier(raw, "full");
    expect(out.viewerTier).toBe("full");
    if (isRedacted(out)) throw new Error("expected non-redacted");
    expect(out.whatWasAdapted).toEqual(raw.whatWasAdapted);
    expect(out.why).toEqual(raw.why);
    expect(out.nextAdaptation).toEqual(raw.nextAdaptation);
    expect(out.empty).toBe(false);
  });
});

describe("redactAdaptationsForTier — diagnostic tier", () => {
  it("currently identical to 'full' (reserved for future debug fields)", () => {
    const raw = makeRaw();
    const out = redactAdaptationsForTier(raw, "diagnostic");
    expect(out.viewerTier).toBe("diagnostic");
    if (isRedacted(out)) throw new Error("expected non-redacted");
    expect(out.whatWasAdapted).toEqual(raw.whatWasAdapted);
  });
});

describe("redactAdaptationsForTier — redacted tier", () => {
  it("strips numeric values from whatWasAdapted (only name + direction survive)", () => {
    const raw = makeRaw();
    const out = redactAdaptationsForTier(raw, "redacted");
    if (!isRedacted(out)) throw new Error("expected redacted shape");
    expect(out.whatWasAdapted).toEqual([
      {
        parameterId: "p_clarity",
        parameterName: "Clarity",
        direction: "up",
        updatedAt: "2026-06-12T10:00:00Z",
      },
      {
        parameterId: "p_pace",
        parameterName: "Pace",
        direction: "down",
        updatedAt: "2026-06-10T10:00:00Z",
      },
    ]);
    // Type-level + runtime check: numeric fields gone
    const first = out.whatWasAdapted[0] as unknown as Record<string, unknown>;
    expect("defaultValue" in first).toBe(false);
    expect("overrideValue" in first).toBe(false);
    expect("confidence" in first).toBe(false);
    expect("callsApplied" in first).toBe(false);
    expect("sourceScope" in first).toBe(false);
  });

  it("collapses 'why' to count + mostRecentAt (rationale text dropped)", () => {
    const raw = makeRaw();
    const out = redactAdaptationsForTier(raw, "redacted");
    if (!isRedacted(out)) throw new Error("expected redacted shape");
    expect(out.whyRedacted.count).toBe(2);
    expect(out.whyRedacted.mostRecentAt).toBe("2026-06-12T10:00:00Z");
    // The raw `why` array is NOT present on the redacted shape
    expect("why" in out).toBe(false);
  });

  it("hides nextAdaptation entirely at the redacted tier", () => {
    const raw = makeRaw();
    const out = redactAdaptationsForTier(raw, "redacted");
    if (!isRedacted(out)) throw new Error("expected redacted shape");
    expect(out.nextAdaptation).toEqual([]);
  });

  it("classifies near-zero delta as 'hold'", () => {
    const raw = makeRaw({
      whatWasAdapted: [
        {
          parameterId: "p_steady",
          parameterName: "Steady",
          defaultValue: 0.5,
          overrideValue: 0.501,
          sourceScope: "CALLER",
          confidence: 0.9,
          callsApplied: 4,
          updatedAt: "2026-06-12T10:00:00Z",
        },
      ],
    });
    const out = redactAdaptationsForTier(raw, "redacted");
    if (!isRedacted(out)) throw new Error("expected redacted shape");
    expect(out.whatWasAdapted[0].direction).toBe("hold");
  });

  it("returns mostRecentAt null when why is empty", () => {
    const raw = makeRaw({ why: [] });
    const out = redactAdaptationsForTier(raw, "redacted");
    if (!isRedacted(out)) throw new Error("expected redacted shape");
    expect(out.whyRedacted.count).toBe(0);
    expect(out.whyRedacted.mostRecentAt).toBeNull();
  });

  it("preserves identity fields (callerId, callerName, playbookId, playbookName, empty)", () => {
    const raw = makeRaw();
    const out = redactAdaptationsForTier(raw, "redacted");
    if (!isRedacted(out)) throw new Error("expected redacted shape");
    expect(out.callerId).toBe("c1");
    expect(out.callerName).toBe("Test Learner");
    expect(out.playbookId).toBe("pb1");
    expect(out.playbookName).toBe("Sample Course");
    expect(out.empty).toBe(false);
  });

  it("tags the response with viewerTier='redacted'", () => {
    const raw = makeRaw();
    const out = redactAdaptationsForTier(raw, "redacted");
    expect(out.viewerTier).toBe("redacted");
  });

  it("sorts why by `at` desc when picking mostRecentAt (defensive vs route order)", () => {
    const raw = makeRaw({
      why: [
        {
          callId: "old",
          at: "2026-05-01T00:00:00Z",
          rationale: "old",
          direction: "up",
          parameterId: null,
          parameterName: null,
          delta: 0.1,
        },
        {
          callId: "new",
          at: "2026-06-14T00:00:00Z",
          rationale: "new",
          direction: "down",
          parameterId: null,
          parameterName: null,
          delta: -0.1,
        },
      ],
    });
    const out = redactAdaptationsForTier(raw, "redacted");
    if (!isRedacted(out)) throw new Error("expected redacted shape");
    expect(out.whyRedacted.mostRecentAt).toBe("2026-06-14T00:00:00Z");
  });
});

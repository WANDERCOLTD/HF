/**
 * Tests for VapiProvider.normaliseStatusUpdate (AnyVoice #1080).
 *
 * Validates the trickle parser extracts running cost + duration from
 * the various VAPI status-update payload shapes.
 */

import { describe, it, expect } from "vitest";
import { VapiProvider } from "@/lib/voice/providers/vapi";

describe("VapiProvider.normaliseStatusUpdate", () => {
  it("returns null when the type isn't status-update", () => {
    const p = new VapiProvider({}, {});
    expect(p.normaliseStatusUpdate({ message: { type: "end-of-call-report" } })).toBeNull();
    expect(p.normaliseStatusUpdate({})).toBeNull();
  });

  it("returns null when there's no call id", () => {
    const p = new VapiProvider({}, {});
    expect(
      p.normaliseStatusUpdate({
        message: { type: "status-update", call: {} },
      }),
    ).toBeNull();
  });

  it("parses scalar cost field", () => {
    const p = new VapiProvider({}, {});
    const result = p.normaliseStatusUpdate({
      message: {
        type: "status-update",
        call: { id: "vapi_abc" },
        cost: 0.05,
        duration: 60,
      },
    });
    expect(result).toEqual({
      externalCallId: "vapi_abc",
      costSoFarUsd: 0.05,
      durationSecondsSoFar: 60,
    });
  });

  it("parses nested cost.total", () => {
    const p = new VapiProvider({}, {});
    const result = p.normaliseStatusUpdate({
      message: {
        type: "status-update",
        call: { id: "vapi_abc" },
        cost: { total: 0.12, breakdown: {} },
      },
    });
    expect(result?.costSoFarUsd).toBe(0.12);
  });

  it("handles missing duration gracefully", () => {
    const p = new VapiProvider({}, {});
    const result = p.normaliseStatusUpdate({
      message: {
        type: "status-update",
        call: { id: "vapi_abc" },
        cost: 0.01,
      },
    });
    expect(result?.durationSecondsSoFar).toBeNull();
  });

  it("accepts call.callId / call.call_id aliases", () => {
    const p = new VapiProvider({}, {});
    expect(
      p.normaliseStatusUpdate({
        message: {
          type: "status-update",
          call: { callId: "alias_a" },
          cost: 0.01,
        },
      })?.externalCallId,
    ).toBe("alias_a");
    expect(
      p.normaliseStatusUpdate({
        message: {
          type: "status-update",
          call: { call_id: "alias_b" },
          cost: 0.01,
        },
      })?.externalCallId,
    ).toBe("alias_b");
  });
});

/**
 * Tests for lib/voice/telemetry.ts (AnyVoice #1080).
 *
 * Validates that logVoiceEvent calls logUsageEventFireAndForget with the
 * canonical VOICE category + slug as engine + sensible metadata shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fireAndForgetMock = vi.fn();

vi.mock("@/lib/metering/usage-logger", () => ({
  logUsageEventFireAndForget: (input: unknown) => fireAndForgetMock(input),
}));

import { logVoiceEvent, startVoiceSpan } from "@/lib/voice/telemetry";

beforeEach(() => {
  fireAndForgetMock.mockReset();
});

describe("logVoiceEvent", () => {
  it("writes UsageEvent with VOICE category + slug as engine", () => {
    logVoiceEvent({
      slug: "vapi",
      operation: "voice:vapi:tool:lookup_teaching_point",
      durationMs: 147,
    });
    expect(fireAndForgetMock).toHaveBeenCalledTimes(1);
    const payload = fireAndForgetMock.mock.calls[0][0];
    expect(payload.category).toBe("VOICE");
    expect(payload.operation).toBe("voice:vapi:tool:lookup_teaching_point");
    expect(payload.engine).toBe("vapi");
    expect(payload.metadata.durationMs).toBe(147);
    expect(payload.metadata.success).toBe(true);
  });

  it("records explicit costCents on metadata", () => {
    logVoiceEvent({
      slug: "vapi",
      operation: "voice:vapi:webhook:status-update",
      durationMs: 0,
      costCents: 12.5,
    });
    const payload = fireAndForgetMock.mock.calls[0][0];
    expect(payload.metadata.explicitCostCents).toBe(12.5);
  });

  it("records errorMessage and flips success=false", () => {
    logVoiceEvent({
      slug: "vapi",
      operation: "voice:vapi:tool:lookup_teaching_point",
      durationMs: 5000,
      errorMessage: "timeout",
    });
    const payload = fireAndForgetMock.mock.calls[0][0];
    expect(payload.metadata.success).toBe(false);
    expect(payload.metadata.error).toBe("timeout");
  });

  it("passes callId + callerId through when set", () => {
    logVoiceEvent({
      slug: "retell",
      operation: "voice:retell:webhook",
      durationMs: 10,
      callId: "call_abc",
      callerId: "caller_xyz",
    });
    const payload = fireAndForgetMock.mock.calls[0][0];
    expect(payload.callId).toBe("call_abc");
    expect(payload.callerId).toBe("caller_xyz");
  });
});

describe("startVoiceSpan", () => {
  it("measures elapsed time and emits one event when closed", async () => {
    const end = startVoiceSpan({ slug: "vapi", operation: "voice:vapi:test" });
    await new Promise((r) => setTimeout(r, 12));
    end({ metadata: { extra: "x" } });
    expect(fireAndForgetMock).toHaveBeenCalledTimes(1);
    const payload = fireAndForgetMock.mock.calls[0][0];
    expect(payload.metadata.durationMs).toBeGreaterThanOrEqual(10);
    expect(payload.metadata.extra).toBe("x");
  });

  it("does not emit when not closed", () => {
    startVoiceSpan({ slug: "vapi", operation: "voice:vapi:test" });
    expect(fireAndForgetMock).not.toHaveBeenCalled();
  });
});

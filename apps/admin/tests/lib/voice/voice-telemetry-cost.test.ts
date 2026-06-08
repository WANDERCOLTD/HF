/**
 * Lock test for `logVoiceEvent` propagating costCents to the
 * UsageEvent column (surfaced 2026-06-08).
 *
 * Pre-fix: costCents landed in metadata.explicitCostCents only — the
 * top-level column stayed 0 for every voice row. This broke per-
 * component cost queries (e.g. "TTS share of monthly voice spend").
 * Companion fix lives in lib/metering/usage-logger.ts (top-level
 * `costCents` override).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fireAndForget = vi.fn();

vi.mock("@/lib/metering/usage-logger", () => ({
  logUsageEventFireAndForget: (input: unknown) => fireAndForget(input),
}));

import { logVoiceEvent } from "@/lib/voice/telemetry";

describe("logVoiceEvent — costCents propagation (#1334 follow-on)", () => {
  beforeEach(() => {
    fireAndForget.mockClear();
  });

  it("forwards costCents as a top-level field on the UsageEventInput", () => {
    logVoiceEvent({
      slug: "vapi",
      operation: "voice:vapi:webhook:status-update",
      durationMs: 0,
      costCents: 73,
      callId: "call_xyz",
    });
    expect(fireAndForget).toHaveBeenCalledTimes(1);
    const payload = fireAndForget.mock.calls[0][0];
    expect(payload.costCents).toBe(73);
  });

  it("keeps the metadata.explicitCostCents for back-compat with dashboards", () => {
    logVoiceEvent({
      slug: "vapi",
      operation: "voice:vapi:webhook:status-update",
      durationMs: 0,
      costCents: 73,
    });
    const payload = fireAndForget.mock.calls[0][0];
    expect(payload.metadata.explicitCostCents).toBe(73);
  });

  it("omits top-level costCents when no cost provided (falls through to rate calc)", () => {
    logVoiceEvent({
      slug: "vapi",
      operation: "voice:vapi:sse:subscriber-connect",
      durationMs: 0,
    });
    const payload = fireAndForget.mock.calls[0][0];
    expect(payload.costCents).toBeUndefined();
    expect(payload.metadata.explicitCostCents).toBeUndefined();
  });

  it("treats explicit `costCents: 0` as an override, not missing", () => {
    logVoiceEvent({
      slug: "vapi",
      operation: "voice:vapi:webhook:status-update",
      durationMs: 0,
      costCents: 0,
    });
    const payload = fireAndForget.mock.calls[0][0];
    expect(payload.costCents).toBe(0);
    expect(payload.metadata.explicitCostCents).toBe(0);
  });
});

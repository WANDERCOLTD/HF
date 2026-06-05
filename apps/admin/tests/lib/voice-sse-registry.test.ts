/**
 * Tests for lib/voice/sse-registry.ts (#1092).
 *
 * Validates the SSE subscriber registry primitives that the call-start
 * endpoint, the SSE route, and the tool router all read/write.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  registerSubscriber,
  unregisterSubscriber,
  hasSubscriberForCall,
  broadcastToCall,
  subscriberCountForCall,
  _resetSseRegistry,
  type VoiceCallSseEvent,
} from "@/lib/voice/sse-registry";

beforeEach(() => {
  _resetSseRegistry();
});

describe("sse-registry — basic primitives", () => {
  it("hasSubscriberForCall returns false for unknown call", () => {
    expect(hasSubscriberForCall("call_abc")).toBe(false);
  });

  it("registerSubscriber flips hasSubscriberForCall true", () => {
    const cb = vi.fn();
    registerSubscriber("call_abc", cb);
    expect(hasSubscriberForCall("call_abc")).toBe(true);
    expect(subscriberCountForCall("call_abc")).toBe(1);
  });

  it("returned unregister fn flips it back to false", () => {
    const cb = vi.fn();
    const unregister = registerSubscriber("call_abc", cb);
    expect(hasSubscriberForCall("call_abc")).toBe(true);
    unregister();
    expect(hasSubscriberForCall("call_abc")).toBe(false);
  });

  it("multiple subscribers per call are tracked", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerSubscriber("call_abc", a);
    registerSubscriber("call_abc", b);
    expect(subscriberCountForCall("call_abc")).toBe(2);
  });

  it("unregisterSubscriber removes one subscriber but keeps the call when others remain", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerSubscriber("call_abc", a);
    registerSubscriber("call_abc", b);
    unregisterSubscriber("call_abc", a);
    expect(subscriberCountForCall("call_abc")).toBe(1);
    expect(hasSubscriberForCall("call_abc")).toBe(true);
  });
});

describe("sse-registry — broadcast", () => {
  it("broadcastToCall invokes every subscriber with the event", async () => {
    const a = vi.fn();
    const b = vi.fn();
    registerSubscriber("call_abc", a);
    registerSubscriber("call_abc", b);

    const event: VoiceCallSseEvent = {
      type: "transcript-partial",
      callId: "call_abc",
      role: "assistant",
      text: "hello",
      timestampMs: 1000,
    };
    await broadcastToCall(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it("broadcasts only to the matching callId", async () => {
    const a = vi.fn();
    const b = vi.fn();
    registerSubscriber("call_abc", a);
    registerSubscriber("call_xyz", b);

    await broadcastToCall({
      type: "transcript-partial",
      callId: "call_abc",
      role: "assistant",
      text: "for abc",
      timestampMs: 1000,
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("broadcast no-ops when no subscribers exist (no throw)", async () => {
    await expect(
      broadcastToCall({
        type: "transcript-partial",
        callId: "no_subs",
        role: "assistant",
        text: "x",
        timestampMs: 0,
      }),
    ).resolves.not.toThrow();
  });

  it("drops a subscriber whose callback throws", async () => {
    const ok = vi.fn();
    const flaky = vi.fn().mockRejectedValueOnce(new Error("client dead"));
    registerSubscriber("call_abc", flaky);
    registerSubscriber("call_abc", ok);

    await broadcastToCall({
      type: "transcript-partial",
      callId: "call_abc",
      role: "assistant",
      text: "x",
      timestampMs: 0,
    });

    expect(ok).toHaveBeenCalledTimes(1);
    expect(subscriberCountForCall("call_abc")).toBe(1); // flaky dropped
  });
});

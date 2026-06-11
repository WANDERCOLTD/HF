/**
 * Tests for lib/help/track-help-event.ts — #1484.
 *
 * Pins the fire-and-forget client contract:
 *   - uses navigator.sendBeacon when available
 *   - falls back to fetch({ keepalive: true }) when not
 *   - never throws when the network blows up
 *   - synchronous (does not return a Promise the caller awaits)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { trackHelpEvent } from "@/lib/help/track-help-event";

describe("trackHelpEvent — Beacon vs fetch dispatch", () => {
  let sendBeaconSpy: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendBeaconSpy = vi.fn().mockReturnValue(true);
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    // Reset both globals at the start of each test; individual tests
    // re-install them to exercise each branch.
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: sendBeaconSpy,
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls navigator.sendBeacon when available and does NOT fall back to fetch", () => {
    trackHelpEvent({ type: "doc-section-view", target: "demos" });

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
    expect(sendBeaconSpy).toHaveBeenCalledWith(
      "/api/help/events",
      expect.any(Blob),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to fetch({ keepalive: true }) when sendBeacon is undefined", () => {
    // Drop the beacon — older browsers / JSDOM without polyfill.
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    trackHelpEvent({
      type: "cascade-inspector-close",
      target: "BEH-WARMTH",
      durationMs: 1500,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/help/events");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).keepalive).toBe(true);
    const body = JSON.parse(((init as RequestInit).body as string) ?? "{}");
    expect(body).toMatchObject({
      type: "cascade-inspector-close",
      target: "BEH-WARMTH",
      durationMs: 1500,
    });
  });

  it("falls back to fetch when sendBeacon returns false (UA rejected payload)", () => {
    sendBeaconSpy.mockReturnValue(false);

    trackHelpEvent({ type: "doc-section-view", target: "demos" });

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws when fetch rejects", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    fetchSpy.mockRejectedValue(new Error("network down"));

    expect(() =>
      trackHelpEvent({ type: "doc-section-view", target: "demos" }),
    ).not.toThrow();
  });

  it("returns void (not a Promise — caller must not await)", () => {
    const result = trackHelpEvent({ type: "doc-section-view", target: "demos" });
    // The contract is fire-and-forget. The return value must be undefined.
    expect(result).toBeUndefined();
  });
});

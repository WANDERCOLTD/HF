/**
 * useOutboundDial — error message surfacing (#1438).
 *
 * Pins the hook's behaviour when the outbound-dial route returns 502 with
 * a `vapiDetails` array. Pre-#1438 the modal showed only the coarse
 * `error: "VAPI returned: Bad Request"` and the operator had no idea
 * which knob was rejected. Now the first detail line is concatenated so
 * the modal toast carries the actionable string.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useOutboundDial } from "@/components/sim/useOutboundDial";

const originalFetch = global.fetch;

beforeEach(() => {
  // Seed the caller-phone fetch + dial fetch sequence.
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/callers/") && !url.includes("/phone")) {
      return new Response(
        JSON.stringify({ ok: true, caller: { phone: "+447700900000" } }),
        { status: 200 },
      );
    }
    // Default — overridden per-test.
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("useOutboundDial — vapiDetails concatenation (#1438)", () => {
  it("appends first vapiDetails entry to errorMessage when 502 carries one", async () => {
    let fetchCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCount += 1;
      if (url.includes("/api/callers/") && !url.includes("phone")) {
        return new Response(
          JSON.stringify({ ok: true, caller: { phone: "+447700900000" } }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/voice/calls/outbound-dial")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "VAPI returned: Bad Request",
            vapiDetails: [
              "assistant.backgroundSound must be a valid URL or one of the following: off, office",
            ],
          }),
          { status: 502 },
        );
      }
      throw new Error(`unexpected fetch #${fetchCount}: ${url}`);
    });

    const { result } = renderHook(() => useOutboundDial({ callerId: "c1" }));
    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toBe(
      "VAPI returned: Bad Request — assistant.backgroundSound must be a valid URL or one of the following: off, office",
    );
  });

  it("falls back to plain error when vapiDetails is absent", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/callers/") && !url.includes("phone")) {
        return new Response(
          JSON.stringify({ ok: true, caller: { phone: "+447700900000" } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ ok: false, error: "Provider not configured" }),
        { status: 503 },
      );
    });

    const { result } = renderHook(() => useOutboundDial({ callerId: "c1" }));
    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toBe("Provider not configured");
  });

  it("falls back to plain error when vapiDetails is empty array", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/callers/") && !url.includes("phone")) {
        return new Response(
          JSON.stringify({ ok: true, caller: { phone: "+447700900000" } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          ok: false,
          error: "VAPI HTTP 500",
          vapiDetails: [],
        }),
        { status: 502 },
      );
    });

    const { result } = renderHook(() => useOutboundDial({ callerId: "c1" }));
    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toBe("VAPI HTTP 500");
  });
});

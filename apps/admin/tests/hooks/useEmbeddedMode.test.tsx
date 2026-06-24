/**
 * #2277 — useEmbeddedMode hook.
 *
 * Pinned acceptance:
 *   1. `?embedded=1` → returns true + writes cookie
 *   2. `?embedded=0` → returns false + clears cookie
 *   3. No param + cookie present → returns true (sticky)
 *   4. No param + no cookie → returns false
 *   5. `?embedded=1` then nav without param → still true (cookie sticks)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useEmbeddedMode } from "@/hooks/useEmbeddedMode";

// Mock next/navigation's useSearchParams so the hook can read a
// programmable query param surface.
const searchParamsRef: { current: URLSearchParams } = {
  current: new URLSearchParams(),
};

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

function setParam(value: string | null) {
  const p = new URLSearchParams();
  if (value !== null) p.set("embedded", value);
  searchParamsRef.current = p;
}

function clearAllCookies() {
  document.cookie.split(";").forEach((c) => {
    const eqPos = c.indexOf("=");
    const name = eqPos > -1 ? c.substring(0, eqPos) : c;
    document.cookie = `${name.trim()}=; path=/; max-age=0`;
  });
}

function readEmbeddedCookie(): boolean {
  const cookies = document.cookie.split(";");
  for (const c of cookies) {
    const [k, v] = c.trim().split("=");
    if (k === "hf-embedded" && v === "1") return true;
  }
  return false;
}

describe("useEmbeddedMode", () => {
  beforeEach(() => {
    clearAllCookies();
    setParam(null);
  });

  it("returns true and writes cookie when ?embedded=1", async () => {
    setParam("1");
    const { result } = renderHook(() => useEmbeddedMode());
    await waitFor(() => expect(result.current).toBe(true));
    expect(readEmbeddedCookie()).toBe(true);
  });

  it("returns false and clears cookie when ?embedded=0", async () => {
    // Prime the cookie first.
    document.cookie = "hf-embedded=1; path=/";
    expect(readEmbeddedCookie()).toBe(true);
    setParam("0");
    const { result } = renderHook(() => useEmbeddedMode());
    await waitFor(() => expect(result.current).toBe(false));
    expect(readEmbeddedCookie()).toBe(false);
  });

  it("returns true from sticky cookie when no param present", async () => {
    document.cookie = "hf-embedded=1; path=/";
    setParam(null);
    const { result } = renderHook(() => useEmbeddedMode());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("returns false when neither param nor cookie", async () => {
    setParam(null);
    const { result } = renderHook(() => useEmbeddedMode());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("stays embedded across subsequent navigations once cookie is set", async () => {
    // First render with the activating param.
    setParam("1");
    const { result, rerender } = renderHook(() => useEmbeddedMode());
    await waitFor(() => expect(result.current).toBe(true));

    // Subsequent nav drops the param — cookie should keep the mode.
    setParam(null);
    rerender();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("ignores arbitrary values like ?embedded=true", async () => {
    setParam("true");
    const { result } = renderHook(() => useEmbeddedMode());
    // No param=1 → no cookie write; no cookie present → false.
    await waitFor(() => expect(result.current).toBe(false));
    expect(readEmbeddedCookie()).toBe(false);
  });
});

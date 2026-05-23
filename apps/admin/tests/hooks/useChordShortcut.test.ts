/**
 * useChordShortcut — chord state machine + binding resolution
 *
 * Tests the H/G + key chord engine from #688:
 *   - bare prefix arms (no modifier accepted)
 *   - second key resolves to a binding via lib/help/page-help.ts
 *   - timeout resets silently
 *   - unmapped second key resets silently
 *   - focus-blocked targets skip the listener entirely
 *   - active dialog skips
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChordShortcut } from "@/hooks/useChordShortcut";
import type { ChordBinding } from "@/lib/help/page-help";

const pushMock = vi.fn();
// Return a stable router object — a fresh object per render would make
// useChordShortcut's effect dep array see a new reference each time and
// tear down the in-flight chord timer.
const stableRouter = { push: pushMock, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => stableRouter,
}));

function fireKey(key: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; target?: HTMLElement } = {}): void {
  const ev = new KeyboardEvent("keydown", {
    key,
    metaKey: !!modifiers.meta,
    ctrlKey: !!modifiers.ctrl,
    altKey: !!modifiers.alt,
    bubbles: true,
    cancelable: true,
  });
  if (modifiers.target) {
    Object.defineProperty(ev, "target", { value: modifiers.target });
  }
  window.dispatchEvent(ev);
}

const navigateChords: ChordBinding[] = [
  { keys: "C", action: "navigate", href: "/x/courses", label: "Courses" },
  { keys: "L", action: "navigate", href: "/x/learners", label: "Learners" },
];

const callbackChords: ChordBinding[] = [
  { keys: "C", action: "callback", callbackId: "tab:content", label: "Content tab" },
  { keys: "D", action: "callback", callbackId: "tab:design", label: "Design tab" },
];

describe("useChordShortcut", () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("activePrefix is null at rest", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    expect(result.current.activePrefix).toBeNull();
  });

  it("arms on bare 'h' keypress and sets activePrefix to 'H'", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("h"); });
    expect(result.current.activePrefix).toBe("H");
  });

  it("arms on bare 'g' keypress too — Gmail muscle memory", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("g"); });
    expect(result.current.activePrefix).toBe("G");
  });

  it("does NOT arm on Cmd+G — Cmd+G belongs to the layout handler", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("g", { meta: true }); });
    expect(result.current.activePrefix).toBeNull();
  });

  it("does NOT arm on Ctrl+H either", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("h", { ctrl: true }); });
    expect(result.current.activePrefix).toBeNull();
  });

  it("H + C navigates to the bound href and clears the prefix", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("h"); });
    expect(result.current.activePrefix).toBe("H");
    act(() => { fireKey("c"); });
    expect(pushMock).toHaveBeenCalledWith("/x/courses");
    expect(result.current.activePrefix).toBeNull();
  });

  it("G + L navigates correctly — both prefixes share the binding table", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("g"); fireKey("l"); });
    expect(pushMock).toHaveBeenCalledWith("/x/learners");
    expect(result.current.activePrefix).toBeNull();
  });

  it("callback chord dispatches hf:chord:<callbackId> event", () => {
    const listener = vi.fn();
    window.addEventListener("hf:chord:tab:content", listener);
    renderHook(() => useChordShortcut(callbackChords));
    act(() => { fireKey("h"); fireKey("c"); });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    window.removeEventListener("hf:chord:tab:content", listener);
  });

  it("unmapped second key resets silently — no navigation, no event", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("h"); fireKey("z"); });
    expect(pushMock).not.toHaveBeenCalled();
    expect(result.current.activePrefix).toBeNull();
  });

  it("times out after 1.5 s — second key after timeout starts a fresh chord", () => {
    renderHook(() => useChordShortcut(navigateChords));
    // Arm with H, wait past timeout, then press C — should NOT navigate
    // because the chord engine forgot the H by then.
    act(() => { fireKey("h"); });
    act(() => { vi.advanceTimersByTime(1600); });
    act(() => { fireKey("c"); });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("Escape resets an armed prefix", () => {
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("h"); });
    act(() => { fireKey("Escape"); });
    expect(result.current.activePrefix).toBeNull();
  });

  it("skips when focus is in an INPUT element", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("h", { target: input }); });
    expect(result.current.activePrefix).toBeNull();
    document.body.removeChild(input);
  });

  it("skips when a role=dialog element is in the DOM", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    const { result } = renderHook(() => useChordShortcut(navigateChords));
    act(() => { fireKey("h"); });
    expect(result.current.activePrefix).toBeNull();
    document.body.removeChild(dialog);
  });

  it("no chords → hook does nothing (graceful empty)", () => {
    const { result } = renderHook(() => useChordShortcut([]));
    act(() => { fireKey("h"); fireKey("c"); });
    expect(result.current.activePrefix).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

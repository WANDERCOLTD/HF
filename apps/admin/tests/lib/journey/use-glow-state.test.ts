import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useGlowState } from "@/lib/journey/use-glow-state";

describe("useGlowState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts inactive", () => {
    const { result } = renderHook(() => useGlowState());
    expect(result.current.isActive).toBe(false);
  });

  it("activates while a save promise pends", async () => {
    const { result } = renderHook(() => useGlowState(100));
    let resolve!: () => void;
    const p = new Promise<void>((r) => {
      resolve = r;
    });
    act(() => {
      void result.current.run(p);
    });
    expect(result.current.isActive).toBe(true);
    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    // Glow stays on for `durationMs` after success
    expect(result.current.isActive).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(result.current.isActive).toBe(false);
  });

  it("deactivates immediately on rejection", async () => {
    const { result } = renderHook(() => useGlowState(100));
    let reject!: (e: Error) => void;
    const p = new Promise<void>((_, r) => {
      reject = r;
    });
    act(() => {
      void result.current.run(p).catch(() => {});
    });
    expect(result.current.isActive).toBe(true);
    await act(async () => {
      reject(new Error("boom"));
      await Promise.resolve();
    });
    expect(result.current.isActive).toBe(false);
  });
});

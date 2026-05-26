/**
 * Tests for useStableCallback — the useEvent RFC primitive used as a
 * stable-identity escape hatch in wizards + polling hooks.
 *
 * Contract:
 *   1. The returned callback's reference identity is stable across re-renders.
 *   2. Each invocation reads the LATEST `fn` (no stale closure).
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStableCallback } from "@/hooks/useStableCallback";

describe("useStableCallback", () => {
  it("returns the same reference across re-renders", () => {
    const { result, rerender } = renderHook(
      ({ fn }: { fn: (n: number) => number }) => useStableCallback(fn),
      { initialProps: { fn: (n: number) => n + 1 } },
    );

    const first = result.current;
    rerender({ fn: (n: number) => n + 2 });
    const second = result.current;
    rerender({ fn: (n: number) => n + 3 });
    const third = result.current;

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("always invokes the latest fn", () => {
    const a = vi.fn(() => "a");
    const b = vi.fn(() => "b");
    const c = vi.fn(() => "c");

    const { result, rerender } = renderHook(
      ({ fn }: { fn: () => string }) => useStableCallback(fn),
      { initialProps: { fn: a } },
    );

    expect(result.current()).toBe("a");
    expect(a).toHaveBeenCalledTimes(1);

    rerender({ fn: b });
    expect(result.current()).toBe("b");
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1); // unchanged

    rerender({ fn: c });
    expect(result.current()).toBe("c");
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("forwards arguments and return value to the wrapped fn", () => {
    const sum = vi.fn((x: number, y: number) => x + y);
    const { result } = renderHook(() => useStableCallback(sum));

    expect(result.current(2, 3)).toBe(5);
    expect(sum).toHaveBeenCalledWith(2, 3);
  });

  it("reads the latest fn when invoked via an old captured reference", () => {
    // Models the wizard hot path: a previously-captured stable callback
    // (e.g. inside a useCallback closure from a prior render) must still
    // pick up the latest fn body.
    const first = vi.fn(() => "first");
    const second = vi.fn(() => "second");

    const { result, rerender } = renderHook(
      ({ fn }: { fn: () => string }) => useStableCallback(fn),
      { initialProps: { fn: first } },
    );

    const capturedFromFirstRender = result.current;

    act(() => {
      rerender({ fn: second });
    });

    // Invoking the OLD reference should still hit the NEW fn.
    expect(capturedFromFirstRender()).toBe("second");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(0);
  });
});

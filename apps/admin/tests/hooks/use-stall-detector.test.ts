/**
 * #1743 (epic #1700 Theme 2b) — useStallDetector hook.
 *
 * Pinned acceptance:
 *   1. disabled → no chip even after silenceMs elapses
 *   2. empty pool → no chip even after silenceMs elapses
 *   3. chip fires after silenceMs of silence (no lastSpeechAt bump)
 *   4. chip cleared on the next lastSpeechAt bump
 *   5. round-robin: 2nd fire picks pool[1], 3rd picks pool[0] (with cooldown elapsed)
 *   6. cooldown: a fire within cooldownMs of the previous suppresses
 *   7. pool change → re-anchors the silence window
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useStallDetector } from "@/hooks/use-stall-detector";

const POOL = ["Take your time…", "When you're ready, carry on…"];

let currentTime = 0;
const now = () => currentTime;

beforeEach(() => {
  vi.useFakeTimers();
  currentTime = 1_000_000;
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    currentTime += ms;
    vi.advanceTimersByTime(ms);
  });
}

describe("useStallDetector", () => {
  it("(1) disabled → no chip even after silenceMs", () => {
    const { result } = renderHook(() =>
      useStallDetector({
        enabled: false,
        lastSpeechAt: null,
        pool: POOL,
        silenceMs: 10_000,
        cooldownMs: 10_000,
        now,
      }),
    );
    advance(20_000);
    expect(result.current.chip).toBeNull();
  });

  it("(2) empty pool → no chip even after silenceMs", () => {
    const { result } = renderHook(() =>
      useStallDetector({
        enabled: true,
        lastSpeechAt: null,
        pool: [],
        silenceMs: 10_000,
        cooldownMs: 10_000,
        now,
      }),
    );
    advance(20_000);
    expect(result.current.chip).toBeNull();
  });

  it("(3) chip fires after silenceMs of silence", () => {
    const { result } = renderHook(
      ({ ls }: { ls: number | null }) =>
        useStallDetector({
          enabled: true,
          lastSpeechAt: ls,
          pool: POOL,
          silenceMs: 10_000,
          cooldownMs: 10_000,
          now,
        }),
      { initialProps: { ls: currentTime } },
    );
    expect(result.current.chip).toBeNull();
    advance(11_000);
    expect(result.current.chip).toBe(POOL[0]);
  });

  it("(4) chip cleared on the next lastSpeechAt bump", () => {
    let lastSpeechAt = currentTime;
    const { result, rerender } = renderHook(
      ({ ls }: { ls: number }) =>
        useStallDetector({
          enabled: true,
          lastSpeechAt: ls,
          pool: POOL,
          silenceMs: 10_000,
          cooldownMs: 10_000,
          now,
        }),
      { initialProps: { ls: lastSpeechAt } },
    );
    advance(11_000);
    expect(result.current.chip).toBe(POOL[0]);
    // speech resumes — caller bumps lastSpeechAt
    lastSpeechAt = currentTime;
    rerender({ ls: lastSpeechAt });
    expect(result.current.chip).toBeNull();
  });

  it("(5) round-robin selection across fires", () => {
    let lastSpeechAt = currentTime;
    const { result, rerender } = renderHook(
      ({ ls }: { ls: number }) =>
        useStallDetector({
          enabled: true,
          lastSpeechAt: ls,
          pool: POOL,
          silenceMs: 5_000,
          cooldownMs: 1_000,
          now,
        }),
      { initialProps: { ls: lastSpeechAt } },
    );

    // Fire 1 → pool[0]
    advance(6_000);
    expect(result.current.chip).toBe(POOL[0]);

    // speech, re-silence — far past cooldown
    lastSpeechAt = currentTime;
    rerender({ ls: lastSpeechAt });
    advance(6_000);
    expect(result.current.chip).toBe(POOL[1]);

    // speech, re-silence — should rotate back to pool[0]
    lastSpeechAt = currentTime;
    rerender({ ls: lastSpeechAt });
    advance(6_000);
    expect(result.current.chip).toBe(POOL[0]);
  });

  it("(6) cooldown suppresses a second fire within cooldownMs", () => {
    let lastSpeechAt = currentTime;
    const { result, rerender } = renderHook(
      ({ ls }: { ls: number }) =>
        useStallDetector({
          enabled: true,
          lastSpeechAt: ls,
          pool: POOL,
          silenceMs: 1_000,
          cooldownMs: 30_000,
          now,
        }),
      { initialProps: { ls: lastSpeechAt } },
    );

    // Fire 1
    advance(1_500);
    expect(result.current.chip).toBe(POOL[0]);

    // speech bump + re-silence quickly — within cooldown
    lastSpeechAt = currentTime;
    rerender({ ls: lastSpeechAt });
    advance(1_500);
    expect(result.current.chip).toBeNull();
  });
});

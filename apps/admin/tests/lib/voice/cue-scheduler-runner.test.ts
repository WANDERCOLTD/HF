/**
 * Tests for lib/voice/cue-scheduler-runner.ts (#1742 follow-on).
 *
 * Pinned acceptance:
 *   1. `startCueSchedulerRunner` returns a handle and persists it under
 *      a single global symbol — double-start returns the same handle,
 *      no second timer
 *   2. `stopCueSchedulerRunner` clears the timer and the global symbol
 *   3. `tick()` calls drainDueCues with the supplied options
 *   4. Overlap guard — a tick that fires while another is in flight is
 *      skipped (no concurrent drainDueCues calls)
 *   5. Errors thrown by drainDueCues are swallowed + AppLogged; the
 *      runner keeps ticking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockDrain } = vi.hoisted(() => ({
  mockDrain: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ log: vi.fn() }));
vi.mock("@/lib/voice/cue-scheduler", () => ({
  drainDueCues: mockDrain,
}));

import {
  startCueSchedulerRunner,
  stopCueSchedulerRunner,
  __getRunnerHandle,
  tick,
} from "@/lib/voice/cue-scheduler-runner";

beforeEach(() => {
  vi.clearAllMocks();
  mockDrain.mockReset();
  mockDrain.mockResolvedValue({ fired: 0, failed: 0, skipped: 0 });
  // Ensure any prior test's runner is gone.
  stopCueSchedulerRunner();
});

afterEach(() => {
  stopCueSchedulerRunner();
});

describe("startCueSchedulerRunner", () => {
  it("starts a runner and stores it under the global symbol", () => {
    const handle = startCueSchedulerRunner({ intervalMs: 50 });
    expect(handle).not.toBeNull();
    expect(handle?.intervalMs).toBe(50);
    expect(__getRunnerHandle()).toBe(handle);
  });

  it("is idempotent — second call returns the same handle without spawning a second timer", () => {
    const h1 = startCueSchedulerRunner({ intervalMs: 50 });
    const h2 = startCueSchedulerRunner({ intervalMs: 50 });
    expect(h2).toBe(h1);
  });
});

describe("stopCueSchedulerRunner", () => {
  it("clears the timer and the global symbol", () => {
    startCueSchedulerRunner({ intervalMs: 50 });
    expect(__getRunnerHandle()).not.toBeNull();
    stopCueSchedulerRunner();
    expect(__getRunnerHandle()).toBeNull();
  });

  it("is idempotent — second call is a no-op", () => {
    stopCueSchedulerRunner();
    stopCueSchedulerRunner();
    expect(__getRunnerHandle()).toBeNull();
  });
});

describe("tick", () => {
  it("invokes drainDueCues with the supplied options", async () => {
    const handle = startCueSchedulerRunner();
    const drainOptions = { batchLimit: 8 };
    await tick(handle!, drainOptions);
    expect(mockDrain).toHaveBeenCalledWith(drainOptions);
  });

  it("overlap guard — a concurrent tick is dropped (inFlight=true skips)", async () => {
    const handle = startCueSchedulerRunner();
    let resolveDrain: (() => void) | undefined;
    mockDrain.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDrain = () => resolve();
        }),
    );
    const first = tick(handle!);
    // Second tick fires while the first is still pending → should drop
    const second = tick(handle!);
    await second;
    expect(mockDrain).toHaveBeenCalledTimes(1);
    resolveDrain?.();
    await first;
  });

  it("swallows drain errors and clears inFlight so the next tick runs", async () => {
    const handle = startCueSchedulerRunner();
    mockDrain.mockRejectedValueOnce(new Error("boom"));
    await tick(handle!);
    expect(handle!.inFlight).toBe(false);

    mockDrain.mockResolvedValueOnce({ fired: 0, failed: 0, skipped: 0 });
    await tick(handle!);
    expect(mockDrain).toHaveBeenCalledTimes(2);
  });
});

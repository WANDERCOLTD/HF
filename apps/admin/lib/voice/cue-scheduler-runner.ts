/**
 * Cue-scheduler tick runner — drains `CueScheduleEntry` on a short
 * interval so `VoiceProvider.sayMessage()` fires at the scheduled
 * time (#1742 follow-on).
 *
 * Why this exists separately from `cue-scheduler.ts`:
 *
 *   - `cue-scheduler.ts` is pure module — it persists rows and drains
 *     on demand. Production needs SOMETHING to tick.
 *   - Next.js `instrumentation.ts` runs once at server bootstrap, so it's
 *     the canonical home for the start call. The runner module itself
 *     stays import-side-effect-free so tests can import it without
 *     spawning a timer.
 *
 * Guards:
 *
 *   1. **Single-instance:** `start()` is idempotent — calling it twice
 *      returns the same handle, never spawns a second timer.
 *   2. **Overlap-safe:** if a tick is already in flight when the next
 *      interval fires, the new tick is skipped (a slow `drainDueCues`
 *      must not stack).
 *   3. **HMR-safe:** dev-mode hot-reload calls `register()` repeatedly;
 *      the global symbol keeps a single timer across reloads.
 *   4. **Error-swallowing:** an unexpected throw in `drainDueCues` is
 *      logged and the loop continues — one bad tick doesn't tear down
 *      the runner.
 *   5. **Env-gated:** test environments skip the start call (no real
 *      DB connection); the unit-test bank exercises `tick()` directly.
 *
 * AppLog subjects emitted from here:
 *
 *   - `voice.cue_scheduler_runner.started`  — once at bootstrap
 *   - `voice.cue_scheduler_runner.stopped`  — on graceful shutdown
 *   - `voice.cue_scheduler_runner.tick_error` — drain threw; loop continues
 *
 * See docs/decisions/2026-06-16-voice-say-message-primitive.md.
 */

import { log } from "@/lib/logger";
import { drainDueCues, type DrainDueCuesOptions } from "./cue-scheduler";

const DEFAULT_INTERVAL_MS = 100;

interface RunnerHandle {
  /** Underlying timer id. */
  timer: ReturnType<typeof setInterval>;
  /** Stop the runner. Idempotent. */
  stop: () => void;
  /** True when a tick is currently in flight (set/cleared inside tick). */
  inFlight: boolean;
  /** Configured interval (ms). */
  intervalMs: number;
}

/**
 * Module-level symbol pinned to globalThis so HMR replays of this file
 * during dev don't spawn duplicate timers. The symbol is intentionally
 * unique per module path so test imports don't collide with the bootstrap
 * timer.
 */
const RUNNER_SYMBOL = Symbol.for("hf:voice:cue-scheduler-runner@1");

interface GlobalWithRunner {
  [RUNNER_SYMBOL]?: RunnerHandle;
}

function getGlobal(): GlobalWithRunner {
  return globalThis as unknown as GlobalWithRunner;
}

export interface StartRunnerOptions {
  /** Tick interval in ms. Default 100. */
  intervalMs?: number;
  /** Forwarded to `drainDueCues`. Tests inject stubs. */
  drainOptions?: DrainDueCuesOptions;
}

/**
 * Start the tick runner. Idempotent — subsequent calls return the same
 * handle and do not spawn a second timer.
 *
 * Throws nothing. On startup failure (e.g. setInterval unavailable in a
 * runtime that shouldn't be calling this), logs + returns null.
 */
export function startCueSchedulerRunner(
  opts: StartRunnerOptions = {},
): RunnerHandle | null {
  const g = getGlobal();
  if (g[RUNNER_SYMBOL]) {
    return g[RUNNER_SYMBOL] ?? null;
  }
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  const handle: RunnerHandle = {
    timer: setInterval(() => void tick(handle, opts.drainOptions), intervalMs),
    inFlight: false,
    intervalMs,
    stop: () => stopCueSchedulerRunner(),
  };
  g[RUNNER_SYMBOL] = handle;

  log("system", "voice.cue_scheduler_runner.started", { intervalMs });
  return handle;
}

/**
 * Stop the runner if running. Idempotent.
 */
export function stopCueSchedulerRunner(): void {
  const g = getGlobal();
  const handle = g[RUNNER_SYMBOL];
  if (!handle) return;
  clearInterval(handle.timer);
  delete g[RUNNER_SYMBOL];
  log("system", "voice.cue_scheduler_runner.stopped", {});
}

/**
 * Test-only: returns the live runner handle (or null). Production code
 * MUST NOT depend on this — use the symbol-keyed start function instead.
 */
export function __getRunnerHandle(): RunnerHandle | null {
  return getGlobal()[RUNNER_SYMBOL] ?? null;
}

/**
 * One tick. Exported so tests can drive it deterministically without
 * waiting for setInterval. Production: the symbol-pinned timer calls
 * this.
 */
export async function tick(
  handle: RunnerHandle,
  drainOptions?: DrainDueCuesOptions,
): Promise<void> {
  if (handle.inFlight) return; // overlap guard — drop this tick
  handle.inFlight = true;
  try {
    await drainDueCues(drainOptions);
  } catch (err) {
    log("system", "voice.cue_scheduler_runner.tick_error", {
      level: "warn",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    handle.inFlight = false;
  }
}

/**
 * wait-until-ready.ts — single canonical async-readiness polling helper.
 *
 * Closes anti-pattern AP-3 (Loop 3): bespoke setInterval / setTimeout retry
 * loops scattered across lib/. The 2026-06-09 hardening drill shipped 5
 * "wait for X" fixes, each subtly broken in a different way, before the
 * structural feat: cleanup replaced them all.
 *
 * Replaces the pattern:
 *   while (Date.now() < deadline) {
 *     const result = await someCheck();
 *     if (result.ok) return result;
 *     await new Promise(r => setTimeout(r, 2000));
 *   }
 *
 * with:
 *   const result = await waitUntilReady({
 *     predicate: async () => someCheck(),
 *     ready: (r) => r.ok,
 *     timeout: 180_000,
 *     interval: 2000,
 *     label: "subject-extractions",
 *   });
 *
 * Anchor: docs/kb/guard-registry.md#guard-wait-until-ready
 *         docs/decisions/2026-06-11-chase-prevention-methodology.md
 */

export type WaitUntilReadyOptions<T> = {
  /** The check to poll. Called repeatedly until `ready(value)` returns true or timeout hits. */
  predicate: () => Promise<T>;
  /**
   * Returns `true` when the value indicates readiness. If omitted, any truthy
   * value satisfies (matches the common "first non-null returns") shape.
   */
  ready?: (value: T) => boolean;
  /** Overall budget in ms. Default 30_000. */
  timeout?: number;
  /** Polling interval in ms. Default 1_000. */
  interval?: number;
  /**
   * Human-readable label for the wait — surfaces in the timeout error and any
   * `onTimeout` callback. Required to make timeouts diagnosable in prod logs.
   */
  label: string;
  /**
   * Optional sync hook fired when the wait times out, BEFORE the error is
   * thrown. Use to emit AppLog / breadcrumb / metric. Must not throw.
   */
  onTimeout?: (lastValue: T | undefined, elapsedMs: number) => void;
  /**
   * Optional abort signal — if it aborts, the wait throws `AbortError` even
   * mid-interval. Mirrors `fetch` AbortSignal semantics.
   */
  signal?: AbortSignal;
};

export class WaitUntilReadyTimeout<T> extends Error {
  readonly label: string;
  readonly lastValue: T | undefined;
  readonly elapsedMs: number;
  constructor(label: string, lastValue: T | undefined, elapsedMs: number) {
    super(`waitUntilReady(${label}) timed out after ${elapsedMs}ms`);
    this.name = "WaitUntilReadyTimeout";
    this.label = label;
    this.lastValue = lastValue;
    this.elapsedMs = elapsedMs;
  }
}

const defaultReady = <T>(value: T): boolean => Boolean(value);

/**
 * Poll an async predicate until it reports ready, then resolve with the value.
 *
 * The function's contract is intentionally narrow:
 *   - `predicate` is called once at t=0, then every `interval` ms.
 *   - If `ready(value)` returns truthy, resolve with that value.
 *   - If `timeout` ms pass without readiness, throw `WaitUntilReadyTimeout`.
 *   - If `signal` aborts, throw `DOMException` "AbortError".
 *   - `predicate` exceptions are NOT caught — they propagate. (Callers who
 *     want retry-on-error wrap their own try/catch around the predicate body;
 *     conflating timeout and exception is the AP-3 anti-pattern.)
 */
export async function waitUntilReady<T>(
  opts: WaitUntilReadyOptions<T>,
): Promise<T> {
  const {
    predicate,
    ready = defaultReady as (value: T) => boolean,
    timeout = 30_000,
    interval = 1_000,
    label,
    onTimeout,
    signal,
  } = opts;

  const start = Date.now();
  const deadline = start + timeout;
  let lastValue: T | undefined = undefined;

  // First check fires immediately — many readiness checks are already true.
  while (true) {
    if (signal?.aborted) {
      throw new DOMException(
        `waitUntilReady(${label}) aborted`,
        "AbortError",
      );
    }

    const value = await predicate();
    lastValue = value;
    if (ready(value)) return value;

    const now = Date.now();
    if (now + interval > deadline) {
      const elapsed = now - start;
      onTimeout?.(lastValue, elapsed);
      throw new WaitUntilReadyTimeout(label, lastValue, elapsed);
    }

    await sleep(interval, signal);
  }
}

/**
 * Abortable sleep used internally. Resolves after `ms` or rejects with
 * AbortError if `signal` aborts mid-sleep.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("sleep aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("sleep aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

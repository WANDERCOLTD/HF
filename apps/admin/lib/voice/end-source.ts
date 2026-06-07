/**
 * #1241 — `Call.endSource` taxonomy.
 *
 * Schema column is a plain TEXT for cheap migration + open evolution; this
 * type is the canonical surface readers/writers should code against.
 *
 *   sdk     — VAPI Web SDK `call-end` event (browser hangup, Talk Here)
 *   sse     — SSE `call-ended` from server (PSTN hangup, end-of-call webhook)
 *   webhook — `persistEndOfCall` invoked by the server-side end-of-call writer
 *             (functionally equivalent to `sse` from the call's POV but
 *             tagged distinctly so we can tell client-aware drops apart
 *             from server-only ones)
 *   manual  — Operator clicked the End Call sheet button
 *   drop    — 30s silence watchdog OR stale-resume-on-mount sealed the call
 *   poll    — 90s server-side `poll-stale-calls` reconciler
 *   discard — Future "discard without pipeline" path
 */
export type CallEndSource =
  | "sdk"
  | "sse"
  | "webhook"
  | "manual"
  | "drop"
  | "poll"
  | "discard";

export const CALL_END_SOURCE_VALUES: readonly CallEndSource[] = [
  "sdk",
  "sse",
  "webhook",
  "manual",
  "drop",
  "poll",
  "discard",
];

export function isCallEndSource(v: unknown): v is CallEndSource {
  return typeof v === "string" && (CALL_END_SOURCE_VALUES as readonly string[]).includes(v);
}

/** Human-readable label for the wrap-marker UI. */
export function labelForEndSource(source: string | null | undefined): string {
  switch (source) {
    case "sdk":
    case "sse":
    case "webhook":
      return "Ended on phone";
    case "manual":
      return "Ended by you";
    case "drop":
      return "Connection lost";
    case "poll":
      return "Ended (server-side)";
    case "discard":
      return "Discarded";
    default:
      return "Call ended";
  }
}

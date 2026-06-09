/**
 * extract-failure-adaptation.ts
 *
 * #1340 (epic #1338 Slice 1) — ADAPT sub-op 8 (sequential batch).
 *
 * Reads `FailureLog` rows attached to a Session and derives a soft
 * adaptation signal that the next COMPOSE call can fold into its
 * "previous attempt" preamble. ADAPT's existing parameter-update
 * mechanism is not modified — this sub-op returns a typed string-shaped
 * signal that the pipeline route writes to a CallerAttribute the
 * composer reads (Slice 5 wiring; Slice 1 only emits + tests the signal).
 *
 * Intent: a learner whose previous Session was a ghost / VAPI 502 /
 * outbound-dial throw should hear "last time we couldn't connect, let's
 * try again" — NOT silence. ADAPT cannot teach if it doesn't know the
 * last attempt failed.
 *
 * Design boundary (per #1340 Risks section): we deliberately do NOT
 * push a `ParameterUpdate` into the rule-based ADAPT runner because:
 *   1. The runner consumes `AdaptationRule` shapes keyed on profile
 *      conditions; a failure signal is event-shaped, not condition-shaped.
 *   2. Forcing the signal through that surface couples failure recording
 *      to the spec-driven parameter graph — every new failure kind would
 *      need a matching parameter row.
 *   3. The composer is the right consumer: it already reads typed
 *      structured inputs from `CallerAttribute` (see flow-prompt-composition.md).
 *
 * Spike result (per Story #1340 "Spike needed? YES"): the existing
 * `runAdaptSpecs(callerId)` rule-based path does NOT accept a free-form
 * signal string — confirmed by reading `adapt-runner.ts::applyAdaptationRules`,
 * which only iterates `param.config.adaptationRules`. The clean hook-in
 * is a separate sub-op (this file) that emits the signal alongside the
 * existing runners. Slice 5 wires the COMPOSE-side read.
 *
 * Idempotency: the function is pure read-then-derive. Multiple calls
 * with the same FailureLog set return the same signal.
 *
 * @see docs/PIPELINE.md §7 — sub-op 8 in the sequential batch
 * @see github.com/.../issues/1340
 */

import type { FailureLog } from "@prisma/client";

/**
 * Soft signal returned by `extractFailureAdaptation`. ADAPT writes this
 * into `CallerAttribute(scope=CALLER, key="adapt:previous_attempt_failure")`;
 * COMPOSE reads it (Slice 5) and renders the `signal` string verbatim in
 * the composed prompt's preamble.
 *
 * `delta` is exported for forward-compatibility — Slice 5 may also bias
 * `session_confidence` slightly downward to nudge the agent toward
 * reassurance phrasing. Not consumed in Slice 1.
 */
export interface AdaptFailureSignal {
  /** Human-readable string the composer pastes into the prompt preamble. */
  readonly signal: string;
  /** Most-recent failure kind seen (drives signal phrasing). */
  readonly kind: string;
  /** Count of FailureLog rows behind this signal. */
  readonly failureCount: number;
  /** Suggested confidence delta — bias toward reassurance. Not consumed yet. */
  readonly delta: number;
  /** ISO timestamp of the most recent failure. */
  readonly mostRecentAt: string;
}

/**
 * No-op result returned when the Session has no FailureLog children.
 * Exported so callers can pattern-match without importing the interface.
 */
export const NO_FAILURE_SIGNAL: AdaptFailureSignal | null = null;

/**
 * Derive a soft adaptation signal from a FailureLog row.
 *
 * Returns null when the input is empty (no failures recorded), so the
 * sub-op never interferes with the existing seven ADAPT sub-ops on
 * normal Sessions with transcripts (per Story #1340 L7 risk).
 *
 * When passed an array, the most recent failure (by `occurredAt`) drives
 * the signal phrasing; earlier failures roll into the `failureCount`.
 */
export function extractFailureAdaptation(
  input: FailureLog | readonly FailureLog[] | null | undefined,
): AdaptFailureSignal | null {
  if (input === null || input === undefined) return null;

  const logs: readonly FailureLog[] = Array.isArray(input)
    ? (input as readonly FailureLog[])
    : ([input] as readonly FailureLog[]);

  if (logs.length === 0) return null;

  // Pick the most-recent failure to drive phrasing. Earlier failures
  // count toward the failureCount (visible to Slice 5 if it wants to
  // strengthen the reassurance).
  const sorted = [...logs].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
  const mostRecent = sorted[0];

  const signal = signalFor(mostRecent.kind);
  return {
    signal,
    kind: mostRecent.kind,
    failureCount: logs.length,
    delta: -0.1,
    mostRecentAt: mostRecent.occurredAt.toISOString(),
  };
}

/**
 * Map a FailureLog.kind to a learner-facing soft-acknowledge string.
 * Open-ended for forward compatibility — unknown kinds get a generic
 * phrasing rather than an exception (FailureLog.kind is a string column,
 * not an enum, by design — see schema comment).
 *
 * Exported for the vitest that asserts each documented kind produces a
 * distinct non-empty signal.
 */
export function signalFor(kind: string): string {
  switch (kind) {
    case "GHOST_NEVER_CONNECTED":
      return "previous attempt: connection never opened — let's try again together";
    case "VAPI_502":
      return "previous attempt: the voice provider rejected our request — let's try again";
    case "OUTBOUND_DIAL_FAILED":
      return "previous attempt: outbound dial failed before VAPI accepted it — let's try again";
    case "INTAKE_SCHEMA_FAIL":
      return "previous attempt: enrolment couldn't capture all the required details — let's pick up where we left off";
    default:
      return `previous attempt: ${kind.toLowerCase().replace(/_/g, " ")} — let's try again`;
  }
}

/**
 * Voice telemetry helper (AnyVoice #1080).
 *
 * Wraps `logUsageEventFireAndForget` with VOICE category + voice
 * provider as `engine`, and a stable operation taxonomy:
 *   - voice:<slug>:assistant-request
 *   - voice:<slug>:tool:<funcName>
 *   - voice:<slug>:knowledge-base-request
 *   - voice:<slug>:webhook:end-of-call
 *   - voice:<slug>:webhook:status-update
 *   - voice:<slug>:auth:invalid-signature
 *   - voice:<slug>:webhook:cap-tripped (cost-cap triggered requestEndCall)
 *
 * Performance notes:
 *   - Fire-and-forget: every call returns synchronously. Logger errors
 *     stay inside the helper. Critical inside the VAPI 7.5s tool deadline.
 *   - Cost: trickle events pass an explicit `costCents` — the `VOICE:*`
 *     cost rate is zero-cost fallback (operation-key not in
 *     DEFAULT_COST_RATES) so cost comes from the caller, not the
 *     rate table.
 *   - In-flight counter: module-level. Logs a warn at 100 outstanding
 *     so ops sees backpressure before it manifests as queue depth.
 */

import {
  logUsageEventFireAndForget,
  type UsageEventInput,
} from "@/lib/metering/usage-logger";

interface VoiceEventInput {
  /** VoiceProvider slug (engine on UsageEvent). */
  slug: string;
  /** Stable operation key — see file header for taxonomy. */
  operation: string;
  /** Wall-clock latency for the span, in ms. Always stored on metadata. */
  durationMs: number;
  /** Cost in cents (NOT USD). Use 1.00 USD = 100 for clarity. */
  costCents?: number;
  /** Call id when the event is scoped to a specific call. */
  callId?: string | null;
  /** Caller id when known at log time. */
  callerId?: string | null;
  /** Free-form context — error message, tool args, response code, etc. */
  metadata?: Record<string, unknown>;
  /** When the operation failed; flips success metadata to false. */
  errorMessage?: string;
}

// Module-level in-flight counter (#1080 Q1). Logs once at threshold,
// then resets when count drops below the floor. Cheap signal that lets
// ops see if Prisma's connection pool is starving without engineering
// a queue. p-limit is over-engineering for current voice volume.
let inFlight = 0;
const INFLIGHT_WARN_THRESHOLD = 100;
let warnedAtThreshold = false;

export function logVoiceEvent(input: VoiceEventInput): void {
  inFlight++;
  if (inFlight >= INFLIGHT_WARN_THRESHOLD && !warnedAtThreshold) {
    console.warn(
      `[voice/telemetry] in-flight UsageEvent writes >= ${INFLIGHT_WARN_THRESHOLD}; check Prisma connection pool`,
    );
    warnedAtThreshold = true;
  } else if (inFlight < INFLIGHT_WARN_THRESHOLD / 2) {
    warnedAtThreshold = false;
  }

  const payload: UsageEventInput = {
    category: "VOICE",
    operation: input.operation,
    callId: input.callId ?? undefined,
    callerId: input.callerId ?? undefined,
    quantity: 1,
    unitType: "count",
    engine: input.slug,
    metadata: {
      durationMs: input.durationMs,
      ...(input.costCents !== undefined ? { explicitCostCents: input.costCents } : {}),
      ...(input.errorMessage
        ? { error: input.errorMessage, success: false }
        : { success: true }),
      ...input.metadata,
    },
  };

  // Fire-and-forget — promise resolves later; the decrement happens in
  // the underlying Promise chain via a microtask. Use queueMicrotask so
  // the counter is bookkept even on the success path.
  logUsageEventFireAndForget(payload);
  queueMicrotask(() => {
    inFlight = Math.max(0, inFlight - 1);
  });
}

/**
 * Convenience wrapper for timing a span. Returns a function the caller
 * invokes when the span ends. Captures latency automatically.
 *
 *   const end = startVoiceSpan({ slug, operation: "..." });
 *   ...work...
 *   end({ callId, callerId, metadata: {...} });
 */
export function startVoiceSpan(input: {
  slug: string;
  operation: string;
}): (closeArgs?: {
  callId?: string | null;
  callerId?: string | null;
  costCents?: number;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}) => void {
  const startMs = Date.now();
  return (closeArgs?: {
    callId?: string | null;
    callerId?: string | null;
    costCents?: number;
    metadata?: Record<string, unknown>;
    errorMessage?: string;
  }): void => {
    logVoiceEvent({
      slug: input.slug,
      operation: input.operation,
      durationMs: Date.now() - startMs,
      ...closeArgs,
    });
  };
}

/** Test/observability accessor — does not zero the counter. */
export function getVoiceTelemetryInflightCount(): number {
  return inFlight;
}

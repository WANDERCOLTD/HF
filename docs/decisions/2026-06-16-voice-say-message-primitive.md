# 2026-06-16 — `VoiceProvider.sayMessage()` primitive design

**Story:** #1742 (epic #1700 Theme 2a). Spike for the say-message primitive +
cue-scheduler foundation.

## Status

Proposed. Ready for sign-off; primitive implementation gated on this ADR.

## Context

Epic #1700 Theme 2 needs a primitive that any `VoiceProvider` can implement
to inject a synthesised utterance from the assistant during a live call.
The driving use case (Theme 2b, #1743) is IELTS Part 2 — the tutor needs to
say "fifteen seconds left" at t=45s without the LLM re-deriving the cue every
call.

The epic body's drafting (2026-06-15) asserted:

> Implement on VAPI via VAPI's `POST /call/{id}/say` (confirm endpoint shape
> day 1 spike)

This ADR is the day-1 spike. The premise turned out to be wrong: VAPI
**does not expose** `POST /call/{id}/say`. The actual mechanism is different
on VAPI (HTTP POST to a per-call control URL returned at call-start) and
different again on Retell (WebSocket frame on the LLM-WSS the agent already
holds open). The primitive design has to live above both.

## Verified by

Provider research, 2026-06-16:

| Provider | Mechanism | Surface | Verified at |
|---|---|---|---|
| **VAPI** | HTTP POST to `Call.monitor.controlUrl` (per-call, returned at call-start when `assistant.monitorPlan.controlEnabled = true`) | `{type:"say", content:string, endCallAfterSpoken?:boolean}` body. `add-message` variant also exists (queues into history without speaking immediately). | [VAPI TS SDK Monitor type](https://raw.githubusercontent.com/VapiAI/server-sdk-typescript/main/src/api/types/Monitor.ts) + `https://docs.vapi.ai/calls/call-features.md` "Say Message" section |
| **Retell** | WebSocket frame on the LLM-WSS Retell has open to our `/api/voice/<slug>/llm` route | `{response_type:"agent_interrupt", interrupt_id:number, content:string, content_complete:boolean, no_interruption_allowed?:boolean}` | [Retell `llm-websocket` docs](https://docs.retellai.com/api-references/llm-websocket) "Agent Interrupt Event" section |
| **No say-message** | Future providers (LiveKit Agents, Pipecat, custom self-hosted) | N/A | declared `supportsProactiveSpeech: false` on capability flag → scheduler short-circuits with a no-op + AppLog warning |

## Decision

### 1. Interface — single optional method on `VoiceProvider`

```typescript
// lib/voice/types.ts

export interface SayMessageOptions {
  /** Free-text utterance to speak. */
  content: string;
  /**
   * Suppress learner barge-in for the duration of this utterance.
   * Retell honours this natively (`no_interruption_allowed: true`).
   * VAPI does not have a flag — the adapter ignores the option.
   */
  noInterruption?: boolean;
  /**
   * When true, the message lands in conversation history but is NOT
   * spoken immediately — useful for inserting tutor notes that the
   * LLM should be aware of on its NEXT turn. Maps to VAPI's
   * `add-message` control; Retell does not support a queue-only
   * variant (the agent_interrupt event always speaks).
   * Defaults to false.
   */
  queueOnly?: boolean;
  /** Caller-supplied correlation id for tracing. Echoed into AppLog. */
  traceId?: string;
}

export interface SayMessageResult {
  /** "spoken" = the wire call succeeded; the provider has accepted the
   *  utterance for synthesis. Does NOT mean TTS has finished playing.
   *  "queued" = added to history; provider will surface it on the next
   *  turn. "skipped" = capability flag is off or the call has ended.
   *  "failed" = transport failed; AppLog subject carries the error. */
  status: "spoken" | "queued" | "skipped" | "failed";
}

export interface VoiceProvider {
  // ... existing methods ...

  /**
   * Inject a synthesised utterance into the live call. Optional —
   * providers that can't push speech declare
   * `supportsProactiveSpeech: false` in capabilities and the cue
   * scheduler short-circuits.
   *
   * MUST be idempotent for a given (externalCallId, traceId) pair —
   * retries on transient transport errors are the scheduler's
   * responsibility.
   *
   * MUST NOT throw — returns `{ status: "failed" }` on transport
   * error and emits an AppLog subject. The cue scheduler treats
   * failure as a metric, not a thrown error.
   */
  sayMessage?(
    externalCallId: string,
    options: SayMessageOptions,
  ): Promise<SayMessageResult>;
}

export interface VoiceProviderCapabilities {
  // ... existing flags ...

  /**
   * True when the provider can accept server-initiated speech
   * injection during a live call (VAPI controlUrl, Retell
   * agent_interrupt). False when proactive speech must go through
   * the LLM turn loop (no out-of-band channel).
   *
   * Drives `cue-scheduler.ts` — when false, scheduled cues for this
   * call are logged-only (telemetry subject
   * `voice.cue_scheduler.skipped_no_capability`).
   */
  supportsProactiveSpeech: boolean;
}
```

### 2. VAPI implementation — HTTP POST to per-call `controlUrl`

The control URL is returned in `Call.monitor.controlUrl` at call-start, but
only when `assistant.monitorPlan.controlEnabled = true`. The adapter's
`buildAssistantConfig()` adds the flag (no operator opt-in — required for
the cue scheduler to work). The URL is captured at call-creation and
persisted on `Call.voiceProviderRaw` (existing column) so the adapter can
look it up by `externalCallId` at say-time.

```typescript
// lib/voice/providers/vapi/index.ts
async sayMessage(externalCallId, opts): Promise<SayMessageResult> {
  const controlUrl = await this.resolveControlUrl(externalCallId);
  if (!controlUrl) return { status: "skipped" };  // call ended / no URL

  const body = opts.queueOnly
    ? { type: "add-message", message: { role: "assistant", content: opts.content }, triggerResponseEnabled: false }
    : { type: "say", content: opts.content, endCallAfterSpoken: false };

  try {
    const res = await fetch(controlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log("system", "voice.vapi.say_message_failed", {
        level: "warn", externalCallId, status: res.status, traceId: opts.traceId,
      });
      return { status: "failed" };
    }
    return { status: opts.queueOnly ? "queued" : "spoken" };
  } catch (err) {
    log("system", "voice.vapi.say_message_failed", {
      level: "warn", externalCallId, error: String(err), traceId: opts.traceId,
    });
    return { status: "failed" };
  }
}
```

Capability: `supportsProactiveSpeech: true`.

**Persistence note:** `controlUrl` is a sensitive value (anyone with it can
make the call say anything). Store on `Call.voiceProviderRaw` which is already
operator-restricted; redact in any UI surface. `controlAuthenticationEnabled`
on VAPI's side defaults to false; we leave it false because we only POST from
inside our own VPC.

### 3. Retell implementation — frame on the existing LLM WSS

Retell's `agent_interrupt` is sent on the **same WebSocket** the LLM-WSS
handler holds open at `/api/voice/<slug>/llm/ws`. The HF adapter's
`sayMessage()` can't open a new connection — it must enqueue an event that
the LLM-WSS handler picks up on its next loop iteration.

```typescript
// lib/voice/providers/retell/index.ts (sketch — full impl in #1742)
async sayMessage(externalCallId, opts): Promise<SayMessageResult> {
  // Enqueue into the per-call SSE registry. The Retell LLM-WSS handler
  // subscribes and drains on each loop tick.
  const enqueued = await sseRegistry.enqueue(externalCallId, {
    kind: "vapi.say",  // re-used kind name; handler dispatches per provider
    content: opts.content,
    noInterruption: opts.noInterruption ?? false,
    traceId: opts.traceId,
  });
  return enqueued ? { status: "spoken" } : { status: "skipped" };
}
```

Capability: `supportsProactiveSpeech: true` (functionally — the handler ticks
~every 50ms; ±200ms target stays in budget).

### 4. Scheduler — `lib/voice/cue-scheduler.ts`

Pure scheduler. Owns three responsibilities:

1. **Register**: `scheduleCue(externalCallId, atSeconds, options: SayMessageOptions)`
   — persists a `CueScheduleEntry` row keyed on `(externalCallId,
   scheduledFor)`. Cancellable.
2. **Fire**: a single setInterval (in `lib/async/cron.ts` style — NOT in a
   route handler — to satisfy decision 4 of the parent epic). On each tick,
   `SELECT * FROM CueScheduleEntry WHERE scheduledFor <= NOW() AND firedAt
   IS NULL`. For each row, look up the provider for the call, call
   `provider.sayMessage(externalCallId, options)`, stamp `firedAt`.
3. **Cancel**: on Session end, mark all unfired entries `cancelledAt`.

**Storage:** new table `CueScheduleEntry` with columns
`(id, externalCallId, callId?, scheduledFor, content, options Json,
firedAt?, cancelledAt?, status, traceId)`. Sibling to existing
`CallerSequenceCounter` (atomic counter sibling).

**Timing accuracy:** scheduler tick interval is 100ms; `sayMessage()` wire
latency ~50–150ms; total budget ~200ms p99 — meets the story's ±200ms
acceptance criterion. Documented in the scheduler header.

**Restart safety:** because entries are DB-backed, a server restart between
`scheduleCue` and `scheduledFor` does not lose the cue. The tick loop picks
it up on resume.

### 5. AppLog subjects

- `voice.cue_scheduler.registered` — at `scheduleCue` time
- `voice.cue_scheduler.fired` — when `sayMessage` returns `spoken`/`queued`
- `voice.cue_scheduler.skipped_no_capability` — provider declared `false`
- `voice.cue_scheduler.late` — `scheduledFor < firedAt - 500ms` (drift alarm)
- `voice.{vapi,retell}.say_message_failed` — provider-side transport error

## Lattice survey

- **Sibling-writer drift:** NIL — new chokepoint method on the existing
  `VoiceProvider` interface; capability-flag-gated; mirrors the
  `requestEndCall` precedent.
- **Default-deny gates:** new `supportsProactiveSpeech` flag defaults
  `false` for adapters that don't implement; scheduler logs + no-ops.
- **Cascade respect:** N/A — the primitive is call-scoped, not setting-cascadable.
- **Convention conflict:** NIL — capability flag + optional method matches
  the `requestEndCall?(externalCallId)` precedent at
  `lib/voice/types.ts:444`.
- **AI-to-DB guard / AI-read grounding:** N/A — scheduler is deterministic;
  no AI output drives the wire call.

## Alternatives considered

1. **HTTP POST to `api.vapi.ai/call/{id}/say` (epic body's premise)** —
   does not exist in the documented HTTP API per VAPI's OpenAPI spec
   (`https://api.vapi.ai/api-json`). Rejected.
2. **Single-transport primitive (HTTP only)** — would force Retell to open
   a side-channel HTTP control endpoint, which doesn't exist. Rejected —
   asymmetric transport is intrinsic to the provider boundary.
3. **Capability flag on `VoiceProviderCapabilities` without a primitive** —
   would push the scheduler's transport logic into the route layer.
   Rejected — defeats the AnyVoice abstraction the existing adapter
   pattern is built on.
4. **In-memory cue queue (no DB persistence)** — restart-fragile; cues
   scheduled for t=60s would silently drop if a deploy lands at t=30s.
   Rejected.

## Open questions

None blocking. The flag rollout follows the existing
`HF_FLAG_IELTS_MODULE_SETTINGS` pattern — primitive ships behind
`HF_FLAG_VOICE_SAY_MESSAGE` until the cue-scheduler vitest bank pins
±200ms accuracy on a synthetic harness.

## What changes after sign-off

1. File the implementation patch for #1742:
   - `VoiceProvider.sayMessage?()` + capability flag in `lib/voice/types.ts`
   - VAPI adapter — `buildAssistantConfig` sets `monitorPlan.controlEnabled = true`; `normaliseEndOfCallEvent` captures `monitor.controlUrl` onto `Call.voiceProviderRaw`; `sayMessage()` implements the POST
   - Retell adapter — no-op stub returning `{status:"skipped"}` until Retell's LLM-WSS handler is wired
   - `lib/voice/cue-scheduler.ts` + `CueScheduleEntry` model + migration
   - Vitests pinning ±200ms p99, restart safety, cancellation
2. #1743 (Theme 2b) becomes unblocked.

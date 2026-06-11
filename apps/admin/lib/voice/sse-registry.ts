/**
 * SSE-subscriber registry for live voice calls (#1092 "Call me" mixed mode).
 *
 * The "mixed-mode" rail router uses this to decide where `share_content`,
 * `send_text_to_caller`, and `request_artifact` deliver during a live
 * provider call:
 *   - Chat surface subscribed → broadcast to the SSE channel (inline)
 *   - No subscriber → fall back to the caller's SMS / WhatsApp rail
 *
 * Single-process Map. Cross-instance broadcast (Pub/Sub) is a documented
 * follow-up — Cloud Run's single-instance default is fine for dev + staging.
 *
 * The registry is keyed on **local `Call.id`** (not the provider's
 * externalCallId) so SSE consumers and tool-router callers speak the
 * same identifier the rest of the codebase uses.
 *
 * Consumed by:
 *   - `GET /api/voice/calls/[callId]/stream` — registers / unregisters
 *     a subscriber for the duration of the SSE connection
 *   - `lib/voice/tool-router.ts` (this story) — `hasSubscriberForCall`
 *     checks before falling back to SMS / WhatsApp
 *   - `lib/voice/runtime-features.ts` (#1093) — feeds
 *     `runtime.hasLiveChatRail` into capability-aware prompt rendering
 *
 * IMPORTANT: do NOT instantiate `PrismaClient` inside this file. The
 * registry is a pure in-memory data structure. Database access must
 * happen through `@/lib/prisma` from call-sites, never here.
 */

/** Payload broadcast to all subscribers for a call. The event taxonomy
 *  is documented in `docs/CHAIN-CONTRACTS.md` (Link 3 — voice provider
 *  transport adapter sub-contract, #1016) for any clip-on client
 *  (mobile / embed / third-party). */
export type VoiceCallSseEvent =
  | {
      type: "call-started";
      callId: string;
      durationLimitMs: number | null;
      /**
       * Cascade-resolved `transcriptStreamEnabled` (#1373). When false,
       * the SSE channel still serves `call-started` + `call-ended` but
       * `transcript-partial` broadcasts are suppressed server-side. The
       * client uses this to render a header pill ("Live bubbles on" /
       * "Bubbles off — appears after the call") so the absence of
       * partials is unambiguous.
       */
      transcriptStreamEnabled: boolean;
      timestampMs: number;
    }
  | {
      type: "transcript-partial";
      callId: string;
      role: "learner" | "assistant";
      text: string;
      timestampMs: number;
    }
  | {
      type: "share-content";
      callId: string;
      mediaId: string;
      caption: string | null;
      rail: "chat" | "sms" | "whatsapp";
      timestampMs: number;
    }
  | {
      type: "send-text";
      callId: string;
      message: string;
      rail: "chat" | "sms" | "whatsapp";
      timestampMs: number;
    }
  | {
      type: "request-artifact";
      callId: string;
      artifactId: string;
      title: string | null;
      timestampMs: number;
    }
  | {
      type: "call-ended";
      callId: string;
      reason: string | null;
      totalDurationMs: number | null;
      timestampMs: number;
    };

/** A single SSE subscriber callback. Returning a rejected promise is
 *  treated as "client disconnected" and the subscriber is dropped on
 *  the next broadcast. */
export type VoiceCallSseSubscriber = (
  event: VoiceCallSseEvent,
) => void | Promise<void>;

const _subscribers = new Map<string, Set<VoiceCallSseSubscriber>>();

/**
 * Register a subscriber for a call. Returns a no-op `unregister` fn the
 * SSE route MUST call from the connection's `close` / `abort` handler.
 *
 * Idempotent — calling `register` twice with the same callback (or
 * re-registering after an `unregister`) is safe.
 */
export function registerSubscriber(
  callId: string,
  fn: VoiceCallSseSubscriber,
): () => void {
  let set = _subscribers.get(callId);
  if (!set) {
    set = new Set();
    _subscribers.set(callId, set);
  }
  set.add(fn);
  // #922 — diagnostic: surface subscriber attaches in /x/logs so the
  // "chat rail didn't render" report can answer "did the browser even
  // connect?" without sniffing the wire. Fire-and-forget — never await
  // the logger from a connection-attach path.
  void import("@/lib/logger").then(({ log }) => {
    log("api", "voice.sse.subscriber_attach", {
      level: "info",
      callId,
      subscriberCount: set!.size,
    });
  });
  return () => unregisterSubscriber(callId, fn);
}

export function unregisterSubscriber(
  callId: string,
  fn: VoiceCallSseSubscriber,
): void {
  const set = _subscribers.get(callId);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) {
    _subscribers.delete(callId);
  }
}

/**
 * Returns true when at least one SSE subscriber is currently connected
 * for the given call. The rail router uses this to decide chat-via-SSE
 * vs SMS/WhatsApp delivery.
 *
 * Consumed by `lib/voice/tool-router.ts` (this story) and
 * `lib/voice/runtime-features.ts` (#1093) — both consume the same
 * source of truth so the prompt's mid-call instructions and the
 * tool-result rail metadata can never disagree.
 */
export function hasSubscriberForCall(callId: string): boolean {
  const set = _subscribers.get(callId);
  return !!set && set.size > 0;
}

/**
 * Broadcast an event to every subscriber for a call. Subscribers whose
 * callback throws or rejects are dropped silently — the SSE route's
 * close handler will also call `unregisterSubscriber`, so the cleanup
 * here is belt-and-braces.
 */
export async function broadcastToCall(event: VoiceCallSseEvent): Promise<void> {
  const set = _subscribers.get(event.callId);
  // #922 — every broadcast attempt logs whether subscribers existed.
  // This answers "did the transcript event reach the browser?" from
  // /x/logs alone.
  void import("@/lib/logger").then(({ log }) => {
    log("api", "voice.sse.broadcast", {
      level: "info",
      callId: event.callId,
      eventType: event.type,
      subscriberCount: set?.size ?? 0,
      delivered: set && set.size > 0,
    });
  });
  if (!set || set.size === 0) return;
  const failed: VoiceCallSseSubscriber[] = [];
  await Promise.all(
    Array.from(set).map(async (fn) => {
      try {
        await fn(event);
      } catch {
        failed.push(fn);
      }
    }),
  );
  for (const fn of failed) set.delete(fn);
}

/** For tests + admin debug: count of active subscribers per call. */
export function subscriberCountForCall(callId: string): number {
  return _subscribers.get(callId)?.size ?? 0;
}

/** For tests only: reset all in-memory state. */
export function _resetSseRegistry(): void {
  _subscribers.clear();
}

/**
 * useProviderCall — mixed-mode voice + chat hook for SimChat (#1092).
 *
 * Wraps the three steps the SIM surface needs to make a real provider
 * call (WebRTC via VAPI Web SDK today; Retell stays out-of-scope):
 *
 *   1. POST /api/voice/calls/start → receive `{callId, providerSlug,
 *      webrtcConfig}` from the cascade-resolved provider
 *   2. Lazy-import `@vapi-ai/web` and start the WebRTC session with the
 *      caller's publicKey
 *   3. Open SSE on `/api/voice/calls/[callId]/stream` — incremental
 *      transcripts arrive here and surface to the chat surface, plus
 *      `share-content` / `send-text` / `request-artifact` events fire
 *      when the AI calls tools mid-call
 *
 * The hook is decoupled from React state shape — caller supplies
 * `onTranscript`, `onShareContent`, etc. callbacks. SimChat can keep its
 * messages-array shape internal; this hook just emits events.
 *
 * NOT bundled with the rest of SimChat: dynamic-imports `@vapi-ai/web`
 * only after `[Call me]` is clicked so the lobby bundle stays small.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceCallSseEvent } from "@/lib/voice/sse-registry";

export type ProviderCallStatus =
  | "idle"
  | "starting"
  | "connecting"
  | "active"
  | "ended"
  | "error";

/**
 * Extract the most useful error string from an unknown caught value.
 * VAPI's web SDK and various lazy-import failure modes throw shapes
 * that aren't always Error instances — typed strings, plain objects
 * with .message, Promise-rejection reasons. Pre-#1380 the catch
 * collapsed to "(undefined)" for any of these. Walks the common
 * shapes in priority order; returns empty string when nothing useful
 * could be found, so the caller can fall back to a default label.
 */
function describeError(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const parts = [err.message];
    // Some SDKs wrap the real cause inside .cause (ES2022) or .reason.
    const e = err as Error & { cause?: unknown; reason?: unknown };
    if (e.cause) parts.push(`cause: ${describeError(e.cause)}`);
    if (e.reason) parts.push(`reason: ${describeError(e.reason)}`);
    return parts.filter(Boolean).join(" — ");
  }
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.length > 0) return o.message;
    if (typeof o.error === "string" && o.error.length > 0) return o.error;
    if (typeof o.reason === "string" && o.reason.length > 0) return o.reason;
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json.slice(0, 240);
    } catch {
      // circular / non-serialisable — fall through
    }
  }
  try {
    const s = String(err);
    return s === "undefined" || s === "null" ? "" : s;
  } catch {
    return "";
  }
}

interface ProviderCallStartResponse {
  ok: boolean;
  callId?: string;
  providerSlug?: string;
  adapterKey?: string;
  mode?: "webrtc";
  webrtcConfig?: {
    sdk: "vapi" | "retell";
    publicKey?: string;
    callerName?: string | null;
    /** Inline assistant config built server-side (PR voice-cost-knobs).
     *  Web SDK consumes this directly via vapi.start(assistantConfig)
     *  — no assistant-request webhook involved on the WebRTC path. */
    assistantConfig?: Record<string, unknown>;
  };
  expiresAt?: string;
  error?: string;
}

interface UseProviderCallOptions {
  callerId: string;
  intent?: "chat" | "audio-only";
  overrideProviderSlug?: string;
  /**
   * #1391 — module slug the learner picked (via URL `?requestedModuleId=`
   * or `Caller.lastSelectedModuleId`). Forwarded to /api/voice/calls/start
   * so `createCallEnteringPipeline` attributes the placeholder Call with
   * `requestedModuleId` + `curriculumModuleId` at creation time, before
   * any pipeline event fires. Without this the URL param was dropped at
   * the hook boundary.
   */
  requestedModuleId?: string;
  onSseEvent?: (event: VoiceCallSseEvent) => void;
}

interface ProviderCallApi {
  status: ProviderCallStatus;
  callId: string | null;
  providerSlug: string | null;
  errorMessage: string | null;
  /** #1241 — which event flipped status to "ended". Lets SimChat tag
   *  `Call.endSource` so analytics can break drops down by signal type.
   *  Null until status === 'ended'. */
  endedBy: "sdk" | "sse" | null;
  start: () => Promise<void>;
  end: () => Promise<void>;
}

export function useProviderCall(
  options: UseProviderCallOptions,
): ProviderCallApi {
  const [status, setStatus] = useState<ProviderCallStatus>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [providerSlug, setProviderSlug] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [endedBy, setEndedBy] = useState<"sdk" | "sse" | null>(null);

  // Stash the SDK instance + SSE so we can tear them down without
  // races. `unknown` because the SDK is dynamically imported and we
  // don't ship its types in the main bundle.
  const sdkRef = useRef<{
    stop?: () => Promise<void> | void;
    on?: (event: string, cb: (...args: unknown[]) => void) => void;
  } | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Keep the callback stable across renders — consumers won't rebuild
  // the SDK / SSE every keystroke.
  const onSseEventRef = useRef(options.onSseEvent);
  useEffect(() => {
    onSseEventRef.current = options.onSseEvent;
  }, [options.onSseEvent]);

  const closeSse = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  const teardown = useCallback(async () => {
    closeSse();
    if (sdkRef.current) {
      try {
        await sdkRef.current.stop?.();
      } catch (err) {
        console.warn("[useProviderCall] SDK stop failed:", err);
      }
      sdkRef.current = null;
    }
  }, [closeSse]);

  const end = useCallback(async () => {
    await teardown();
    setStatus("ended");
  }, [teardown]);

  // Open the SSE stream and dispatch events to the consumer callback.
  const openSse = useCallback((cid: string) => {
    const url = `/api/voice/calls/${encodeURIComponent(cid)}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    sseRef.current = es;

    const dispatch = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as VoiceCallSseEvent;
        onSseEventRef.current?.(parsed);
        if (parsed.type === "call-ended") {
          // The provider has signalled the call is done — flip status
          // and unwind. SDK stop runs in `end()` if the user clicks
          // first; if the server flipped first we still close here.
          setEndedBy((prev) => prev ?? "sse");
          setStatus("ended");
          closeSse();
        }
      } catch (err) {
        console.warn("[useProviderCall] SSE parse error:", err);
      }
    };

    // The server emits one event per type — we register a single
    // `message` handler plus named handlers so both shapes work.
    es.onmessage = dispatch;
    [
      "call-started",
      "transcript-partial",
      "share-content",
      "send-text",
      "request-artifact",
      "call-ended",
    ].forEach((name) => {
      es.addEventListener(name, dispatch as EventListener);
    });
    es.onerror = (err) => {
      console.warn("[useProviderCall] SSE error:", err);
    };
  }, [closeSse]);

  const start = useCallback(async () => {
    setStatus("starting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/voice/calls/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerId: options.callerId,
          intent: options.intent ?? "chat",
          ...(options.overrideProviderSlug
            ? { overrideProviderSlug: options.overrideProviderSlug }
            : {}),
          ...(options.requestedModuleId
            ? { requestedModuleId: options.requestedModuleId }
            : {}),
        }),
      });
      const body = (await res.json()) as ProviderCallStartResponse;
      if (!res.ok || !body.ok || !body.callId) {
        throw new Error(body.error ?? `Call start failed (HTTP ${res.status})`);
      }
      setCallId(body.callId);
      setProviderSlug(body.providerSlug ?? null);

      // Open SSE BEFORE the WebRTC session so the chat surface is
      // already subscribed when the first transcript-partial arrives.
      openSse(body.callId);

      if (body.webrtcConfig?.sdk === "vapi") {
        if (!body.webrtcConfig.publicKey) {
          throw new Error(
            "Voice provider is missing a public key. Configure it on the provider in admin settings.",
          );
        }
        // Lazy-import — keeps the lobby bundle small. The package is
        // documented in PR #1092 as a hard dep so npm install will
        // have pulled it before this fires.
        setStatus("connecting");
        const mod = (await import("@vapi-ai/web")) as { default: new (key: string) => unknown };
        const VapiCtor = mod.default;
        const vapi = new VapiCtor(body.webrtcConfig.publicKey) as {
          start: (assistantOrId: string | Record<string, unknown>) => Promise<unknown>;
          stop: () => Promise<void> | void;
          on: (event: string, cb: (...args: unknown[]) => void) => void;
        };
        sdkRef.current = vapi;

        // #1381 — Register listeners BEFORE calling start(). VAPI's web
        // SDK uses an EventEmitter (Node-style polyfill in the browser
        // bundle). If start() emits an "error" event before a listener
        // is attached, the polyfill throws synchronously with the
        // generic message "Unhandled error. (undefined)" — exactly
        // what showed up in /sim screenshots when the call failed.
        // Reordering catches the real cause and routes it to the UI.
        vapi.on("error", (err: unknown) => {
          console.error("[useProviderCall] vapi error event:", err);
          const msg = describeError(err) || "Voice provider error (see console)";
          setErrorMessage(msg);
          setStatus("error");
        });
        vapi.on("call-end", () => {
          setEndedBy((prev) => prev ?? "sdk");
          setStatus("ended");
          teardown();
        });

        // Path B (PR voice-cost-knobs): HF built the full assistant
        // config server-side and we pass it inline. The Web SDK does
        // NOT trigger our /api/voice/vapi/assistant-request webhook —
        // that's only for PSTN dial-in. So inline is mandatory.
        const assistantConfig = body.webrtcConfig.assistantConfig;
        if (!assistantConfig) {
          throw new Error(
            "Server did not return an inline assistant config. The Web SDK can't start without one.",
          );
        }
        // Our builder returns `{ assistant: {...} }`; the Web SDK
        // accepts the inner assistant object. Strip the envelope.
        const inlineAssistant =
          (assistantConfig as { assistant?: Record<string, unknown> })
            .assistant ?? assistantConfig;
        await vapi.start(inlineAssistant);
        setStatus("active");
      } else {
        // Retell WebRTC is out of scope for #1092 — placeholder error.
        throw new Error(
          `Provider ${body.webrtcConfig?.sdk ?? "(unknown)"} WebRTC mode is not wired yet.`,
        );
      }
    } catch (err) {
      // #1380 — Richer error capture. Pre-fix the catch did
      // `err instanceof Error ? err.message : String(err)` which gave
      // "(undefined)" for any thrown undefined / Promise rejection with
      // no message. console.error the raw err so devtools can inspect
      // the full object shape; describeError extracts the best string.
      console.error("[useProviderCall] start failed — raw error:", err);
      const msg = describeError(err) || "Voice session failed to start (see console)";
      setErrorMessage(msg);
      setStatus("error");
      await teardown();
    }
  }, [openSse, options.callerId, options.intent, options.overrideProviderSlug, options.requestedModuleId, teardown]);

  useEffect(() => {
    return () => {
      // Unmount → unconditional teardown.
      void teardown();
    };
  }, [teardown]);

  return {
    status,
    callId,
    providerSlug,
    errorMessage,
    endedBy,
    start,
    end,
  };
}

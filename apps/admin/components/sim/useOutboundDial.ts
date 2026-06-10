/**
 * useOutboundDial — PSTN [Call me] hook for SimChat (#1092 follow-up).
 *
 * Different surface from `useProviderCall`:
 *   - useProviderCall = browser WebRTC ([Talk Here] button)
 *   - useOutboundDial = VAPI rings the learner's actual phone
 *
 * Three states the caller might be in when they click [Call me]:
 *   1. We don't know yet whether they have a phone → fetch + decide
 *   2. They have a phone → confirm + dial
 *   3. They don't have one → inline form: "what's your phone number?"
 *
 * The hook handles the phone-capture round-trip and the dial trigger.
 * The UI just renders the state machine.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DialStatus =
  | "idle"
  | "loading-phone" // fetching the caller's phone-on-file
  | "needs-phone"   // we know there's no phone — show capture form
  | "saving-phone"
  | "dialing"       // VAPI dial request fired
  | "ringing"       // dial succeeded; phone is ringing
  | "error";

interface DialApi {
  status: DialStatus;
  /** Last 4 of the phone number on file, masked. Empty when missing. */
  phoneMasked: string;
  errorMessage: string | null;
  /** HF placeholder Call.id once the dial fires (#1368). Consumers use
   *  this as the SSE subscription key — `/api/voice/calls/<id>/stream`
   *  delivers transcript-partial events so SimChat can show live
   *  bubbles during a PSTN call, mirroring the WebRTC path. Null
   *  before dial fires; set in dialing/ringing state; cleared on reset. */
  callId: string | null;
  /** Trigger from the [Call me] button. */
  start: () => Promise<void>;
  /** Submit the just-in-time phone form. */
  savePhoneAndDial: (phone: string) => Promise<void>;
  /** Operator override: cancel everything. */
  reset: () => void;
}

interface UseOutboundDialOptions {
  callerId: string;
}

export function useOutboundDial(options: UseOutboundDialOptions): DialApi {
  const [status, setStatus] = useState<DialStatus>("idle");
  const [phoneMasked, setPhoneMasked] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);

  // Cache the resolved phone so we don't re-fetch on every click.
  const resolvedPhoneRef = useRef<string | null | "unknown">("unknown");

  const reset = useCallback(() => {
    setStatus("idle");
    setErrorMessage(null);
    setCallId(null);
  }, []);

  const maskPhone = (p: string): string => {
    if (p.length < 4) return p;
    return `${"*".repeat(Math.max(p.length - 4, 3))}${p.slice(-4)}`;
  };

  const fetchPhone = useCallback(async (): Promise<string | null> => {
    const res = await fetch(`/api/callers/${options.callerId}`);
    if (!res.ok) {
      throw new Error("Couldn't load your profile. Try again in a moment.");
    }
    const body = (await res.json()) as
      | { ok?: boolean; caller?: { phone?: string | null }; phone?: string | null }
      | null;
    // The /api/callers/[id] response shape varies; both keys are common.
    const phone =
      body?.caller?.phone ?? body?.phone ?? null;
    return phone ?? null;
  }, [options.callerId]);

  const fireDial = useCallback(async (): Promise<void> => {
    setStatus("dialing");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/voice/calls/outbound-dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerId: options.callerId }),
      });
      const body = (await res.json()) as
        | {
            ok?: boolean;
            error?: string;
            callId?: string;
            vapiCallId?: string;
            /** #1438 — structured detail from VAPI validation errors,
             *  e.g. ["assistant.backgroundSound must be a valid URL or…"].
             *  Surfaced inline so the operator sees the actionable string
             *  instead of just the coarse "Bad Request". */
            vapiDetails?: string[];
          }
        | null;
      if (!res.ok || !body?.ok) {
        const base =
          body?.error ??
          `Dial failed (HTTP ${res.status}). Try again or check provider settings.`;
        const detail = body?.vapiDetails?.[0];
        throw new Error(detail ? `${base} — ${detail}` : base);
      }
      // #1368 — expose HF placeholder Call.id so SimChat can open SSE
      // on /api/voice/calls/<id>/stream for live transcript bubbles.
      if (body.callId) setCallId(body.callId);
      setStatus("ringing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatus("error");
    }
  }, [options.callerId]);

  const start = useCallback(async () => {
    setErrorMessage(null);
    // Refresh phone state if we haven't resolved yet (or it was missing
    // earlier and the operator might have just added one in the admin).
    if (resolvedPhoneRef.current === "unknown") {
      setStatus("loading-phone");
      try {
        const phone = await fetchPhone();
        resolvedPhoneRef.current = phone;
        if (phone) {
          setPhoneMasked(maskPhone(phone));
          await fireDial();
        } else {
          setStatus("needs-phone");
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    } else if (resolvedPhoneRef.current === null) {
      setStatus("needs-phone");
    } else {
      setPhoneMasked(maskPhone(resolvedPhoneRef.current));
      await fireDial();
    }
  }, [fetchPhone, fireDial]);

  const savePhoneAndDial = useCallback(async (phone: string) => {
    setStatus("saving-phone");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/callers/${options.callerId}/phone`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = (await res.json()) as
        | { ok?: boolean; phone?: string; error?: string }
        | null;
      if (!res.ok || !body?.ok || !body.phone) {
        throw new Error(
          body?.error ??
            `Couldn't save your phone number (HTTP ${res.status}).`,
        );
      }
      resolvedPhoneRef.current = body.phone;
      setPhoneMasked(maskPhone(body.phone));
      await fireDial();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatus("error");
    }
  }, [fireDial, options.callerId]);

  useEffect(() => {
    // Reset state when the caller switches (re-mount on key change too).
    resolvedPhoneRef.current = "unknown";
    setStatus("idle");
    setPhoneMasked("");
    setErrorMessage(null);
    setCallId(null);
  }, [options.callerId]);

  return {
    status,
    phoneMasked,
    errorMessage,
    callId,
    start,
    savePhoneAndDial,
    reset,
  };
}

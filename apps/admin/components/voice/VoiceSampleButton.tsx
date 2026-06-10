/**
 * VoiceSampleButton — TTS preview for the configured voice (#1421 Slice B).
 *
 * Drop next to a voiceId input. Click → POSTs to
 * `/api/voice-providers/[id]/sample` → plays audio/mpeg blob.
 *
 * Visual states:
 *   - idle:    [▶ Test voice]
 *   - loading: [⟳ spinner — Generating…]
 *   - playing: [■ Stop]
 *   - error:   inline copy below the row + button returns to idle
 *
 * Caveat label: when the server-side dispatch falls back to OpenAI TTS
 * (because no HF-direct Deepgram key is configured on the VoiceProvider
 * row), the response carries `X-HF-Sample-Exact: false`. The button
 * surfaces a small "Preview voice ≠ live voice" note so educators don't
 * mistake the fallback for the actual configured voice.
 */

"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface VoiceSampleButtonProps {
  /** VoiceProvider row id — used to scope the sample request to the
   *  correct provider credentials. */
  voiceProviderId: string;
  /** Currently-selected TTS engine ("deepgram" | "openai" | …). When
   *  empty / null, the button is disabled with "Select a voice first". */
  voiceProvider: string | null | undefined;
  /** Currently-selected voiceId per the engine. Same disabled-state
   *  rule as voiceProvider. */
  voiceId: string | null | undefined;
  /** Sample text. Defaults to a tutor-shaped one-liner; pages can
   *  override with course-context-aware copy. Hard-capped server-side
   *  at 200 chars regardless of what's passed. */
  sampleText?: string;
}

const DEFAULT_SAMPLE_TEXT =
  "Hi — I'm your tutor. Let's get into today's session.";

export function VoiceSampleButton({
  voiceProviderId,
  voiceProvider,
  voiceId,
  sampleText = DEFAULT_SAMPLE_TEXT,
}: VoiceSampleButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const disabled = !voiceProvider || !voiceId || state === "loading";
  const disabledReason = !voiceProvider
    ? "Select a voice engine first"
    : !voiceId
      ? "Select a voice first"
      : null;

  // Defensive cleanup — revoke any outstanding blob URL when the
  // component unmounts so we don't leak memory across re-renders.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setState("idle");
  }, []);

  const handleClick = useCallback(async () => {
    if (state === "playing") {
      stopPlayback();
      return;
    }
    if (disabled) return;
    setState("loading");
    setErrorMessage(null);
    setPreviewNote(null);
    try {
      const res = await fetch(
        `/api/voice-providers/${encodeURIComponent(voiceProviderId)}/sample`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: sampleText.slice(0, 200),
            voiceProvider,
            voiceId,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          typeof body?.error === "string"
            ? body.error
            : res.status === 429
              ? "Too many previews — wait a moment, then try again."
              : `Sample failed (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const isExact = res.headers.get("X-HF-Sample-Exact") === "true";
      const engine = res.headers.get("X-HF-Sample-Engine") ?? "openai";
      if (!isExact) {
        setPreviewNote(
          `Preview uses ${engine === "openai" ? "OpenAI" : engine} TTS — your live calls use ${voiceProvider}. Add a Deepgram API key on this provider to hear the exact live voice.`,
        );
      }
      const blob = await res.blob();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setState("idle");
        if (blobUrlRef.current === url) {
          URL.revokeObjectURL(url);
          blobUrlRef.current = null;
        }
      };
      audio.onerror = () => {
        setErrorMessage("Playback failed — see browser console");
        setState("error");
      };
      await audio.play();
      setState("playing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setState("error");
      stopPlayback();
    }
  }, [
    disabled,
    sampleText,
    state,
    stopPlayback,
    voiceId,
    voiceProvider,
    voiceProviderId,
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className="hf-btn hf-btn-secondary"
        disabled={disabled}
        title={disabledReason ?? "Play a short sample of this voice"}
        onClick={handleClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minWidth: 132,
          justifyContent: "center",
        }}
      >
        {state === "loading" && (
          <span
            className="hf-spinner"
            style={{ width: 14, height: 14, borderWidth: 2 }}
            aria-hidden="true"
          />
        )}
        {state === "loading" && <span>Generating…</span>}
        {state === "playing" && <span>■ Stop</span>}
        {(state === "idle" || state === "error") && <span>▶ Test voice</span>}
      </button>
      {previewNote && state !== "error" && (
        <div className="hf-text-muted hf-text-xs" style={{ maxWidth: 320 }}>
          {previewNote}
        </div>
      )}
      {state === "error" && errorMessage && (
        <div
          style={{
            fontSize: 12,
            color: "var(--status-error-text)",
            maxWidth: 320,
          }}
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}

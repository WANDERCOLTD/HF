"use client";

/**
 * ExamModeShell — Mock exam stripped UI (#1745, epic #1700 Theme 4).
 *
 * Renders a full-screen dark layout with the `DualWaveform` pair instead
 * of the chat feed. Activated when the bound `AuthoredModule.mode` is
 * `"examiner"` AND the session is terminal (the discriminator from the
 * story body).
 *
 * Aesthetic — strict dark theme; no labels (handled by waveform), no
 * timers, no chat shell. Wraps a stop-prop region so the host page's
 * chat-feed mount can stay rendered but layered beneath an opaque
 * overlay; the host decides whether to actually hide it or keep it
 * present (we just paint over).
 *
 * The amplitude values come from the host hook — typically the existing
 * `useVoiceMode` for the learner mic plus a sibling
 * `useRemoteAudioLevel` for the examiner TTS audio element. Safari does
 * not expose `getByteTimeDomainData()` on remote MediaStream tracks
 * reliably; the sibling hook here falls back to a text-length proxy when
 * an `AudioContext.createMediaElementSource` instantiation throws.
 */

import { useEffect, useRef, useState } from "react";

import { DualWaveform } from "./DualWaveform";
import "./exam-mode-shell.css";

import type { AuthoredModule } from "@/lib/types/json-fields";

interface ExamModeShellProps {
  /** Examiner-side amplitude (0..1) — typically driven by a sibling hook
   *  reading the TTS audio element's AnalyserNode. Use 0 when idle. */
  examinerLevel: number;
  /** Learner-side amplitude (0..1) — from `useVoiceMode().waveformLevel`. */
  learnerLevel: number;
  /** Active speaker for the screen-reader chip. */
  speakerRole?: "learner" | "examiner" | "idle";
  /** Optional banner text — e.g. "Part 2 — You'll speak for 2 minutes". */
  banner?: string;
  /** Child controls (e.g. an end-call button) rendered beneath the
   *  waveform. */
  children?: React.ReactNode;
}

/**
 * Pure discriminator: should the Mock exam shell mount for this module?
 *
 * Returns true when:
 *  - the bound AuthoredModule.mode === "examiner", AND
 *  - the module is terminal (typically Mock Exam, where bands are
 *    spoken aloud and the session ends with the final part).
 *
 * Pure function so tests can pin it without React.
 */
export function shouldMountExamModeShell(
  module: Pick<AuthoredModule, "mode"> | null | undefined,
  sessionTerminal: boolean,
): boolean {
  if (!module) return false;
  return module.mode === "examiner" && sessionTerminal === true;
}

export function ExamModeShell({
  examinerLevel,
  learnerLevel,
  speakerRole = "idle",
  banner,
  children,
}: ExamModeShellProps) {
  return (
    <section className="hf-exam-shell" role="region" aria-label="Mock exam">
      <div className="hf-exam-shell-bg" aria-hidden />
      <div className="hf-exam-shell-content">
        {banner ? (
          <div className="hf-exam-shell-banner" data-testid="hf-exam-shell-banner">
            {banner}
          </div>
        ) : null}
        <DualWaveform
          examinerLevel={examinerLevel}
          learnerLevel={learnerLevel}
          speakerRole={speakerRole}
        />
        {children ? <div className="hf-exam-shell-controls">{children}</div> : null}
      </div>
    </section>
  );
}

/**
 * useRemoteAudioLevel — read RMS amplitude from a remote audio element
 * (typically the TTS playback `<audio>` for the examiner side).
 *
 * Returns `{ level, fallbackMode }`:
 *  - `level` — 0..1, updated each animation frame while the audio is
 *    playing. Goes to 0 when paused / ended.
 *  - `fallbackMode` — true when the browser refused to instantiate an
 *    AnalyserNode for the element. In that case `level` is derived from
 *    a `proxy` value passed via `setProxyLevel()` (typically the host
 *    feeds it `responseText.length` normalised against a target).
 *
 * Mounts an AnalyserNode lazily on the first `audio.play` event so that
 * iOS Safari's "needs a user-gesture before AudioContext" rule is
 * respected.
 */
export function useRemoteAudioLevel(audio: HTMLAudioElement | null): {
  level: number;
  fallbackMode: boolean;
  setProxyLevel: (proxy: number) => void;
} {
  const [level, setLevel] = useState(0);
  const [fallbackMode, setFallbackMode] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const proxyRef = useRef<number>(0);

  function setProxyLevel(proxy: number) {
    proxyRef.current = Math.max(0, Math.min(1, proxy));
    if (fallbackMode) setLevel(proxyRef.current);
  }

  useEffect(() => {
    if (!audio) return;

    function startLoop() {
      const analyser = analyserRef.current;
      if (!analyser) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      function tick(localAnalyser: AnalyserNode) {
        localAnalyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4));
        rafRef.current = requestAnimationFrame(() => tick(localAnalyser));
      }
      rafRef.current = requestAnimationFrame(() => tick(analyser));
    }

    function stopLoop() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setLevel(0);
    }

    function onPlay() {
      try {
        if (!ctxRef.current) {
          // typecast — AudioContext exists on window in all evergreen browsers.
          ctxRef.current = new (window.AudioContext ||
            (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
        }
        const ctx = ctxRef.current;
        if (!analyserRef.current) {
          const source = ctx.createMediaElementSource(audio!);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyser.connect(ctx.destination);
          analyserRef.current = analyser;
        }
        if (ctx.state === "suspended") void ctx.resume();
        startLoop();
      } catch (err) {
        // Safari refuses createMediaElementSource on cross-origin elements
        // and on some audio MIME types — switch to proxy mode.
        setFallbackMode(true);
        setLevel(proxyRef.current);
        // eslint-disable-next-line no-console
        console.warn("[useRemoteAudioLevel] AnalyserNode unavailable — proxy mode", err);
      }
    }

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", stopLoop);
    audio.addEventListener("ended", stopLoop);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", stopLoop);
      audio.removeEventListener("ended", stopLoop);
      stopLoop();
    };
  }, [audio]);

  return { level, fallbackMode, setProxyLevel };
}

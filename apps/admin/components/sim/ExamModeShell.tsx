"use client";

/**
 * ExamModeShell — capability-driven Mock exam stripped UI
 * (#1745, epic #1700 Theme 4 → refactored S3 of epic #2163, #2198).
 *
 * Renders a full-screen layout with the `DualWaveform` pair instead of
 * the chat feed. Activated when the bound `AuthoredModule.mode` is
 * `"examiner"` OR `"mock-exam"` (closes #2161) AND the session is
 * terminal. Per epic #2163 — capabilities drive every affordance
 * (colour theme, mode pill, dismiss behaviour, timer presence).
 * Shell components consume the capability map at render time instead
 * of branching on the shell kind directly:
 *
 *   GOOD (declarative):  {capabilities.showTimer === "visible" ? <Timer /> : null}
 *   BAD  (procedural):   {shellKind === "exam" ? null : <Timer />}
 *
 * **IELTS Mock byte-identical regression** — the existing
 * `shouldMountExamModeShell(module, sessionTerminal)` callers + the
 * existing `<ExamModeShell examinerLevel={…} learnerLevel={…} …/>`
 * call sites still work: `capabilities` defaults to `SHELL_DEFAULTS.exam`
 * when not supplied. The byte-identical assertion lives in
 * `tests/components/sim/learner-shells.test.tsx`.
 *
 * Aesthetic — colour theme + mode pill copy are read from
 * `capabilities.colourTheme` + `capabilities.modePillKey`. Default
 * `exam` capabilities resolve to dark theme + mock-exam pill, matching
 * pre-refactor behaviour byte-for-byte.
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
import { SHELL_DEFAULTS, type LearnerShellCapabilities } from "@/lib/types/json-fields";
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
  /** Capability frame driving affordances. Defaults to
   *  `SHELL_DEFAULTS.exam` so existing call sites stay byte-identical
   *  pre/post-refactor. */
  capabilities?: LearnerShellCapabilities;
  /** Child controls (e.g. an end-call button) rendered beneath the
   *  waveform. */
  children?: React.ReactNode;
}

/**
 * Pure discriminator: should the Mock exam shell mount for this module?
 *
 * Returns true when:
 *  - the bound AuthoredModule.mode is `"examiner"` OR `"mock-exam"`
 *    (PR #2198 closes #2161 — the mock-exam mode missed the gate
 *     pre-refactor), AND
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
  if (sessionTerminal !== true) return false;
  return module.mode === "examiner" || module.mode === "mock-exam";
}

/**
 * Resolve the `data-colour-theme` attribute used by the CSS to swap
 * background + text variables. The CSS-variable approach keeps every
 * theme switch declarative — no inline `style={{}}` for static
 * properties (per `.claude/rules/ui-design-system.md`).
 */
function colourThemeAttr(theme: LearnerShellCapabilities["colourTheme"]): string {
  return theme;
}

export function ExamModeShell({
  examinerLevel,
  learnerLevel,
  speakerRole = "idle",
  banner,
  capabilities = SHELL_DEFAULTS.exam,
  children,
}: ExamModeShellProps) {
  return (
    <section
      className="hf-exam-shell"
      role="region"
      aria-label="Mock exam"
      data-colour-theme={colourThemeAttr(capabilities.colourTheme)}
      data-mode-pill={capabilities.modePillKey ?? ""}
      data-dismiss-on-end={capabilities.dismissOnEnd}
    >
      <div className="hf-exam-shell-bg" aria-hidden />
      <div className="hf-exam-shell-content">
        {capabilities.modePillKey ? (
          <div
            className="hf-shell-mode-pill"
            data-testid="hf-shell-mode-pill"
            data-mode-pill-key={capabilities.modePillKey}
          >
            {capabilities.modePillKey}
          </div>
        ) : null}
        {banner ? (
          <div className="hf-exam-shell-banner" data-testid="hf-exam-shell-banner">
            {banner}
          </div>
        ) : null}
        {capabilities.showTimer === "visible" ? (
          <div className="hf-shell-timer" data-testid="hf-shell-timer" />
        ) : null}
        {capabilities.chatFeedVisibility === "none" ? (
          <DualWaveform
            examinerLevel={examinerLevel}
            learnerLevel={learnerLevel}
            speakerRole={speakerRole}
          />
        ) : null}
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

"use client";

/**
 * DualWaveform — pure presentational, two horizontal level bars side-by-side
 * for the Mock exam shell (#1745, epic #1700 Theme 4).
 *
 * The Mock exam mode strips the chat UI down to two waveforms — one for the
 * examiner (TTS playback amplitude) and one for the learner (mic AnalyserNode
 * RMS). This component is intentionally render-only: amplitude values are
 * computed upstream (by `useVoiceMode` for the learner mic and by the
 * sibling helper for the examiner audio element). It works whether or not a
 * real stream is connected — when both levels are 0 it renders an idle bar.
 *
 * Aesthetic — colour-coded only, no labels embedded. Wrap with `aria-label`
 * for accessibility.
 */

import { useMemo } from "react";

import "./dual-waveform.css";

interface DualWaveformProps {
  /** Learner amplitude — 0..1 (RMS). */
  learnerLevel: number;
  /** Examiner amplitude — 0..1 (RMS or Safari fallback proxy). */
  examinerLevel: number;
  /** Active role for screen readers: which side is "speaking". */
  speakerRole?: "learner" | "examiner" | "idle";
}

const BAR_COUNT = 32;

export function DualWaveform({
  learnerLevel,
  examinerLevel,
  speakerRole = "idle",
}: DualWaveformProps) {
  // Generate per-bar heights driven by the input level. We seed a stable
  // pseudo-random pattern off the bar index so the visual is consistent
  // frame-to-frame for a given level (no jitter).
  const learnerBars = useMemo(() => buildBars(learnerLevel), [learnerLevel]);
  const examinerBars = useMemo(() => buildBars(examinerLevel), [examinerLevel]);

  return (
    <div className="hf-dwf" role="group" aria-label="Dual waveform — examiner and learner">
      <div className="hf-dwf-row hf-dwf-examiner" aria-label="Examiner audio level">
        <span className="hf-dwf-label">Examiner</span>
        <div className="hf-dwf-bars" aria-hidden>
          {examinerBars.map((h, i) => (
            <span
              key={i}
              className="hf-dwf-bar hf-dwf-bar-examiner"
              data-active={speakerRole === "examiner"}
              data-height={Math.round(h * 100)}
            />
          ))}
        </div>
      </div>
      <div className="hf-dwf-divider" aria-hidden />
      <div className="hf-dwf-row hf-dwf-learner" aria-label="Learner audio level">
        <span className="hf-dwf-label">You</span>
        <div className="hf-dwf-bars" aria-hidden>
          {learnerBars.map((h, i) => (
            <span
              key={i}
              className="hf-dwf-bar hf-dwf-bar-learner"
              data-active={speakerRole === "learner"}
              data-height={Math.round(h * 100)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Produce a per-bar height array (0..1) from a single level. Each bar
 * combines the level with a per-index sinusoidal envelope so the resulting
 * pattern looks more organic than a flat row at the same height. The pattern
 * is stable per index — no animation jitter.
 */
function buildBars(level: number): number[] {
  const safeLevel = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const minHeight = 0.08;
  const result: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const envelope = 0.6 + 0.4 * Math.sin((i / BAR_COUNT) * Math.PI);
    const h = Math.max(minHeight, safeLevel * envelope);
    result.push(h);
  }
  return result;
}

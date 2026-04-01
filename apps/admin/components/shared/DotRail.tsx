"use client";

/**
 * DotRail — a compact, clickable progress indicator.
 *
 * Each dot represents a session/step. Dot states:
 *   ● filled   = completed (all students past this point, or single caller completed)
 *   ◉ ring     = active (at least one student here, or single caller's current session)
 *   ○ hollow   = upcoming (no one has reached this yet)
 *
 * Clicking a dot scrolls the parent to that session (via onSelect callback).
 */

import { getSessionTypeColor, isFormStop } from "@/lib/lesson-plan/session-ui";

export type DotState = "completed" | "active" | "upcoming";

export interface DotRailStep {
  session: number;
  type: string;
  label: string;
}

export interface DotRailProps {
  steps: DotRailStep[];
  getState: (session: number) => DotState;
  onSelect?: (session: number) => void;
  /** Currently visible session (highlights the caret) */
  visibleSession?: number;
}

export function DotRail({ steps, getState, onSelect, visibleSession }: DotRailProps) {
  if (steps.length === 0) return null;

  return (
    <div className="jrl-dot-rail" role="navigation" aria-label="Session progress">
      <div className="jrl-dot-track">
        {steps.map((step, i) => {
          const state = getState(step.session);
          const color = getSessionTypeColor(step.type);
          const isVisible = visibleSession === step.session;
          const formDot = isFormStop(step.type);

          return (
            <button
              key={step.session}
              className={`jrl-dot jrl-dot--${state}${isVisible ? " jrl-dot--visible" : ""}${formDot ? " jrl-dot--form" : ""}`}
              style={{ "--dot-color": color } as React.CSSProperties}
              onClick={() => onSelect?.(step.session)}
              title={`${step.session}. ${step.label}`}
              aria-label={`Session ${step.session}: ${step.label} (${state})`}
              type="button"
            >
              {state === "active" && <span className="jrl-dot-ring" />}
            </button>
          );
        })}
      </div>
      {/* Session numbers under dots — show first, last, and every 5th */}
      <div className="jrl-dot-labels">
        {steps.map((step, i) => {
          const show = i === 0 || i === steps.length - 1 || (step.session % 5 === 0);
          return (
            <span key={step.session} className="jrl-dot-label">
              {show ? step.session : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

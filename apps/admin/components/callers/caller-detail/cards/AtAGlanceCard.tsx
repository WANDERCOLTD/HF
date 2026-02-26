"use client";

import type { CallerInsights } from "../hooks/useCallerInsights";

type AtAGlanceCardProps = {
  insights: CallerInsights;
  /** Terminology overrides */
  sessionLabel?: string;
};

export function AtAGlanceCard({ insights, sessionLabel = "Lessons" }: AtAGlanceCardProps) {
  const { courses, momentum, callStreak, lastCallDaysAgo, totalCalls } = insights;

  const momentumLabel = {
    accelerating: "↑ Accelerating",
    steady: "→ Steady",
    slowing: "↓ Slowing",
    new: "🆕 New",
  }[momentum];

  const momentumClass = {
    accelerating: "hf-glance-positive",
    steady: "hf-glance-neutral",
    slowing: "hf-glance-warning",
    new: "hf-glance-new",
  }[momentum];

  const recencyLabel = lastCallDaysAgo === null
    ? "No calls"
    : lastCallDaysAgo === 0
      ? "Today"
      : lastCallDaysAgo === 1
        ? "Yesterday"
        : `${lastCallDaysAgo}d ago`;

  return (
    <div className="hf-glance-strip">
      <div className="hf-glance-item">
        <span className="hf-glance-value">{Math.round(courses.overallMastery * 100)}%</span>
        <span className="hf-glance-label">Mastery</span>
      </div>
      <div className={`hf-glance-item ${momentumClass}`}>
        <span className="hf-glance-value">{momentumLabel}</span>
        <span className="hf-glance-label">Momentum</span>
      </div>
      <div className="hf-glance-item">
        <span className="hf-glance-value">{recencyLabel}</span>
        <span className="hf-glance-label">Last {sessionLabel.slice(0, -1)}</span>
      </div>
      <div className="hf-glance-item">
        <span className="hf-glance-value">{totalCalls}</span>
        <span className="hf-glance-label">{sessionLabel}</span>
      </div>
      {callStreak >= 3 && (
        <div className="hf-glance-item hf-glance-positive">
          <span className="hf-glance-value">🔥 {callStreak}</span>
          <span className="hf-glance-label">Streak</span>
        </div>
      )}
    </div>
  );
}

"use client";

import type { Call } from "../types";

type RecentCallsCardProps = {
  calls: Call[];
  onCallClick?: (callId: string) => void;
  onViewAll?: () => void;
  /** Terminology: "Lessons" | "Sessions" | "Conversations" */
  sessionLabel?: string;
};

export function RecentCallsCard({ calls, onCallClick, onViewAll, sessionLabel = "Lessons" }: RecentCallsCardProps) {
  if (!calls || calls.length === 0) return null;

  // Sort by date descending, take last 5
  const recent = [...calls]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="hf-card hf-recent-calls-card">
      <h3 className="hf-section-title">Recent {sessionLabel}</h3>

      <div className="hf-rc-list">
        {recent.map((call) => {
          const date = new Date(call.createdAt);
          const today = new Date();
          const isToday = date.toDateString() === today.toDateString();
          const dateLabel = isToday
            ? "Today"
            : date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });

          // Module context
          const moduleLabel = call.curriculumModule?.title || null;

          // Duration estimate from transcript length
          const wordCount = (call.transcript || "").split(/\s+/).length;
          const durationMin = Math.max(1, Math.round(wordCount / 150)); // ~150 words/min spoken

          // Simple sentiment from analysis flags
          const sentiment = call.hasScores ? "analyzed" : call.hasPrompt ? "prompted" : "pending";

          return (
            <button
              key={call.id}
              className="hf-rc-row"
              onClick={() => onCallClick?.(call.id)}
            >
              <span className="hf-rc-date">{dateLabel}</span>
              <span className="hf-rc-module">{moduleLabel || "General"}</span>
              <span className="hf-rc-duration">{durationMin}m</span>
              <span className={`hf-rc-sentiment hf-rc-${sentiment}`}>
                {sentiment === "analyzed" && "✓"}
                {sentiment === "prompted" && "📋"}
                {sentiment === "pending" && "○"}
              </span>
              <span className="hf-rc-chevron">▶</span>
            </button>
          );
        })}
      </div>

      {calls.length > 5 && (
        <button className="hf-rc-view-all" onClick={onViewAll}>
          All {sessionLabel.toLowerCase()} →
        </button>
      )}
    </div>
  );
}

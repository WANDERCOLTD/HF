"use client";

import { friendlyEndedReason } from "@/lib/voice/ended-reason-labels";

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

          // #1178 — surface VAPI endedReason for non-normal terminations.
          // Only show when the row was actually closed AND the reason
          // isn't a clean customer-ended-call (no noise on happy path).
          const friendly = friendlyEndedReason(call.voiceEndedReason);
          const isFailure =
            call.voiceEndedReason != null &&
            call.voiceEndedReason !== "customer-ended-call" &&
            call.voiceEndedReason !== "assistant-ended-call";

          return (
            <button
              key={call.id}
              className="hf-rc-row"
              onClick={() => onCallClick?.(call.id)}
            >
              <span className="hf-rc-date">{dateLabel}</span>
              {call.callSequence != null && (
                <span className="hf-rc-session">S{call.callSequence}</span>
              )}
              <span className="hf-rc-module">{moduleLabel || "General"}</span>
              <span className="hf-rc-duration">{durationMin}m</span>
              <span className={`hf-rc-sentiment hf-rc-${sentiment}`}>
                {sentiment === "analyzed" && "✓"}
                {sentiment === "prompted" && "📋"}
                {sentiment === "pending" && "○"}
              </span>
              {isFailure && friendly ? (
                <span
                  className="hf-rc-failed-badge"
                  title={friendly}
                  aria-label={friendly}
                >
                  ⚠
                </span>
              ) : null}
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

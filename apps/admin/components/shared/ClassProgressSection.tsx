"use client";

import { Users2 } from "lucide-react";

export interface StudentMasteryProgress {
  callerId: string;
  name: string | null;
  mastered: number;
  inProgress: number;
  notStarted: number;
  totalTps: number;
}

export interface ClassProgressSectionProps {
  studentProgress: StudentMasteryProgress[];
}

export function ClassProgressSection({ studentProgress }: ClassProgressSectionProps) {
  if (studentProgress.length === 0) {
    return (
      <div className="hf-mt-xl">
        <div className="hf-flex hf-items-center hf-gap-sm hf-mb-sm">
          <Users2 size={16} className="hf-text-muted" />
          <span className="hf-section-title hf-mb-0">Class Progress</span>
        </div>
        <p className="hf-text-sm hf-text-muted">
          No students enrolled yet.
        </p>
      </div>
    );
  }

  const total = studentProgress.length;

  // Aggregate: average mastery across all students
  const avgMastery = studentProgress.reduce((sum, s) => {
    const pct = s.totalTps > 0 ? Math.round((s.mastered / s.totalTps) * 100) : 0;
    return sum + pct;
  }, 0) / total;

  const notStartedCount = studentProgress.filter(s => s.totalTps === 0 || (s.mastered === 0 && s.inProgress === 0)).length;
  const completedCount = studentProgress.filter(s => s.totalTps > 0 && s.mastered === s.totalTps).length;
  const activeCount = total - notStartedCount - completedCount;

  return (
    <div className="hf-mt-xl">
      <div className="hf-flex hf-flex-between hf-items-center hf-mb-md">
        <div className="hf-flex hf-items-center hf-gap-sm">
          <Users2 size={16} className="hf-text-muted" />
          <span className="hf-section-title hf-mb-0">Class Progress</span>
        </div>
        <span className="hf-text-xs hf-text-muted">
          {total} enrolled · {Math.round(avgMastery)}% avg mastery
        </span>
      </div>
      <div className="hf-card-compact cd-progress-section">
        {studentProgress.map((s) => {
          const pct = s.totalTps > 0 ? Math.round((s.mastered / s.totalTps) * 100) : 0;
          const inProgressPct = s.totalTps > 0 ? Math.round((s.inProgress / s.totalTps) * 100) : 0;
          const isComplete = s.totalTps > 0 && s.mastered === s.totalTps;
          const hasProgress = s.mastered > 0 || s.inProgress > 0;

          return (
            <div key={s.callerId} className="cd-progress-row">
              <span className="cd-progress-name hf-text-xs" style={{ minWidth: 100 }}>
                {s.name || "Unknown"}
              </span>
              <div className="cd-progress-bar">
                {/* Mastered (solid) */}
                <div
                  className="cd-progress-fill"
                  style={{
                    width: `${pct}%`,
                    background: isComplete
                      ? "var(--status-success-text)"
                      : "var(--accent-primary)",
                  }}
                />
                {/* In-progress (lighter overlay) */}
                {inProgressPct > 0 && (
                  <div
                    className="cd-progress-fill cd-progress-fill--inprogress"
                    style={{
                      width: `${inProgressPct}%`,
                      left: `${pct}%`,
                      background: "color-mix(in srgb, var(--accent-primary) 30%, transparent)",
                      position: "absolute",
                    }}
                  />
                )}
              </div>
              <span className="cd-progress-count hf-text-xs" style={{ minWidth: 48, textAlign: "right" }}>
                {isComplete ? (
                  <span style={{ color: "var(--status-success-text)" }}>&#10003; 100%</span>
                ) : hasProgress ? (
                  <span>{pct}%</span>
                ) : (
                  <span className="hf-text-muted">—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Summary line */}
      <div className="hf-mt-sm hf-text-xs hf-text-muted">
        {completedCount > 0 && (
          <span style={{ color: "var(--status-success-text)" }}>
            {completedCount} complete
          </span>
        )}
        {completedCount > 0 && activeCount > 0 && " · "}
        {activeCount > 0 && (
          <span>{activeCount} in progress</span>
        )}
        {(completedCount > 0 || activeCount > 0) && notStartedCount > 0 && " · "}
        {notStartedCount > 0 && (
          <span>{notStartedCount} not started</span>
        )}
      </div>
    </div>
  );
}

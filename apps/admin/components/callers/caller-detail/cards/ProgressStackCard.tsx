"use client";

import type { CallerInsights } from "../hooks/useCallerInsights";
import type { Goal } from "../types";

type ProgressStackCardProps = {
  insights: CallerInsights;
  /** Term overrides from terminology system */
  terms?: {
    goal?: string;
    course?: string;
    learning?: string;
    target?: string;
  };
};

export function ProgressStackCard({ insights, terms }: ProgressStackCardProps) {
  const { goals, courses, learnings, targets } = insights;

  return (
    <div className="hf-card hf-progress-stack">
      {/* Layer 1: Goals */}
      {goals.items.length > 0 && (
        <div className="hf-ps-layer">
          <div className="hf-ps-layer-header">
            <span className="hf-ps-layer-icon">🎯</span>
            <span className="hf-ps-layer-title">{terms?.goal || "GOAL"}</span>
          </div>
          {goals.items.slice(0, 2).map((goal) => (
            <GoalRow key={goal.id} goal={goal} />
          ))}
        </div>
      )}

      {/* Layer 2: Courses */}
      {courses.modules.length > 0 && (
        <div className="hf-ps-layer">
          <div className="hf-ps-layer-header">
            <span className="hf-ps-layer-icon">📚</span>
            <span className="hf-ps-layer-title">{terms?.course || "COURSE"}</span>
            <span className="hf-ps-layer-summary">
              {courses.completedModules}/{courses.totalModules} modules · {Math.round(courses.overallMastery * 100)}%
            </span>
          </div>
          {courses.modules.map((mod) => (
            <div key={mod.id} className="hf-ps-module-row">
              <span className="hf-ps-module-name">{mod.name}</span>
              <div className="hf-ps-bar-wrap">
                <div
                  className={`hf-ps-bar hf-ps-bar-${mod.status}`}
                  style={{ width: `${Math.round(mod.mastery * 100)}%` }}
                />
              </div>
              <span className="hf-ps-module-pct">{Math.round(mod.mastery * 100)}%</span>
              <span className={`hf-ps-module-badge hf-ps-badge-${mod.status}`}>
                {mod.status === "mastered" && "✓ mastered"}
                {mod.status === "in_progress" && "→ in progress"}
                {mod.status === "needs_attention" && "⚠ needs attention"}
                {mod.status === "not_started" && "○ not started"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Layer 3: Learnings */}
      {learnings.totalLOs > 0 && (
        <div className="hf-ps-layer">
          <div className="hf-ps-layer-header">
            <span className="hf-ps-layer-icon">🧠</span>
            <span className="hf-ps-layer-title">{terms?.learning || "LEARNING"}</span>
            <span className="hf-ps-layer-summary">
              {learnings.masteredLOs} of {learnings.totalLOs} outcomes
            </span>
          </div>
          {learnings.recentlyMastered.length > 0 && (
            <div className="hf-ps-lo-list">
              {learnings.recentlyMastered.map((lo, i) => (
                <span key={i} className="hf-ps-lo-chip hf-ps-lo-mastered">✅ {lo}</span>
              ))}
            </div>
          )}
          {learnings.inProgress.length > 0 && (
            <div className="hf-ps-lo-list">
              {learnings.inProgress.map((lo, i) => (
                <span key={i} className="hf-ps-lo-chip hf-ps-lo-progress">🔄 {lo}</span>
              ))}
            </div>
          )}
          {learnings.recentlyMastered.length === 0 && learnings.inProgress.length === 0 && (
            <div className="hf-ps-lo-summary">
              Based on module progress — detailed outcomes available after TODO #16
            </div>
          )}
        </div>
      )}

      {/* Layer 4: Targets */}
      {targets.length > 0 && (
        <div className="hf-ps-layer">
          <div className="hf-ps-layer-header">
            <span className="hf-ps-layer-icon">📊</span>
            <span className="hf-ps-layer-title">{terms?.target || "TARGETS"}</span>
          </div>
          {targets.map((t, i) => (
            <div key={i} className="hf-ps-target-row">
              <span className="hf-ps-target-name">{t.name}</span>
              <div className="hf-ps-target-dots">
                {Array.from({ length: 10 }, (_, j) => (
                  <span
                    key={j}
                    className={`hf-ps-dot ${j < Math.round(t.current * 10) ? "hf-ps-dot-filled" : ""}`}
                  />
                ))}
              </div>
              <span className="hf-ps-target-value">{(t.current).toFixed(2)}</span>
              {t.met ? (
                <span className="hf-ps-target-status hf-ps-met">✓ met</span>
              ) : (
                <span className="hf-ps-target-status hf-ps-trending">
                  → {(t.target).toFixed(2)}
                  {t.trend === "up" && " ↑"}
                  {t.trend === "down" && " ↓"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {courses.modules.length === 0 && goals.items.length === 0 && targets.length === 0 && (
        <div className="hf-ps-empty">
          <p>No progress data yet. Progress will appear after the first lesson.</p>
        </div>
      )}
    </div>
  );
}

function GoalRow({ goal }: { goal: Goal }) {
  const pct = Math.round((goal.progress || 0) * 100);
  return (
    <div className="hf-ps-goal-row">
      <span className="hf-ps-goal-name">{goal.name}</span>
      <div className="hf-ps-bar-wrap">
        <div className="hf-ps-bar hf-ps-bar-goal" style={{ width: `${pct}%` }} />
      </div>
      <span className="hf-ps-goal-pct">{pct}%</span>
      {goal.targetDate && (
        <span className="hf-ps-goal-date">
          Target: {new Date(goal.targetDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
        </span>
      )}
    </div>
  );
}

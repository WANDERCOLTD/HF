"use client";

import { useState, useEffect } from "react";
import { Sparkline } from "@/components/shared/Sparkline";
import { LearningTrajectoryCard } from "./cards/LearningTrajectoryCard";
import type { CallerInsights } from "./hooks/useCallerInsights";
import type { UpliftData } from "./types";
import "./uplift-tab.css";

type Props = {
  callerId: string;
  insights: CallerInsights | null;
};

// ── Trend direction from score history ─────────────────

function trendDirection(scores: { score: number }[]): "up" | "down" | "stable" {
  if (scores.length < 3) return "stable";
  const half = Math.floor(scores.length / 2);
  const firstHalf = scores.slice(0, half);
  const secondHalf = scores.slice(half);
  const avgFirst = firstHalf.reduce((s, v) => s + v.score, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v.score, 0) / secondHalf.length;
  const delta = avgSecond - avgFirst;
  if (delta > 0.05) return "up";
  if (delta < -0.05) return "down";
  return "stable";
}

function trendLabel(dir: "up" | "down" | "stable"): string {
  switch (dir) {
    case "up": return "improving";
    case "down": return "declining";
    case "stable": return "stable";
  }
}

function trendArrow(dir: "up" | "down" | "stable"): string {
  switch (dir) {
    case "up": return "▲";
    case "down": return "▼";
    case "stable": return "→";
  }
}

// ── Status label ───────────────────────────────────────

function moduleStatusLabel(status: string): string {
  switch (status) {
    case "COMPLETED": return "Complete";
    case "IN_PROGRESS": return "In Progress";
    default: return "Not Started";
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "COMPLETED": return "uplift-module-status--completed";
    case "IN_PROGRESS": return "uplift-module-status--in_progress";
    default: return "uplift-module-status--not_started";
  }
}

// ── Delta Badge ────────────────────────────────────────

function DeltaBadge({ value, suffix = "" }: { value: number | null; suffix?: string }): React.ReactElement | null {
  if (value == null) return <span className="uplift-delta-awaiting">awaiting</span>;
  const cls = value > 0 ? "uplift-delta-badge--positive"
    : value < 0 ? "uplift-delta-badge--negative"
    : "uplift-delta-badge--neutral";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`uplift-delta-badge ${cls}`}>
      {sign}{value}{suffix}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────

export function UpliftTab({ callerId, insights }: Props): React.ReactElement {
  const [data, setData] = useState<UpliftData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchUplift(): Promise<void> {
      try {
        const res = await fetch(`/api/callers/${callerId}/uplift`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          setData(json.uplift);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchUplift();
    return () => { cancelled = true; };
  }, [callerId]);

  if (loading) {
    return (
      <div className="hf-empty">
        <div className="hf-spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">📈</div>
        <div className="hf-empty-state-title">No uplift data yet</div>
        <div className="hf-empty-state-desc">
          Data will appear as this learner completes calls and surveys.
        </div>
      </div>
    );
  }

  const hasSurveyData = data.confidencePre != null || data.testScorePre != null;

  return (
    <div className="uplift-root">
      {/* ── Headline Strip ──────────────────────────── */}
      <div className="uplift-headline-strip">
        <div className="hf-card-compact uplift-delta-card">
          <div className="uplift-delta-label">Confidence</div>
          {data.confidencePre != null ? (
            <>
              <div className="uplift-delta-value">
                {data.confidencePre.toFixed(1)} → {(data.confidencePost ?? data.confidencePre).toFixed(1)}
              </div>
              <DeltaBadge value={data.confidenceDelta} />
            </>
          ) : (
            <div className="uplift-delta-awaiting">no survey yet</div>
          )}
        </div>

        <div className="hf-card-compact uplift-delta-card">
          <div className="uplift-delta-label">Knowledge</div>
          {data.testScorePre != null ? (
            <>
              <div className="uplift-delta-value">
                {Math.round(data.testScorePre * 100)}% → {Math.round((data.testScorePost ?? data.testScorePre) * 100)}%
              </div>
              <DeltaBadge value={data.knowledgeDelta != null ? Math.round(data.knowledgeDelta * 100) : null} suffix="pp" />
            </>
          ) : (
            <div className="uplift-delta-awaiting">no test yet</div>
          )}
        </div>

        <div className="hf-card-compact uplift-delta-card">
          <div className="uplift-delta-label">Mastery</div>
          <div className="uplift-delta-value">{Math.round(data.overallMastery * 100)}%</div>
          <div className="uplift-delta-sub">
            {data.moduleProgress.filter((m) => m.status === "COMPLETED").length}/{data.moduleProgress.length} modules
          </div>
        </div>

        <div className="hf-card-compact uplift-delta-card">
          <div className="uplift-delta-label">Calls</div>
          <div className="uplift-delta-value">{data.totalCalls}</div>
          <div className="uplift-delta-sub">{data.callFrequencyPerWeek}/week</div>
        </div>

        <div className="hf-card-compact uplift-delta-card">
          <div className="uplift-delta-label">Days Active</div>
          <div className="uplift-delta-value">{data.timeOnPlatformDays}</div>
          {insights && (
            <div className="uplift-delta-sub">
              {insights.momentum === "accelerating" ? "🔥 " : ""}
              {insights.momentum}
            </div>
          )}
        </div>
      </div>

      {/* ── Module Mastery ──────────────────────────── */}
      {data.moduleProgress.length > 0 && (
        <div className="hf-card uplift-section">
          <div className="uplift-section-title">Module Mastery</div>
          {data.moduleProgress.map((mod) => (
            <div key={mod.moduleId} className="uplift-module-row">
              <div className="uplift-module-name" title={mod.title}>{mod.title}</div>
              <div className="uplift-module-bar-track">
                <div
                  className={`uplift-module-bar-fill${mod.status === "COMPLETED" ? " uplift-module-bar-fill--complete" : ""}`}
                  style={{ width: `${Math.round(mod.mastery * 100)}%` }}
                />
              </div>
              <div className="uplift-module-pct">{Math.round(mod.mastery * 100)}%</div>
              <div className={`uplift-module-status ${statusClass(mod.status)}`}>
                {moduleStatusLabel(mod.status)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Goals ───────────────────────────────────── */}
      {data.goals.length > 0 && (
        <div className="hf-card uplift-section">
          <div className="uplift-section-title">Goals</div>
          {data.goals.map((goal) => (
            <div key={goal.id} className="uplift-goal-row">
              <span className="uplift-goal-type">{goal.type}</span>
              <span className="uplift-goal-name">{goal.name}</span>
              <div className="uplift-goal-bar-track">
                <div
                  className="uplift-goal-bar-fill"
                  style={{ width: `${Math.round(goal.progress * 100)}%` }}
                />
              </div>
              <span className="uplift-goal-pct">{Math.round(goal.progress * 100)}%</span>
              <span className={`uplift-goal-status uplift-goal-status--${goal.status}`}>
                {goal.status === "COMPLETED" ? "✓ Done" : goal.status === "PAUSED" ? "Paused" : "Active"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Score Trends ────────────────────────────── */}
      {data.scoreTrends.length > 0 && (
        <div className="hf-card uplift-section">
          <div className="uplift-section-title">Score Trends</div>
          <div className="uplift-trend-grid">
            {data.scoreTrends.map((trend) => {
              const avg = trend.scores.reduce((s, v) => s + v.score, 0) / trend.scores.length;
              const dir = trendDirection(trend.scores);
              const history = trend.scores.map((s) => s.score);
              const labels = trend.scores.map((s) =>
                new Date(s.callDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
              );
              return (
                <div key={trend.parameterId} className="hf-card-compact uplift-trend-card">
                  <span className="uplift-trend-name">{trend.parameterName}</span>
                  <Sparkline
                    history={history}
                    color="var(--accent-primary)"
                    width={64}
                    height={24}
                    label={trend.parameterName}
                    historyLabels={labels}
                  />
                  <span className="uplift-trend-avg">{avg.toFixed(2)}</span>
                  <span className={`uplift-trend-direction uplift-trend-direction--${dir}`}>
                    {trendArrow(dir)} {trendLabel(dir)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Adaptation Evidence ─────────────────────── */}
      {data.adaptationEvidence.length > 0 && (
        <div className="hf-card uplift-section">
          <div className="uplift-section-title">Adaptation Evidence</div>
          <div className="uplift-delta-sub" style={{ marginBottom: 8 }}>
            How the system has personalized for this learner
          </div>
          {data.adaptationEvidence.map((adapt) => (
            <div key={adapt.parameterName} className="uplift-adapt-row">
              <div className="uplift-adapt-name">{adapt.parameterName}</div>
              <div className="uplift-adapt-shift">
                <span>{adapt.defaultValue.toFixed(2)}</span>
                <span className="uplift-adapt-arrow">→</span>
                <span className="uplift-adapt-current">{adapt.currentValue.toFixed(2)}</span>
                <span className={`uplift-adapt-delta ${adapt.delta > 0 ? "uplift-delta-badge--positive" : "uplift-delta-badge--negative"}`}>
                  {adapt.delta > 0 ? "+" : ""}{adapt.delta.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Learning Trajectory ─────────────────────── */}
      <div className="uplift-section">
        <LearningTrajectoryCard callerId={callerId} />
      </div>

      {/* ── Survey Comparison ───────────────────────── */}
      {hasSurveyData && (
        <div className="hf-card uplift-section">
          <div className="uplift-section-title">Survey Results</div>
          <div className="uplift-engagement-strip">
            {data.confidencePre != null && (
              <div className="uplift-engagement-item">
                <span className="uplift-engagement-label">Confidence:</span>
                <span className="uplift-engagement-value">
                  {data.confidencePre.toFixed(1)} → {(data.confidencePost ?? data.confidencePre).toFixed(1)}
                </span>
                <DeltaBadge value={data.confidenceDelta} />
              </div>
            )}
            {data.testScorePre != null && (
              <div className="uplift-engagement-item">
                <span className="uplift-engagement-label">Test Score:</span>
                <span className="uplift-engagement-value">
                  {Math.round(data.testScorePre * 100)}% → {Math.round((data.testScorePost ?? data.testScorePre) * 100)}%
                </span>
                <DeltaBadge value={data.knowledgeDelta != null ? Math.round(data.knowledgeDelta * 100) : null} suffix="pp" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Engagement ──────────────────────────────── */}
      <div className="hf-card uplift-section">
        <div className="uplift-section-title">Engagement</div>
        <div className="uplift-engagement-strip">
          {insights && (
            <div className="uplift-engagement-item">
              <span className="uplift-engagement-label">Momentum:</span>
              <span className="uplift-engagement-value">
                {insights.momentum === "accelerating" ? "🔥 " : ""}{insights.momentum}
              </span>
            </div>
          )}
          {insights && insights.callStreak > 0 && (
            <div className="uplift-engagement-item">
              <span className="uplift-engagement-label">Streak:</span>
              <span className="uplift-engagement-value">{insights.callStreak} days</span>
            </div>
          )}
          <div className="uplift-engagement-item">
            <span className="uplift-engagement-label">Frequency:</span>
            <span className="uplift-engagement-value">{data.callFrequencyPerWeek} calls/week</span>
          </div>
          <div className="uplift-engagement-item">
            <span className="uplift-engagement-label">Memories:</span>
            <span className="uplift-engagement-value">
              {data.memoryCounts.facts} facts, {data.memoryCounts.preferences} prefs, {data.memoryCounts.topics} topics
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

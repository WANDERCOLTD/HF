"use client";

import { useState, useEffect } from "react";
import { ChevronDown, BookOpen, Target, TrendingUp, Sliders, Compass, Activity } from "lucide-react";
import { Sparkline } from "@/components/shared/Sparkline";
import { LearningTrajectoryCard } from "./cards/LearningTrajectoryCard";
import { SkillTrendChartCard } from "./cards/SkillTrendChartCard";
import type { CallerInsights } from "./hooks/useCallerInsights";
import type { UpliftData } from "./types";
import "./uplift-tab.css";

type Props = {
  callerId: string;
  insights: CallerInsights | null;
  /** #UI5 — caller-wide CallScore rows for SkillTrendChartCard. */
  scores?: Array<{
    callId: string;
    parameterId: string;
    score: number;
    scoredAt?: string | Date;
    createdAt?: string | Date;
    parameter?: { parameterId?: string; name?: string | null } | null;
  }>;
  /** #UI5 — CallerTarget rows for target-band reference line. */
  callerTargets?: Array<{
    parameterId: string;
    targetValue: number | null;
    currentScore: number | null;
  }>;
};

// ── SVG Ring Chart ─────────────────────────────────────

function RingChart({ value, size = 100, strokeWidth = 8, color }: {
  value: number; size?: number; strokeWidth?: number; color: string;
}): React.ReactElement {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, value)));
  const center = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        className="uplift-ring-track"
        cx={center} cy={center} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
      />
      <circle
        className="uplift-ring-progress"
        cx={center} cy={center} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
        style={{
          "--ring-circumference": `${circumference}`,
          "--ring-offset": `${offset}`,
        } as React.CSSProperties}
      />
    </svg>
  );
}

function MiniRing({ value, size = 40, strokeWidth = 4, color }: {
  value: number; size?: number; strokeWidth?: number; color: string;
}): React.ReactElement {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, value)));
  const center = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={center} cy={center} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} opacity={0.12} />
      <circle cx={center} cy={center} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}

// ── Trend helpers ──────────────────────────────────────

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

const TREND_LABELS = { up: "▲ improving", down: "▼ declining", stable: "→ stable" };

// ── Collapsible Section ────────────────────────────────

function Section({ icon, iconClass, title, subtitle, badge, defaultOpen = false, children }: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="hf-card uplift-section">
      <div className="uplift-section-header" onClick={() => setOpen(!open)}>
        <div className={`uplift-section-icon ${iconClass}`}>{icon}</div>
        <div className="uplift-section-title-wrap">
          <div className="uplift-section-title">{title}</div>
          {subtitle && <div className="uplift-section-subtitle">{subtitle}</div>}
        </div>
        {badge && <span className="uplift-section-badge">{badge}</span>}
        <ChevronDown size={16} className={`uplift-section-chevron${open ? " uplift-section-chevron--open" : ""}`} />
      </div>
      <div className={`uplift-section-body${open ? " uplift-section-body--open" : ""}`}>
        <div className="uplift-section-body-inner">
          <div className="uplift-section-content">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ── Delta Badge ────────────────────────────────────────

function DeltaBadge({ value, suffix = "" }: { value: number | null; suffix?: string }): React.ReactElement | null {
  if (value == null) return null;
  const cls = value > 0 ? "uplift-ring-delta--positive"
    : value < 0 ? "uplift-ring-delta--negative"
    : "uplift-ring-delta--neutral";
  const sign = value > 0 ? "+" : "";
  return <span className={`uplift-ring-delta ${cls}`}>{sign}{value}{suffix}</span>;
}

// ── Main Component ─────────────────────────────────────

export function UpliftTab({ callerId, insights, scores, callerTargets }: Props): React.ReactElement {
  const [data, setData] = useState<UpliftData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchUplift(): Promise<void> {
      try {
        const res = await fetch(`/api/callers/${callerId}/uplift`);
        const json = await res.json();
        if (!cancelled && json.ok) setData(json.uplift);
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
      <div className="uplift-loading">
        <div className="uplift-loading-rings">
          <div className="uplift-loading-ring" />
          <div className="uplift-loading-ring" />
          <div className="uplift-loading-ring" />
        </div>
        <div className="uplift-loading-bar uplift-loading-bar--long" />
        <div className="uplift-loading-bar uplift-loading-bar--medium" />
        <div className="uplift-loading-bar uplift-loading-bar--short" />
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

  const completedModules = data.moduleProgress.filter((m) => m.status === "COMPLETED").length;
  const activeGoals = data.goals.filter((g) => g.status === "ACTIVE").length;
  const completedGoals = data.goals.filter((g) => g.status === "COMPLETED").length;

  return (
    <div className="uplift-root">
      {/* #UI5 — Per-skill trend chart (lives above the rings so the
          educator sees movement first). Self-hides when there are
          < 2 data points across all skill_* params. */}
      <SkillTrendChartCard
        scores={(scores ?? []) as never}
        callerTargets={(callerTargets ?? []) as never}
      />

      {/* ── Hero Rings ───────────────────────────────── */}
      <div className="hf-card uplift-hero">
        {/* Mastery */}
        <div className="uplift-ring-item">
          <div className="uplift-ring-wrap">
            <RingChart value={data.overallMastery} color="var(--accent-primary)" />
            <div className="uplift-ring-center">
              <span className="uplift-ring-value">{Math.round(data.overallMastery * 100)}%</span>
              <span className="uplift-ring-sub">{completedModules}/{data.moduleProgress.length}</span>
            </div>
          </div>
          <span className="uplift-ring-label">Mastery</span>
        </div>

        {/* Confidence */}
        <div className="uplift-ring-item">
          <div className="uplift-ring-wrap">
            {data.confidencePost != null ? (
              <>
                <RingChart value={(data.confidencePost ?? 0) / 5} color="var(--status-success-text)" />
                <div className="uplift-ring-center">
                  <span className="uplift-ring-value">{(data.confidencePost ?? 0).toFixed(1)}</span>
                  <span className="uplift-ring-sub">/5</span>
                </div>
              </>
            ) : data.confidencePre != null ? (
              <>
                <RingChart value={(data.confidencePre ?? 0) / 5} color="var(--text-muted)" />
                <div className="uplift-ring-center">
                  <span className="uplift-ring-value">{(data.confidencePre ?? 0).toFixed(1)}</span>
                  <span className="uplift-ring-sub">pre</span>
                </div>
              </>
            ) : (
              <>
                <RingChart value={0} color="var(--text-muted)" />
                <div className="uplift-ring-center">
                  <span className="uplift-ring-awaiting">—</span>
                </div>
              </>
            )}
          </div>
          <span className="uplift-ring-label">Confidence</span>
          <DeltaBadge value={data.confidenceDelta} />
        </div>

        {/* Knowledge */}
        <div className="uplift-ring-item">
          <div className="uplift-ring-wrap">
            {data.testScorePost != null ? (
              <>
                <RingChart value={data.testScorePost} color="var(--status-success-text)" />
                <div className="uplift-ring-center">
                  <span className="uplift-ring-value">{Math.round(data.testScorePost * 100)}%</span>
                  <span className="uplift-ring-sub">post</span>
                </div>
              </>
            ) : data.testScorePre != null ? (
              <>
                <RingChart value={data.testScorePre} color="var(--text-muted)" />
                <div className="uplift-ring-center">
                  <span className="uplift-ring-value">{Math.round(data.testScorePre * 100)}%</span>
                  <span className="uplift-ring-sub">pre</span>
                </div>
              </>
            ) : (
              <>
                <RingChart value={0} color="var(--text-muted)" />
                <div className="uplift-ring-center">
                  <span className="uplift-ring-awaiting">—</span>
                </div>
              </>
            )}
          </div>
          <span className="uplift-ring-label">Knowledge</span>
          <DeltaBadge value={data.knowledgeDelta != null ? Math.round(data.knowledgeDelta * 100) : null} suffix="pp" />
        </div>

        {/* Calls */}
        <div className="uplift-ring-item">
          <div className="uplift-ring-wrap">
            <RingChart value={Math.min(1, data.totalCalls / 20)} color="var(--accent-primary)" />
            <div className="uplift-ring-center">
              <span className="uplift-ring-value">{data.totalCalls}</span>
            </div>
          </div>
          <span className="uplift-ring-label">Calls</span>
        </div>

        {/* Days */}
        <div className="uplift-ring-item">
          <div className="uplift-ring-wrap">
            <RingChart value={Math.min(1, data.timeOnPlatformDays / 60)} color="var(--accent-primary)" />
            <div className="uplift-ring-center">
              <span className="uplift-ring-value">{data.timeOnPlatformDays}</span>
            </div>
          </div>
          <span className="uplift-ring-label">Days Active</span>
          {insights && (
            <span className="uplift-ring-delta uplift-ring-delta--neutral">
              {insights.momentum}
            </span>
          )}
        </div>
      </div>

      {/* ── Module Mastery ───────────────────────────── */}
      {data.moduleProgress.length > 0 && (
        <Section
          icon={<BookOpen size={16} />}
          iconClass="uplift-section-icon--modules"
          title="Module Mastery"
          subtitle={`${completedModules} of ${data.moduleProgress.length} modules complete`}
          badge={`${Math.round(data.overallMastery * 100)}%`}
          defaultOpen
        >
          <div className="uplift-modules">
            {data.moduleProgress.map((mod) => (
              <div key={mod.moduleId} className="uplift-mod-row">
                <div className="uplift-mod-name" title={mod.title}>{mod.title}</div>
                <div className="uplift-mod-bar-track">
                  <div
                    className={`uplift-mod-bar-fill${mod.status === "COMPLETED" ? " uplift-mod-bar-fill--complete" : ""}`}
                    style={{ width: `${Math.round(mod.mastery * 100)}%` }}
                  />
                </div>
                <div className="uplift-mod-pct">{Math.round(mod.mastery * 100)}%</div>
                <div className="uplift-mod-calls">{mod.callCount} calls</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Goals ────────────────────────────────────── */}
      {data.goals.length > 0 && (
        <Section
          icon={<Target size={16} />}
          iconClass="uplift-section-icon--goals"
          title="Goals"
          subtitle={`${activeGoals} active · ${completedGoals} completed`}
          defaultOpen
        >
          <div className="uplift-goals">
            {data.goals.map((goal) => {
              const color = goal.status === "COMPLETED" ? "var(--status-success-text)" : "var(--accent-primary)";
              return (
                <div key={goal.id} className="uplift-goal-card">
                  <div className="uplift-goal-ring-wrap">
                    <MiniRing value={goal.progress} color={color} />
                  </div>
                  <div className="uplift-goal-info">
                    <div className="uplift-goal-name" title={goal.name}>{goal.name}</div>
                    <div className="uplift-goal-meta">
                      <span className={`uplift-goal-type${goal.status === "COMPLETED" ? " uplift-goal-status--COMPLETED" : ""}`}>
                        {goal.status === "COMPLETED" ? "✓ Done" : goal.type}
                      </span>
                      <span className="uplift-goal-pct">{Math.round(goal.progress * 100)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Score Trends ─────────────────────────────── */}
      {data.scoreTrends.length > 0 && (
        <Section
          icon={<TrendingUp size={16} />}
          iconClass="uplift-section-icon--trends"
          title="Score Trends"
          subtitle={`${data.scoreTrends.length} parameters tracked across calls`}
          badge={`${data.scoreTrends.filter((t) => trendDirection(t.scores) === "up").length} improving`}
        >
          <div className="uplift-trends">
            {data.scoreTrends.map((trend) => {
              const avg = trend.scores.reduce((s, v) => s + v.score, 0) / trend.scores.length;
              const dir = trendDirection(trend.scores);
              const history = trend.scores.map((s) => s.score);
              const labels = trend.scores.map((s) =>
                new Date(s.callDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
              );
              return (
                <div key={trend.parameterId} className="uplift-trend-card">
                  <Sparkline
                    history={history}
                    color={dir === "up" ? "var(--status-success-text)" : dir === "down" ? "var(--status-error-text)" : "var(--accent-primary)"}
                    width={72}
                    height={28}
                    label={trend.parameterName}
                    historyLabels={labels}
                  />
                  <div className="uplift-trend-info">
                    <div className="uplift-trend-name">{trend.parameterName}</div>
                    <div className="uplift-trend-stats">
                      <span className="uplift-trend-avg">{avg.toFixed(2)}</span>
                      <span className={`uplift-trend-dir uplift-trend-dir--${dir}`}>
                        {TREND_LABELS[dir]}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Adaptation Evidence ──────────────────────── */}
      {data.adaptationEvidence.length > 0 && (
        <Section
          icon={<Sliders size={16} />}
          iconClass="uplift-section-icon--adapt"
          title="Adaptation"
          subtitle="How the system has personalised for this learner"
          badge={`${data.adaptationEvidence.length} params`}
        >
          <div className="uplift-adapt-list">
            {data.adaptationEvidence.map((adapt) => {
              const defaultPct = adapt.defaultValue * 100;
              const currentPct = adapt.currentValue * 100;
              return (
                <div key={adapt.parameterName} className="uplift-adapt-row">
                  <div className="uplift-adapt-name">{adapt.parameterName}</div>
                  <div className="uplift-adapt-viz">
                    <div className="uplift-adapt-bar-track">
                      <div className="uplift-adapt-bar-default" style={{ left: `${defaultPct}%` }} />
                      <div className="uplift-adapt-bar-current" style={{ left: `${currentPct}%` }} />
                    </div>
                  </div>
                  <div className="uplift-adapt-values">
                    <span>{adapt.defaultValue.toFixed(2)}</span>
                    <span>→</span>
                    <span className="uplift-adapt-current">{adapt.currentValue.toFixed(2)}</span>
                    <span className={`uplift-adapt-delta ${adapt.delta > 0 ? "uplift-adapt-delta--positive" : "uplift-adapt-delta--negative"}`}>
                      {adapt.delta > 0 ? "+" : ""}{adapt.delta.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Learning Trajectory ──────────────────────── */}
      <Section
        icon={<Compass size={16} />}
        iconClass="uplift-section-icon--trajectory"
        title="Learning Trajectory"
        subtitle="Competency progression across learning profiles"
      >
        <LearningTrajectoryCard callerId={callerId} />
      </Section>

      {/* ── Engagement ───────────────────────────────── */}
      <Section
        icon={<Activity size={16} />}
        iconClass="uplift-section-icon--engage"
        title="Engagement"
        subtitle="Activity and knowledge growth"
        defaultOpen
      >
        <div className="uplift-engage-grid">
          {insights && (
            <div className="uplift-engage-card">
              <div className="uplift-engage-value">
                {insights.momentum === "accelerating" ? "🔥" : insights.momentum === "steady" ? "→" : insights.momentum === "slowing" ? "↓" : "·"}
              </div>
              <div className="uplift-engage-label">Momentum</div>
              <div className="uplift-engage-sub">{insights.momentum}</div>
            </div>
          )}
          {insights && insights.callStreak > 0 && (
            <div className="uplift-engage-card">
              <div className="uplift-engage-value">{insights.callStreak}</div>
              <div className="uplift-engage-label">Day Streak</div>
              <div className="uplift-engage-sub">{insights.callStreak >= 3 ? "🔥 on fire" : "building"}</div>
            </div>
          )}
          <div className="uplift-engage-card">
            <div className="uplift-engage-value">{data.callFrequencyPerWeek}</div>
            <div className="uplift-engage-label">Calls / Week</div>
          </div>
          <div className="uplift-engage-card">
            <div className="uplift-engage-value">{data.memoryCounts.total}</div>
            <div className="uplift-engage-label">Memories</div>
            <div className="uplift-engage-sub">
              {data.memoryCounts.facts}f · {data.memoryCounts.preferences}p · {data.memoryCounts.topics}t
            </div>
          </div>
          <div className="uplift-engage-card">
            <div className="uplift-engage-value">{data.timeOnPlatformDays}</div>
            <div className="uplift-engage-label">Days Active</div>
          </div>
        </div>
      </Section>
    </div>
  );
}

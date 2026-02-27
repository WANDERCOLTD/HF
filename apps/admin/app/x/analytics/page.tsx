"use client";

import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { AdvancedBanner } from "@/components/shared/AdvancedBanner";

// ---------- Types ----------

interface AnalyticsData {
  period: { days: number; startDate: string; endDate: string };
  learnerProgress: {
    totalWithCurricula: number;
    averageCertifiedMastery: number;
    averageCertificationReadiness: number;
    distribution: { low: number; medium: number; high: number; mastered: number };
  };
  goals: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    byType: Array<{ type: string; count: number }>;
    averageProgress: number;
    recentlyCompleted: number;
  };
  onboarding: {
    totalSessions: number;
    completedSessions: number;
    completionRate: number;
    averageDurationMs: number | null;
    averageGoalsDiscovered: number;
    byDomain: Array<{ domainId: string; domainName: string; total: number; completed: number }>;
  };
  pipeline: {
    totalRuns: number;
    successCount: number;
    failedCount: number;
    successRate: number;
    averageDurationMs: number | null;
    recentFailures: number;
    byPhase: Array<{ phase: string; count: number; successCount: number }>;
  };
  activity: {
    callsPerDay: Array<{ date: string; count: number }>;
    newCallersPerDay: Array<{ date: string; count: number }>;
    activeCallers7d: number;
    totalCalls: number;
    totalCallers: number;
  };
}

// ---------- Color constants ----------

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "#3b82f6",
  COMPLETED: "#10b981",
  PAUSED: "#f59e0b",
  ARCHIVED: "#6b7280",
};

const TYPE_COLORS: Record<string, string> = {
  LEARN: "#8b5cf6",
  ACHIEVE: "#3b82f6",
  CHANGE: "#f59e0b",
  CONNECT: "#ec4899",
  SUPPORT: "#10b981",
  CREATE: "#f97316",
};

const DIST_COLORS = {
  low: "#ef4444",
  medium: "#f59e0b",
  high: "#3b82f6",
  mastered: "#10b981",
};

const DIST_LABELS: Record<string, string> = {
  low: "0-25%",
  medium: "25-50%",
  high: "50-75%",
  mastered: "75-100%",
};

// ---------- Helpers ----------

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ---------- Inline SVG Trend Chart ----------

function TrendChart({
  data,
  color,
  label,
  height = 180,
}: {
  data: Array<{ date: string; count: number }>;
  color: string;
  label: string;
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
        No data for this period
      </div>
    );
  }

  const width = 560;
  const padX = 44;
  const padY = 24;
  const padBottom = 28;
  const chartW = width - padX * 2;
  const chartH = height - padY - padBottom;

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const yTicks = [0, Math.round(maxCount / 2), maxCount];

  const points = data.map((d, i) => {
    const x = padX + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW);
    const y = padY + chartH - (d.count / maxCount) * chartH;
    return { x, y, ...d };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Area path
  const areaPath = [
    `M ${points[0].x},${padY + chartH}`,
    ...points.map((p) => `L ${p.x},${p.y}`),
    `L ${points[points.length - 1].x},${padY + chartH}`,
    "Z",
  ].join(" ");

  // X-axis labels: first, middle, last
  const xLabels: Array<{ x: number; label: string }> = [];
  if (data.length >= 1) {
    xLabels.push({ x: points[0].x, label: data[0].date.slice(5) });
  }
  if (data.length >= 3) {
    const mid = Math.floor(data.length / 2);
    xLabels.push({ x: points[mid].x, label: data[mid].date.slice(5) });
  }
  if (data.length >= 2) {
    xLabels.push({
      x: points[points.length - 1].x,
      label: data[data.length - 1].date.slice(5),
    });
  }

  return (
    <div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{ display: "block" }}
      >
        {/* Grid lines */}
        {yTicks.map((tick) => {
          const y = padY + chartH - (tick / maxCount) * chartH;
          return (
            <g key={tick}>
              <line
                x1={padX}
                y1={y}
                x2={padX + chartW}
                y2={y}
                stroke="var(--border-default)"
                strokeDasharray="4 4"
              />
              <text
                x={padX - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--text-muted)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill={color} opacity={0.12} />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={color}>
            <title>
              {p.date}: {p.count}
            </title>
          </circle>
        ))}

        {/* X-axis labels */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={padY + chartH + 18}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-muted)"
          >
            {l.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ---------- Reusable sub-components ----------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface-primary)",
        border: "1px solid var(--border-default)",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function PanelCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--surface-primary)",
        border: "1px solid var(--border-default)",
        borderRadius: 12,
        padding: 24,
        marginBottom: 20,
      }}
    >
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--text-primary)",
          margin: "0 0 16px 0",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

// ---------- Main Page ----------

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data, loading, error } = useApi<AnalyticsData>(
    `/api/analytics?days=${days}`,
    {
      transform: (res) => res as unknown as AnalyticsData,
    },
    [days]
  );

  if (loading) {
    return (
      <div className="hf-page-container">
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-page-container">
        <div
          style={{
            background: "var(--status-error-bg)",
            border: "1px solid var(--status-error-border)",
            borderRadius: 8,
            padding: 16,
            color: "var(--status-error-text)",
          }}
        >
          Error: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="hf-page-container">
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>
          No analytics data available
        </div>
      </div>
    );
  }

  const { learnerProgress, goals, onboarding, pipeline, activity } = data;

  // Goal helpers
  const maxGoalStatusCount = Math.max(...goals.byStatus.map((s) => s.count), 1);

  return (
    <div className="hf-page-container">
      <AdvancedBanner />
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="hf-page-title">
          Analytics
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }}>
          Learner progress, goals, onboarding, pipeline health, and activity trends
        </p>
      </div>

      {/* Period Selector */}
      <div style={{ marginBottom: 20, display: "flex", gap: 8 }}>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border:
                days === d
                  ? "2px solid var(--button-primary-bg)"
                  : "1px solid var(--border-default)",
              background: days === d ? "var(--status-info-bg)" : "var(--surface-primary)",
              color: "var(--text-primary)",
              fontWeight: days === d ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {d} days
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Active Callers (7d)"
          value={activity.activeCallers7d.toLocaleString()}
          sub={`${activity.totalCallers.toLocaleString()} total`}
        />
        <StatCard
          label="Active Goals"
          value={
            goals.byStatus.find((s) => s.status === "ACTIVE")?.count.toLocaleString() || "0"
          }
          sub={`${goals.total.toLocaleString()} total`}
        />
        <StatCard
          label="Pipeline Success"
          value={pct(pipeline.successRate)}
          sub={`${pipeline.totalRuns.toLocaleString()} runs (${days}d)`}
        />
        <StatCard
          label="Onboarding Rate"
          value={pct(onboarding.completionRate)}
          sub={`${onboarding.completedSessions} of ${onboarding.totalSessions} sessions`}
        />
      </div>

      {/* Panel 1: Learner Progress */}
      <PanelCard title="Learner Progress">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
              {learnerProgress.totalWithCurricula}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Learners with Curricula
            </div>
          </div>
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
              {pct(learnerProgress.averageCertifiedMastery)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Avg Certified Mastery
            </div>
          </div>
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
              {pct(learnerProgress.averageCertificationReadiness)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Avg Certification Readiness
            </div>
          </div>
        </div>

        {/* Distribution Bar */}
        {(() => {
          const dist = learnerProgress.distribution;
          const total = dist.low + dist.medium + dist.high + dist.mastered;
          if (total === 0) {
            return (
              <div
                style={{
                  textAlign: "center",
                  padding: 20,
                  color: "var(--text-muted)",
                  fontSize: 14,
                }}
              >
                No mastery data yet
              </div>
            );
          }
          return (
            <div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
                Mastery Distribution ({total} learners)
              </div>
              <div
                style={{
                  display: "flex",
                  height: 28,
                  borderRadius: 6,
                  overflow: "hidden",
                  background: "var(--surface-tertiary)",
                }}
              >
                {(["low", "medium", "high", "mastered"] as const).map((key) => {
                  const count = dist[key];
                  if (count === 0) return null;
                  const widthPct = (count / total) * 100;
                  return (
                    <div
                      key={key}
                      title={`${DIST_LABELS[key]}: ${count} learners`}
                      style={{
                        width: `${widthPct}%`,
                        background: DIST_COLORS[key],
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "white",
                        minWidth: count > 0 ? 24 : 0,
                      }}
                    >
                      {widthPct > 10 ? count : ""}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                {(["low", "medium", "high", "mastered"] as const).map((key) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: DIST_COLORS[key],
                        display: "inline-block",
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {DIST_LABELS[key]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </PanelCard>

      {/* Panel 2: Goal Analytics */}
      <PanelCard title="Goal Analytics">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* By Status - horizontal bars */}
          <div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
              By Status
            </div>
            {goals.byStatus.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No goals</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {goals.byStatus.map((s) => (
                  <div key={s.status} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 80,
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        textTransform: "capitalize",
                      }}
                    >
                      {s.status.toLowerCase()}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        height: 20,
                        background: "var(--surface-tertiary)",
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${(s.count / maxGoalStatusCount) * 100}%`,
                          height: "100%",
                          background: STATUS_COLORS[s.status] || "#6b7280",
                          borderRadius: 4,
                          minWidth: s.count > 0 ? 4 : 0,
                        }}
                      />
                    </div>
                    <div style={{ width: 32, fontSize: 13, fontWeight: 600, textAlign: "right" }}>
                      {s.count}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By Type - badges */}
          <div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
              By Type
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {goals.byType.map((t) => (
                <div
                  key={t.type}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 20,
                    background: "var(--surface-secondary)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: TYPE_COLORS[t.type] || "#6b7280",
                    }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {t.type}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    {t.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div
          style={{
            display: "flex",
            gap: 24,
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border-default)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Avg Progress:</span>
            <div
              style={{
                width: 100,
                height: 8,
                background: "var(--surface-tertiary)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${goals.averageProgress * 100}%`,
                  height: "100%",
                  background: "var(--accent-primary)",
                  borderRadius: 4,
                }}
              />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{pct(goals.averageProgress)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Completed (7d):
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--status-success-text)" }}>
              {goals.recentlyCompleted}
            </span>
          </div>
        </div>
      </PanelCard>

      {/* Panel 3: Onboarding */}
      <PanelCard title="Onboarding">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
              {onboarding.totalSessions}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Total Sessions</div>
          </div>
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--status-success-text)" }}>
              {pct(onboarding.completionRate)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Completion Rate</div>
          </div>
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
              {formatDuration(onboarding.averageDurationMs)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Avg Duration</div>
          </div>
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
              {onboarding.averageGoalsDiscovered}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Avg Goals Discovered
            </div>
          </div>
        </div>

        {/* Domain breakdown */}
        {onboarding.byDomain.length > 0 && (
          <div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
              By Domain
            </div>
            <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border-default)" }}>
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr",
                  padding: "8px 12px",
                  background: "var(--surface-secondary)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                }}
              >
                <div>Institution</div>
                <div style={{ textAlign: "right" }}>Total</div>
                <div style={{ textAlign: "right" }}>Completed</div>
                <div style={{ textAlign: "right" }}>Rate</div>
              </div>
              {onboarding.byDomain.map((d, i) => (
                <div
                  key={d.domainId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 1fr",
                    padding: "8px 12px",
                    background: i % 2 === 0 ? "var(--surface-primary)" : "var(--surface-secondary)",
                    fontSize: 13,
                  }}
                >
                  <div style={{ color: "var(--text-primary)" }}>{d.domainName}</div>
                  <div style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                    {d.total}
                  </div>
                  <div style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                    {d.completed}
                  </div>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>
                    {d.total > 0 ? pct(d.completed / d.total) : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </PanelCard>

      {/* Panel 4: Pipeline Health */}
      <PanelCard title="Pipeline Health">
        {pipeline.recentFailures > 0 && (
          <div
            style={{
              background: "var(--status-warning-bg)",
              border: "1px solid var(--status-warning-border)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 13,
              color: "var(--status-warning-text)",
            }}
          >
            {pipeline.recentFailures} pipeline failure{pipeline.recentFailures !== 1 ? "s" : ""}{" "}
            in the last 24 hours
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
              {pipeline.totalRuns}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Total Runs</div>
          </div>
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: pipeline.successRate >= 0.9 ? "var(--status-success-text)" : pipeline.successRate >= 0.7 ? "var(--status-warning-text)" : "var(--status-error-text)",
              }}
            >
              {pct(pipeline.successRate)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Success Rate</div>
          </div>
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
              {formatDuration(pipeline.averageDurationMs)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Avg Duration</div>
          </div>
          <div
            style={{
              background: "var(--surface-secondary)",
              borderRadius: 8,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: pipeline.failedCount > 0 ? "var(--status-error-text)" : "var(--text-primary)",
              }}
            >
              {pipeline.failedCount}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Failed</div>
          </div>
        </div>

        {/* Phase breakdown */}
        {pipeline.byPhase.length > 0 && (
          <div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
              By Phase
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {pipeline.byPhase.map((p) => (
                <div
                  key={p.phase}
                  style={{
                    flex: 1,
                    background: "var(--surface-secondary)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 8,
                    padding: 14,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      marginBottom: 4,
                    }}
                  >
                    {p.phase}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
                    {p.count}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {p.count > 0 ? pct(p.successCount / p.count) : "—"} success
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </PanelCard>

      {/* Panel 5: Activity Trends */}
      <PanelCard title="Activity Trends">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 24,
            marginBottom: 16,
          }}
        >
          {/* Mini stats */}
          <div
            style={{
              display: "flex",
              gap: 16,
              gridColumn: "1 / -1",
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Calls ({days}d):</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {activity.totalCalls.toLocaleString()}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Total Callers:</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {activity.totalCallers.toLocaleString()}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Active (7d):</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-primary)" }}>
                {activity.activeCallers7d.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Charts */}
          <TrendChart
            data={activity.callsPerDay}
            color="#3b82f6"
            label="Calls per Day"
          />
          <TrendChart
            data={activity.newCallersPerDay}
            color="#10b981"
            label="New Callers per Day"
          />
        </div>
      </PanelCard>
    </div>
  );
}

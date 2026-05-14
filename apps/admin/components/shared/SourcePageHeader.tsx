"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, PlayCircle } from "lucide-react";
import Link from "next/link";

type AgentInfo = {
  agentId: string;
  title: string;
  description: string;
  enabled: boolean;
  opid?: string;
  relationship: "consumer" | "producer" | "both";
  latestRun: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    summary?: string;
  } | null;
  isRunning: boolean;
};

type RunState = "idle" | "running" | "done" | "error";
type RunFeedback = {
  agentId: string;
  state: RunState;
  message?: string;
};

export interface SourcePageHeaderProps {
  title: string | React.ReactNode;
  description: string;
  /** Data node ID for fetching related agents (optional - if omitted, agents bar won't show) */
  dataNodeId?: string;
  /** Optional icon (emoji or similar) */
  icon?: string;
  /** Optional count to display */
  count?: number;
  /** Optional actions to render on the right side */
  actions?: React.ReactNode;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  OK: { bg: "var(--status-success-bg)", text: "var(--status-success-text)", label: "OK" },
  RUNNING: { bg: "var(--status-info-bg)", text: "var(--status-info-text)", label: "Running" },
  ERROR: { bg: "var(--status-error-bg)", text: "var(--status-error-text)", label: "Error" },
  QUEUED: { bg: "var(--surface-secondary)", text: "var(--text-muted)", label: "Queued" },
};

const RELATIONSHIP_LABELS: Record<string, { label: string; color: string }> = {
  consumer: { label: "reads from", color: "var(--accent-primary)" },
  producer: { label: "writes to", color: "var(--status-success-text)" },
  both: { label: "reads/writes", color: "var(--badge-purple-text)" },
};

export function SourcePageHeader({
  title,
  description,
  dataNodeId,
  icon,
  count,
  actions,
}: SourcePageHeaderProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [runFeedback, setRunFeedback] = useState<RunFeedback | null>(null);

  // Fetch agents for this data node (only if dataNodeId provided)
  useEffect(() => {
    if (!dataNodeId) {
      setLoading(false);
      return;
    }
    fetch(`/api/agents/by-data-node?dataNode=${encodeURIComponent(dataNodeId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setAgents(data.agents || []);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [dataNodeId]);

  // Run an agent
  const handleRunAgent = useCallback(async (agent: AgentInfo) => {
    if (!agent.agentId || runFeedback?.state === "running" || !dataNodeId) return;

    setRunFeedback({ agentId: agent.agentId, state: "running" });

    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.agentId,
          settings: {},
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setRunFeedback({
          agentId: agent.agentId,
          state: "error",
          message: data.error || "Run failed",
        });
        // Clear error after 5 seconds
        setTimeout(() => setRunFeedback(null), 5000);
      } else {
        setRunFeedback({
          agentId: agent.agentId,
          state: "done",
          message: data.run?.summary || "Completed",
        });
        // Clear success after 3 seconds
        setTimeout(() => setRunFeedback(null), 3000);
      }

      // Refresh agents to get updated status
      const refreshRes = await fetch(
        `/api/agents/by-data-node?dataNode=${encodeURIComponent(dataNodeId)}`
      );
      const refreshData = await refreshRes.json();
      if (refreshData.ok) {
        setAgents(refreshData.agents || []);
      }
    } catch (err) {
      console.error("Error running agent:", err);
      setRunFeedback({
        agentId: agent.agentId,
        state: "error",
        message: "Network error",
      });
      setTimeout(() => setRunFeedback(null), 5000);
    }
  }, [dataNodeId, runFeedback]);

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Title row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {icon && <span style={{ fontSize: 24 }}>{icon}</span>}
            <h1 className="hf-page-title">{title}</h1>
            {count !== undefined && (
              <span
                style={{
                  fontSize: 14,
                  padding: "4px 10px",
                  background: "var(--surface-secondary)",
                  borderRadius: 12,
                  color: "var(--text-muted)",
                  fontWeight: 500,
                }}
              >
                {count.toLocaleString()}
              </span>
            )}
          </div>
          <p className="hf-page-subtitle">
            {description}
          </p>
        </div>
        {actions && <div>{actions}</div>}
      </div>

      {/* Agents bar */}
      {!loading && agents.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            background: "var(--surface-secondary)",
            borderRadius: 10,
            border: "1px solid var(--border-default)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
            Related Agents:
          </span>

          {agents.map((agent) => {
            const statusInfo = agent.latestRun
              ? STATUS_COLORS[agent.latestRun.status] || STATUS_COLORS.QUEUED
              : null;
            const relInfo = RELATIONSHIP_LABELS[agent.relationship];
            const thisAgentFeedback = runFeedback?.agentId === agent.agentId ? runFeedback : null;
            const isRunning = thisAgentFeedback?.state === "running" || agent.isRunning;
            const justFinished = thisAgentFeedback?.state === "done";
            const hasError = thisAgentFeedback?.state === "error";

            return (
              <div
                key={agent.agentId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: justFinished ? "var(--status-success-bg)" : hasError ? "var(--status-error-bg)" : "var(--surface-primary)",
                  borderRadius: 8,
                  border: `1px solid ${justFinished ? "var(--status-success-text)" : hasError ? "var(--status-error-text)" : "var(--border-default)"}`,
                  transition: "all 0.3s ease",
                }}
              >
                {/* Agent name with link to agents page */}
                <Link
                  href={`/agents?highlight=${agent.agentId}`}
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    textDecoration: "none",
                  }}
                  title={agent.description}
                >
                  {agent.title}
                </Link>

                {/* Relationship badge */}
                <span
                  style={{
                    fontSize: 9,
                    padding: "2px 6px",
                    background: `color-mix(in srgb, ${relInfo.color} 10%, transparent)`,
                    color: relInfo.color,
                    borderRadius: 4,
                    fontWeight: 500,
                    textTransform: "uppercase",
                  }}
                >
                  {relInfo.label}
                </span>

                {/* Last run info */}
                {agent.latestRun && !isRunning && !justFinished && !hasError && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title={`Last run: ${new Date(agent.latestRun.startedAt).toLocaleString()}`}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: statusInfo?.text || "var(--text-muted)",
                      }}
                    />
                    {formatRelativeTime(agent.latestRun.startedAt)}
                  </span>
                )}

                {/* Running indicator */}
                {isRunning && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      background: "var(--status-info-bg)",
                      color: "var(--status-info-text)",
                      borderRadius: 4,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        border: "2px solid var(--status-info-text)",
                        borderTopColor: "transparent",
                        borderRadius: "50%",
                        animation: "spin 0.8s linear infinite",
                      }}
                    />
                    Running...
                  </span>
                )}

                {/* Done feedback */}
                {justFinished && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      background: "var(--status-success-bg)",
                      color: "var(--status-success-text)",
                      borderRadius: 4,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Check size={12} />
                    Done
                  </span>
                )}

                {/* Error feedback */}
                {hasError && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      background: "var(--status-error-bg)",
                      color: "var(--status-error-text)",
                      borderRadius: 4,
                      fontWeight: 600,
                      maxWidth: 150,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={thisAgentFeedback?.message}
                  >
                    Error
                  </span>
                )}

                {/* Run button */}
                {agent.opid && agent.enabled && !isRunning && !justFinished && (
                  <button
                    onClick={() => handleRunAgent(agent)}
                    disabled={isRunning}
                    style={{
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: "var(--accent-primary)",
                      color: "var(--accent-primary-text)",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title={`Run ${agent.title}`}
                  >
                    <PlayCircle size={10} />
                    Run
                  </button>
                )}

                {/* Disabled indicator */}
                {!agent.enabled && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: "2px 6px",
                      background: "var(--surface-secondary)",
                      color: "var(--text-muted)",
                      borderRadius: 4,
                      fontWeight: 500,
                    }}
                  >
                    Disabled
                  </span>
                )}
              </div>
            );
          })}

          {/* View all agents link */}
          <Link
            href="/agents"
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              textDecoration: "none",
              marginLeft: "auto",
            }}
          >
            View all agents
          </Link>
        </div>
      )}

      {/* Spinner CSS */}
      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

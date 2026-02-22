"use client";

import { useState, useEffect, useRef } from "react";
import { VerticalSlider } from "@/components/shared/VerticalSlider";
import { AIConfigButton } from "@/components/shared/AIConfigButton";
import { DraggableTabs } from "@/components/shared/DraggableTabs";
import { SectionSelector, useSectionVisibility } from "@/components/shared/SectionSelector";
import { FileText as FileTextIcon, FileSearch, Brain, MessageCircle, BarChart3, Target, ClipboardCheck, CheckSquare, Gauge } from "lucide-react";
import { useViewMode } from "@/contexts/ViewModeContext";
import { useTerminology } from "@/contexts/TerminologyContext";
import { CATEGORY_COLORS, ACTION_TYPE_ICONS, ASSIGNEE_COLORS } from "./constants";
import type { Call, CallerIdentity, Domain, Memory, PersonalityObservation } from "./types";

type OpStatus = "ready" | "running" | "success" | "error" | "disabled";

type LogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: any;
};

type OpResult = {
  ok: boolean;
  opId: string;
  logs: LogEntry[];
  duration: number;
  error?: string;
  data?: {
    scoresCreated?: number;
    memoriesCreated?: number;
    agentMeasurements?: number;
    playbookUsed?: string | null;
  };
};

type OpDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  prereqs: string[];
};

const OPS: OpDefinition[] = [
  { id: "measure", label: "Measure Caller", shortLabel: "MEASURE", prereqs: [] },
  { id: "learn", label: "Extract Memories", shortLabel: "LEARN", prereqs: [] },
  { id: "measure-agent", label: "Measure Behaviour", shortLabel: "BEHAVIOUR", prereqs: [] },
  { id: "reward", label: "Compute Reward", shortLabel: "REWARD", prereqs: ["measure-agent"] },
  { id: "adapt", label: "Update Targets", shortLabel: "ADAPT", prereqs: ["reward"] },
];

type PipelineMode = "prep" | "prompt";
type PipelineStatus = "ready" | "running" | "success" | "error";

function OpPill({
  op,
  status,
  onClick,
  disabled,
  hasLogs,
  onShowLogs,
}: {
  op: OpDefinition;
  status: OpStatus;
  onClick: () => void;
  disabled: boolean;
  hasLogs?: boolean;
  onShowLogs?: () => void;
}) {
  const colors: Record<OpStatus, { bg: string; text: string; border: string }> = {
    ready: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", border: "var(--status-info-border)" },
    running: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)", border: "var(--status-warning-border)" },
    success: { bg: "var(--status-success-bg)", text: "var(--status-success-text)", border: "var(--status-success-border)" },
    error: { bg: "var(--status-error-bg)", text: "var(--status-error-text)", border: "var(--status-error-border)" },
    disabled: { bg: "var(--surface-secondary)", text: "var(--text-placeholder)", border: "var(--border-default)" },
  };

  const style = colors[disabled ? "disabled" : status];

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        // If has logs and not ready, show logs on click. Otherwise run op.
        if (hasLogs && status !== "ready" && status !== "running" && onShowLogs) {
          onShowLogs();
        } else if (!disabled && status !== "running") {
          onClick();
        }
      }}
      disabled={disabled || status === "running"}
      title={disabled ? `Requires: ${op.prereqs.join(", ")}` : hasLogs ? `${op.label} (click to view logs)` : op.label}
      className="hf-micro-pill"
      style={{
        background: style.bg,
        color: style.text,
        border: `1px solid ${style.border}`,
        cursor: disabled || status === "running" ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {status === "running" && <span className="hf-spinner-inline">⏳</span>}
      {status === "success" && <span>✓</span>}
      {status === "error" && <span>✗</span>}
      {op.shortLabel}
    </button>
  );
}

// Logs Panel Component
function LogsPanel({
  result,
  opId,
  onClose,
}: {
  result: OpResult | undefined;
  opId: string;
  onClose: () => void;
}) {
  const logLevel = getLogLevel();

  if (!result) {
    return (
      <div className="hf-p-md" style={{ borderTop: "1px solid var(--border-default)", background: "var(--background)" }}>
        <div className="hf-text-sm hf-text-placeholder">No logs available for this operation</div>
      </div>
    );
  }

  const opName = OPS.find((o) => o.id === opId)?.label || opId;
  const filteredLogs = filterLogs(result.logs, logLevel);
  const hiddenCount = result.logs.length - filteredLogs.length;

  return (
    <div className="hf-terminal">
      {/* Header */}
      <div className="hf-terminal-header">
        <div className="hf-flex hf-gap-md">
          <span className="hf-text-xs hf-text-bold" style={{ color: "var(--text-on-dark)" }}>{opName}</span>
          <span
            className="hf-micro-pill"
            style={{
              background: result.ok ? "var(--terminal-success-bg)" : "var(--terminal-error-bg)",
              color: result.ok ? "var(--terminal-success-text)" : "var(--terminal-error-text)",
            }}
          >
            {result.ok ? "SUCCESS" : "ERROR"}
          </span>
          <span className="hf-text-xs hf-text-placeholder">{result.duration}ms</span>
          {hiddenCount > 0 && (
            <span className="hf-text-muted hf-text-xxs">
              ({hiddenCount} hidden, level: {logLevel})
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="hf-btn-unstyled hf-text-placeholder hf-p-xs"
          style={{ fontSize: 14 }}
        >
          ✕
        </button>
      </div>

      {/* Logs */}
      <div className="hf-terminal-body">
        {logLevel === "off" ? (
          <div className="hf-text-muted" style={{ padding: "8px 16px" }}>
            Logging is off. Change in Cockpit settings to see logs.
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="hf-text-muted" style={{ padding: "8px 16px" }}>No log entries</div>
        ) : (
          filteredLogs.map((log, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                padding: "4px 16px",
                borderLeft: `3px solid ${
                  log.level === "error" ? "var(--status-error-text)" : log.level === "warn" ? "var(--status-warning-text)" : log.level === "debug" ? "var(--text-muted)" : "var(--status-info-text)"
                }`,
                background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
              }}
            >
              <span className="hf-text-muted hf-flex-shrink-0" style={{ width: 80 }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span
                className="hf-text-bold hf-flex-shrink-0"
                style={{
                  width: 50,
                  color:
                    log.level === "error"
                      ? "var(--terminal-error-text)"
                      : log.level === "warn"
                      ? "var(--terminal-warning-text)"
                      : log.level === "debug"
                      ? "var(--text-placeholder)"
                      : "var(--terminal-info-text)",
                }}
              >
                {log.level.toUpperCase()}
              </span>
              <span className="hf-flex-1" style={{ color: "var(--text-on-dark)" }}>
                {log.message}
                {log.data && (
                  <span className="hf-text-placeholder" style={{ marginLeft: 8 }}>
                    {typeof log.data === "object" ? JSON.stringify(log.data) : String(log.data)}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Error message if present */}
      {result.error && (
        <div className="hf-text-xs" style={{ padding: "8px 16px", background: "var(--terminal-error-bg)", color: "var(--terminal-error-text)" }}>
          Error: {result.error}
        </div>
      )}
    </div>
  );
}

// Pipeline Logs Panel - for new pipeline modes
function PipelineLogsPanel({
  result,
  mode,
  onClose,
}: {
  result: OpResult | undefined;
  mode: PipelineMode;
  onClose: () => void;
}) {
  const { terms } = useTerminology();
  const logLevel = getLogLevel();

  if (!result) {
    return (
      <div className="hf-p-md" style={{ borderTop: "1px solid var(--border-default)", background: "var(--background)" }}>
        <div className="hf-text-sm hf-text-placeholder">No logs available for this operation</div>
      </div>
    );
  }

  const modeName = mode === "prep" ? "Prep (Analysis)" : "Prompt (Full Pipeline)";
  const filteredLogs = filterLogs(result.logs, logLevel);
  const hiddenCount = result.logs.length - filteredLogs.length;

  // Check if this was a "success" with zero results (potential config issue)
  const isZeroResults = result.ok && result.data &&
    (result.data.scoresCreated || 0) + (result.data.agentMeasurements || 0) === 0;

  return (
    <div className="hf-terminal">
      {/* Header */}
      <div className="hf-terminal-header">
        <div className="hf-flex hf-gap-md">
          <span className="hf-text-xs hf-text-bold" style={{ color: "var(--text-on-dark)" }}>{modeName}</span>
          <span
            className="hf-micro-pill"
            style={{
              background: isZeroResults ? "var(--terminal-warning-bg)" : result.ok ? "var(--terminal-success-bg)" : "var(--terminal-error-bg)",
              color: isZeroResults ? "var(--terminal-warning-text)" : result.ok ? "var(--terminal-success-text)" : "var(--terminal-error-text)",
            }}
          >
            {isZeroResults ? "⚠️ 0 RESULTS" : result.ok ? "SUCCESS" : "ERROR"}
          </span>
          <span className="hf-text-xs hf-text-placeholder">{result.duration}ms</span>
          {hiddenCount > 0 && (
            <span className="hf-text-muted hf-text-xxs">
              ({hiddenCount} hidden, level: {logLevel})
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="hf-btn-unstyled hf-text-placeholder hf-p-xs"
          style={{ fontSize: 14 }}
        >
          ✕
        </button>
      </div>

      {/* Summary - show key counts for quick visibility */}
      {result.data && (
        <div
          className="hf-flex hf-gap-lg hf-text-xs"
          style={{
            padding: "6px 16px",
            borderBottom: "1px solid var(--border-dark)",
            background: "var(--surface-dark)",
          }}
        >
          <span className="hf-text-placeholder">
            📊 Scores: <strong style={{ color: (result.data.scoresCreated || 0) > 0 ? "var(--terminal-success-text)" : "var(--terminal-error-text)" }}>{result.data.scoresCreated || 0}</strong>
          </span>
          <span className="hf-text-placeholder">
            🤖 Behaviour: <strong style={{ color: (result.data.agentMeasurements || 0) > 0 ? "var(--terminal-success-text)" : "var(--terminal-error-text)" }}>{result.data.agentMeasurements || 0}</strong>
          </span>
          <span className="hf-text-placeholder">
            💾 Memories: <strong style={{ color: "var(--terminal-info-text)" }}>{result.data.memoriesCreated || 0}</strong>
          </span>
          {result.data.playbookUsed && (
            <span className="hf-text-placeholder">
              📋 {terms.playbook}: <strong style={{ color: "var(--terminal-purple-text)" }}>{result.data.playbookUsed}</strong>
            </span>
          )}
        </div>
      )}

      {/* Logs */}
      <div className="hf-terminal-body">
        {logLevel === "off" ? (
          <div className="hf-text-muted" style={{ padding: "8px 16px" }}>
            Logging is off. Change in Cockpit settings to see logs.
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="hf-text-muted" style={{ padding: "8px 16px" }}>No log entries</div>
        ) : (
          filteredLogs.map((log, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                padding: "4px 16px",
                borderLeft: `3px solid ${
                  log.level === "error" ? "var(--status-error-text)" : log.level === "warn" ? "var(--status-warning-text)" : log.level === "debug" ? "var(--text-muted)" : "var(--status-info-text)"
                }`,
                background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
              }}
            >
              <span className="hf-text-muted hf-flex-shrink-0" style={{ width: 80 }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span
                className="hf-text-bold hf-flex-shrink-0"
                style={{
                  width: 50,
                  color:
                    log.level === "error"
                      ? "var(--terminal-error-text)"
                      : log.level === "warn"
                      ? "var(--terminal-warning-text)"
                      : log.level === "debug"
                      ? "var(--text-placeholder)"
                      : "var(--terminal-info-text)",
                }}
              >
                {log.level.toUpperCase()}
              </span>
              <span className="hf-flex-1" style={{ color: "var(--text-on-dark)" }}>
                {log.message}
                {log.data && (
                  <span className="hf-text-placeholder" style={{ marginLeft: 8 }}>
                    {typeof log.data === "object" ? JSON.stringify(log.data) : String(log.data)}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Error message if present */}
      {result.error && (
        <div className="hf-text-xs" style={{ padding: "8px 16px", background: "var(--terminal-error-bg)", color: "var(--terminal-error-text)" }}>
          Error: {result.error}
        </div>
      )}
    </div>
  );
}

// Log Level Colors
const LOG_LEVEL_COLORS: Record<string, { bg: string; text: string }> = {
  info: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)" },
  warn: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)" },
  error: { bg: "var(--status-error-bg)", text: "var(--status-error-text)" },
  debug: { bg: "var(--surface-secondary)", text: "var(--text-muted)" },
};

// Get logging level from localStorage
function getLogLevel(): "full" | "med" | "off" {
  if (typeof window === "undefined") return "full";
  const stored = localStorage.getItem("hf_log_level");
  if (stored === "full" || stored === "med" || stored === "off") return stored;
  return "full";
}

// Filter logs based on level
function filterLogs(logs: LogEntry[], level: "full" | "med" | "off"): LogEntry[] {
  if (level === "off") return [];
  if (level === "med") return logs.filter((log) => log.level !== "debug");
  return logs;
}

// Get AI engine setting from localStorage
function getAIEngine(): "mock" | "claude" | "openai" {
  if (typeof window === "undefined") return "mock";
  const stored = localStorage.getItem("hf_ai_engine");
  if (stored === "mock" || stored === "claude" || stored === "openai") return stored;
  return "mock";
}

// Processing Notice — shown in tabs when pipeline is running and data is empty
export function ProcessingNotice({ message }: { message: string }) {
  return (
    <div className="hf-banner hf-banner-info hf-flex hf-gap-sm hf-mb-md">
      <span className="hf-spinner-inline">⏳</span>
      {message}
    </div>
  );
}

// Calls Section
export function CallsSection({
  calls,
  expandedCall,
  setExpandedCall,
  callerId,
  processingCallIds,
  onCallUpdated,
}: {
  calls: Call[];
  expandedCall: string | null;
  setExpandedCall: (id: string | null) => void;
  callerId: string;
  processingCallIds?: Set<string>;
  onCallUpdated?: () => void;
}) {
  // Pipeline state (simplified: just prep and prompt)
  const [pipelineStatus, setPipelineStatus] = useState<Record<string, Record<PipelineMode, PipelineStatus>>>({});
  const [pipelineResults, setPipelineResults] = useState<Record<string, Record<PipelineMode, OpResult>>>({});
  const [logsPanel, setLogsPanel] = useState<{ callId: string; mode: PipelineMode } | null>(null);

  // Legacy op statuses (kept for pipeline result tracking)
  const [opStatuses, setOpStatuses] = useState<Record<string, Record<string, OpStatus>>>({});
  const [opResults, setOpResults] = useState<Record<string, Record<string, OpResult>>>({});

  // Initialize statuses from call data
  useEffect(() => {
    const initial: Record<string, Record<string, OpStatus>> = {};
    const pipelineInitial: Record<string, Record<PipelineMode, PipelineStatus>> = {};
    for (const call of calls) {
      initial[call.id] = {
        measure: call.hasScores ? "success" : "ready",
        learn: call.hasMemories ? "success" : "ready",
        "measure-agent": call.hasBehaviorMeasurements ? "success" : "ready",
        reward: call.hasRewardScore ? "success" : "ready",
        adapt: "ready",
      };
      // Pipeline status based on what's done
      const prepDone = call.hasScores && call.hasMemories && call.hasBehaviorMeasurements && call.hasRewardScore;
      pipelineInitial[call.id] = {
        prep: prepDone ? "success" : "ready",
        prompt: "ready", // We don't track this yet
      };
    }
    setOpStatuses(initial);
    setPipelineStatus(pipelineInitial);
  }, [calls]);

  // Track which calls have details loaded
  const [callDetails, setCallDetails] = useState<Record<string, any>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});

  // Load call details when expanded
  const loadCallDetails = async (callId: string) => {
    if (callDetails[callId] || loadingDetails[callId]) return;

    setLoadingDetails((prev) => ({ ...prev, [callId]: true }));
    try {
      const response = await fetch(`/api/calls/${callId}`);
      const result = await response.json();
      if (result.ok) {
        setCallDetails((prev) => ({ ...prev, [callId]: result }));
      }
    } catch (error) {
      console.error("Failed to load call details:", error);
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [callId]: false }));
    }
  };

  // Expand/collapse all
  const [allExpanded, setAllExpanded] = useState(false);
  const toggleAll = () => {
    if (allExpanded) {
      setExpandedCall(null);
    } else {
      // Expand first call and load its details
      if (calls.length > 0) {
        setExpandedCall(calls[0].id);
        loadCallDetails(calls[0].id);
      }
    }
    setAllExpanded(!allExpanded);
  };

  // Load details when a call is expanded
  useEffect(() => {
    if (expandedCall) {
      loadCallDetails(expandedCall);
    }
  }, [expandedCall]);

  // Invalidate cached call details when pipeline completes (status flags change)
  // Without this, expanding a call before pipeline finishes caches empty data permanently
  const prevCallFlagsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const newFlags: Record<string, string> = {};
    const staleIds: string[] = [];

    for (const call of calls) {
      const key = [call.hasScores, call.hasMemories, call.hasBehaviorMeasurements, call.hasRewardScore, call.hasPrompt].join("|");
      newFlags[call.id] = key;

      const prev = prevCallFlagsRef.current[call.id];
      if (prev && prev !== key) {
        staleIds.push(call.id);
      }
    }

    prevCallFlagsRef.current = newFlags;

    if (staleIds.length > 0) {
      // Clear stale cache entries
      setCallDetails((prev) => {
        const next = { ...prev };
        for (const id of staleIds) delete next[id];
        return next;
      });

      // Re-fetch expanded call if it was invalidated
      if (expandedCall && staleIds.includes(expandedCall)) {
        setLoadingDetails((prev) => ({ ...prev, [expandedCall]: true }));
        fetch(`/api/calls/${expandedCall}`)
          .then((r) => r.json())
          .then((result) => {
            if (result.ok) {
              setCallDetails((prev) => ({ ...prev, [expandedCall!]: result }));
            }
          })
          .catch((err) => console.error("Failed to reload call details:", err))
          .finally(() => setLoadingDetails((prev) => ({ ...prev, [expandedCall!]: false })));
      }
    }
  }, [calls, expandedCall]);

  // Bulk operation state
  const [bulkRunning, setBulkRunning] = useState<PipelineMode | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; callId?: string } | null>(null);
  // Per-call pipeline state
  const [runningOnCall, setRunningOnCall] = useState<{ callId: string; mode: PipelineMode } | null>(null);

  // Run pipeline on a single call
  const runPipeline = async (callId: string, mode: PipelineMode): Promise<boolean> => {
    setPipelineStatus((prev) => ({
      ...prev,
      [callId]: { ...prev[callId], [mode]: "running" },
    }));

    try {
      const engine = getAIEngine();
      const response = await fetch(`/api/calls/${callId}/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerId, mode, engine }),
      });

      const result = await response.json();

      setPipelineResults((prev) => ({
        ...prev,
        [callId]: {
          ...prev[callId],
          [mode]: {
            ok: result.ok,
            opId: mode,
            logs: result.logs || [],
            duration: result.duration || 0,
            error: result.error,
            data: result.data, // Include summary data for visibility
          },
        },
      }));

      setPipelineStatus((prev) => ({
        ...prev,
        [callId]: { ...prev[callId], [mode]: result.ok ? "success" : "error" },
      }));

      // Also update legacy op statuses for UI
      if (result.ok) {
        setOpStatuses((prev) => ({
          ...prev,
          [callId]: {
            measure: "success",
            learn: "success",
            "measure-agent": "success",
            reward: "success",
            adapt: "success",
          },
        }));
      }

      if (!result.ok) {
        setLogsPanel({ callId, mode });
      }

      return result.ok;
    } catch (error: any) {
      setPipelineResults((prev) => ({
        ...prev,
        [callId]: {
          ...prev[callId],
          [mode]: {
            ok: false,
            opId: mode,
            logs: [{ timestamp: new Date().toISOString(), level: "error", message: error.message || "Network error" }],
            duration: 0,
            error: error.message,
          },
        },
      }));

      setPipelineStatus((prev) => ({
        ...prev,
        [callId]: { ...prev[callId], [mode]: "error" },
      }));

      setLogsPanel({ callId, mode });
      return false;
    }
  };

  // Run pipeline on single call (standalone button)
  const runPipelineOnCall = async (callId: string, mode: PipelineMode) => {
    setRunningOnCall({ callId, mode });
    await runPipeline(callId, mode);
    setRunningOnCall(null);
    if (onCallUpdated) onCallUpdated();
  };

  // Run pipeline on ALL calls (oldest first for proper chronological processing)
  const runPipelineOnAllCalls = async (mode: PipelineMode, replaceExisting = false) => {
    // Sort calls by createdAt ascending (oldest first)
    const sortedCalls = [...calls].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // For prompt mode, check if there are existing prompts
    if (mode === "prompt" && !replaceExisting) {
      const existingCount = sortedCalls.filter(c => pipelineStatus[c.id]?.prompt === "success").length;
      if (existingCount > 0) {
        const shouldReplace = window.confirm(
          `${existingCount} call(s) already have prompts generated.\n\n` +
          `Click OK to replace ALL existing prompts (oldest call first).\n` +
          `Click Cancel to skip calls with existing prompts.`
        );
        if (!shouldReplace) {
          // Filter to only calls without prompts
          const callsToProcess = sortedCalls.filter(c => pipelineStatus[c.id]?.prompt !== "success");
          if (callsToProcess.length === 0) {
            alert("All calls already have prompts. Nothing to do.");
            return;
          }
          setBulkRunning(mode);
          setBulkProgress({ current: 0, total: callsToProcess.length });

          for (let i = 0; i < callsToProcess.length; i++) {
            const call = callsToProcess[i];
            setBulkProgress({ current: i + 1, total: callsToProcess.length, callId: call.id });
            await runPipeline(call.id, mode);
          }

          setBulkRunning(null);
          setBulkProgress(null);
          if (onCallUpdated) onCallUpdated();
          return;
        }
      }
    }

    setBulkRunning(mode);
    setBulkProgress({ current: 0, total: sortedCalls.length });

    for (let i = 0; i < sortedCalls.length; i++) {
      const call = sortedCalls[i];
      setBulkProgress({ current: i + 1, total: sortedCalls.length, callId: call.id });
      await runPipeline(call.id, mode);
    }

    setBulkRunning(null);
    setBulkProgress(null);
    if (onCallUpdated) onCallUpdated();
  };

  if (calls.length === 0) {
    return (
      <div className="hf-empty">
        <div className="hf-empty-state-icon hf-mb-md">📞</div>
        <div className="hf-empty-state-title">No calls yet</div>
      </div>
    );
  }

  return (
    <div className="hf-flex-col hf-gap-sm">
      {calls.map((call) => {
        const isExpanded = expandedCall === call.id;
        const callPipelineStatus = pipelineStatus[call.id] || { prep: "ready", prompt: "ready" };
        const callPipelineResults = pipelineResults[call.id] || {};
        const hasAnyLogs = Object.keys(callPipelineResults).length > 0;
        const showingLogs = logsPanel?.callId === call.id;
        const isRunningOnThisCall = runningOnCall?.callId === call.id;

        // Get status color for pipeline mode - show warning if success but 0 results
        const getStatusStyle = (status: PipelineStatus, mode?: PipelineMode) => {
          // Check if this was a "success" with zero results (potential bug)
          const result = mode ? callPipelineResults[mode] : null;
          const isZeroResults = result?.ok && result?.data &&
            (result.data.scoresCreated || 0) + (result.data.agentMeasurements || 0) === 0;

          const colors: Record<PipelineStatus | "warning", { bg: string; text: string; border: string }> = {
            ready: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", border: "var(--status-info-border)" },
            running: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)", border: "var(--status-warning-border)" },
            success: { bg: "var(--status-success-bg)", text: "var(--status-success-text)", border: "var(--status-success-border)" },
            error: { bg: "var(--status-error-bg)", text: "var(--status-error-text)", border: "var(--status-error-border)" },
            warning: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)", border: "var(--status-warning-border)" }, // Amber for zero results
          };

          if (status === "success" && isZeroResults) {
            return colors.warning;
          }
          return colors[status];
        };

        return (
          <div key={call.id} className="hf-expandable-card">
            <div
              className="hf-flex-between"
              style={{
                padding: "12px 16px",
                background: isExpanded ? "var(--background)" : "var(--surface-primary)",
              }}
            >
              {/* Left: Call info */}
              <button
                onClick={() => setExpandedCall(isExpanded ? null : call.id)}
                className="hf-btn-unstyled hf-flex hf-gap-md"
              >
                <span className="hf-text-md">📞</span>
                <span className="hf-text-md hf-text-500">{call.source}</span>
                {call.externalId && (
                  <span className="hf-text-xs hf-mono hf-text-placeholder">{call.externalId}</span>
                )}
                <span className="hf-text-xs hf-text-muted">{new Date(call.createdAt).toLocaleString()}</span>
                {/* Persistent status badges from database */}
                <div className="hf-flex hf-gap-xs" style={{ marginLeft: 8 }}>
                  {call.hasScores && (
                    <span
                      title="Analyzed - scores extracted"
                      className="hf-micro-badge"
                      style={{ background: "var(--status-success-bg)", color: "var(--status-success-text)" }}
                    >
                      ANALYZED
                    </span>
                  )}
                  {call.hasPrompt && (
                    <span
                      title="Prompt generated for this call"
                      className="hf-micro-badge"
                      style={{ background: "var(--badge-purple-bg)", color: "var(--badge-purple-text)" }}
                    >
                      PROMPTED
                    </span>
                  )}
                  {!call.hasScores && !call.hasPrompt && processingCallIds?.has(call.id) && (
                    <span
                      title="Pipeline running — extracting scores, memories, generating prompt"
                      className="hf-micro-badge hf-flex hf-gap-xs"
                      style={{ background: "var(--status-warning-bg)", color: "var(--status-warning-text)" }}
                    >
                      <span className="hf-spinner-inline" style={{ fontSize: 8 }}>⏳</span>
                      PROCESSING
                    </span>
                  )}
                  {!call.hasScores && !call.hasPrompt && !processingCallIds?.has(call.id) && (
                    <span
                      title="Not yet processed"
                      className="hf-micro-badge"
                      style={{ background: "var(--surface-secondary)", color: "var(--text-placeholder)" }}
                    >
                      NEW
                    </span>
                  )}
                </div>
              </button>

              {/* Right: Action buttons */}
              <div className="hf-flex hf-gap-sm">
                {/* Analyze button - runs prep pipeline */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    runPipelineOnCall(call.id, "prep");
                  }}
                  disabled={isRunningOnThisCall || bulkRunning !== null}
                  title="Run analysis pipeline (measure, learn, agent, reward, adapt)"
                  className="hf-micro-pill"
                  style={{
                    padding: "3px 10px",
                    background: "var(--surface-secondary)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
                    cursor: isRunningOnThisCall || bulkRunning ? "not-allowed" : "pointer",
                    opacity: isRunningOnThisCall || bulkRunning ? 0.6 : 1,
                  }}
                >
                  {runningOnCall?.callId === call.id && runningOnCall?.mode === "prep" ? "⏳" : "📊"} Analyze
                </button>

                {/* Prompt button - runs full pipeline + prompt */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    runPipelineOnCall(call.id, "prompt");
                  }}
                  disabled={isRunningOnThisCall || bulkRunning !== null}
                  title="Run full pipeline + generate prompt"
                  className="hf-micro-pill"
                  style={{
                    padding: "3px 10px",
                    background: "var(--button-primary-bg)",
                    color: "var(--text-on-dark)",
                    border: "none",
                    cursor: isRunningOnThisCall || bulkRunning ? "not-allowed" : "pointer",
                    opacity: isRunningOnThisCall || bulkRunning ? 0.6 : 1,
                  }}
                >
                  {runningOnCall?.callId === call.id && runningOnCall?.mode === "prompt" ? "⏳" : "📝"} Prompt
                </button>

                {/* AI Config button */}
                <div onClick={(e) => e.stopPropagation()} className="hf-flex">
                  <AIConfigButton callPoint="pipeline.measure" label="Pipeline AI Config" />
                </div>

                {/* Logs toggle */}
                {hasAnyLogs && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (showingLogs) {
                        setLogsPanel(null);
                      } else {
                        // Show most recent logs (prompt > prep)
                        const mode = callPipelineResults.prompt ? "prompt" : "prep";
                        setLogsPanel({ callId: call.id, mode });
                      }
                    }}
                    title="View logs"
                    className="hf-micro-pill"
                    style={{
                      background: showingLogs ? "var(--surface-dark)" : "var(--surface-secondary)",
                      color: showingLogs ? "var(--text-on-dark)" : "var(--text-muted)",
                      border: "1px solid var(--border-default)",
                    }}
                  >
                    📋
                  </button>
                )}

                {/* Expand toggle */}
                <button
                  onClick={() => setExpandedCall(isExpanded ? null : call.id)}
                  className="hf-btn-unstyled hf-text-placeholder"
                  style={{ padding: "4px 8px" }}
                >
                  {isExpanded ? "▼" : "▶"}
                </button>
              </div>
            </div>

            {/* Logs Panel */}
            {showingLogs && logsPanel && (
              <PipelineLogsPanel
                result={callPipelineResults[logsPanel.mode]}
                mode={logsPanel.mode}
                onClose={() => setLogsPanel(null)}
              />
            )}

            {isExpanded && (
              <CallDetailPanel
                call={call}
                callerId={callerId}
                details={callDetails[call.id]}
                loading={loadingDetails[call.id]}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Call Detail Panel - shows scores, memories, measurements when expanded
function CallDetailPanel({
  call,
  callerId,
  details,
  loading,
}: {
  call: Call;
  callerId: string;
  details: any;
  loading: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"transcript" | "extraction" | "measurements" | "prompt">("transcript");
  const [extractionVis, toggleExtractionVis] = useSectionVisibility("call-extraction", {
    memories: true, traits: true, scores: true, actions: true,
  });
  const [callActions, setCallActions] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/callers/${callerId}/actions?callId=${call.id}&limit=50`)
      .then((r) => r.json())
      .then((result) => { if (result.ok) setCallActions(result.actions || []); })
      .catch((e) => console.warn("[CallerDetail] Failed to load call actions:", e));
  }, [call.id, callerId]);

  if (loading) {
    return (
      <div className="hf-text-center hf-p-lg" style={{ borderTop: "1px solid var(--border-default)", background: "var(--background)" }}>
        <div className="hf-text-sm hf-text-muted">Loading analysis data...</div>
      </div>
    );
  }

  const scores = details?.scores || [];
  const memories = details?.memories || [];
  const measurements = details?.measurements || [];
  const rewardScore = details?.rewardScore;
  const triggeredPrompts = details?.triggeredPrompts || [];
  const effectiveTargets = details?.effectiveTargets || [];
  const personalityObservation = details?.personalityObservation;

  return (
    <div style={{ borderTop: "1px solid var(--border-default)", background: "var(--background)" }}>
      {/* Tabs - matching header tab styling */}
      <div className="hf-flex" style={{ gap: 2, borderBottom: "1px solid var(--border-default)", background: "var(--surface-primary)" }}>
        <DraggableTabs
          storageKey={`call-detail-tabs-${call.id}`}
          tabs={[
            { id: "transcript", label: "Transcript", icon: <FileTextIcon size={14} />, title: "View the full call transcript" },
            { id: "extraction", label: "Extraction", icon: <FileSearch size={14} />, count: memories.length + (personalityObservation ? 1 : 0) + scores.length, title: "What the pipeline learned from this caller" },
            { id: "measurements", label: "Behaviour", icon: <Brain size={14} />, count: measurements.length || null, title: "Agent behavioral measurements", accentColor: "var(--identity-accent, #4338ca)" },
            { id: "prompt", label: "Prompt", icon: <MessageCircle size={14} />, count: triggeredPrompts.length || null, title: "Composed prompts for the agent", accentColor: "var(--identity-accent, #4338ca)" },
          ]}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as typeof activeTab)}
          containerStyle={{ flex: 1, border: "none" }}
        />

        {/* Reward score badge */}
        {rewardScore && (
          <div className="hf-flex hf-gap-sm hf-ml-auto" style={{ padding: "10px 16px" }}>
            <span className="hf-text-xs hf-text-muted">Reward:</span>
            <span
              className="hf-text-bold"
              style={{
                fontSize: 12,
                color: rewardScore.overallScore >= 0.7 ? "var(--status-success-text)" : rewardScore.overallScore >= 0.4 ? "var(--status-warning-text)" : "var(--status-error-text)",
              }}
            >
              {(rewardScore.overallScore * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="hf-p-md">
        {activeTab === "transcript" && (
          <TranscriptTab transcript={call.transcript} />
        )}

        {activeTab === "extraction" && (
          <>
            <SectionSelector
              storageKey="call-extraction"
              sections={[
                { id: "memories", label: "Memories", icon: <MessageCircle size={13} />, count: memories.length },
                { id: "traits", label: "Traits", icon: <Brain size={13} />, count: personalityObservation ? 1 : 0 },
                { id: "scores", label: "Scores", icon: <BarChart3 size={13} />, count: scores.length },
                { id: "actions", label: "Actions", icon: <ClipboardCheck size={13} />, count: callActions.length },
              ]}
              visible={extractionVis}
              onToggle={toggleExtractionVis}
            />
            {extractionVis.memories !== false && <MemoriesTab memories={memories} />}
            {extractionVis.traits !== false && <CallTraitsTab observation={personalityObservation} />}
            {extractionVis.scores !== false && <ScoresTab scores={scores} />}
            {extractionVis.actions !== false && callActions.length > 0 && (
              <div style={{ padding: "12px 16px" }}>
                <div className="hf-text-bold hf-text-xs hf-mb-sm">Actions from this call</div>
                {callActions.map((action) => {
                  const colors = ASSIGNEE_COLORS[action.assignee] || ASSIGNEE_COLORS.CALLER;
                  return (
                    <div key={action.id} className="hf-flex hf-gap-sm" style={{ padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                      <div className="hf-text-muted">{ACTION_TYPE_ICONS[action.type] || <CheckSquare size={14} />}</div>
                      <span className="hf-text-xs hf-flex-1">{action.title}</span>
                      <span className="hf-micro-pill hf-text-500" style={{ padding: "1px 6px", borderRadius: 8, background: colors.bg, color: colors.text }}>{action.assignee}</span>
                      <span className="hf-text-muted hf-text-xxs" style={{ padding: "1px 6px", borderRadius: 8, background: "var(--surface-secondary)" }}>{action.status}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "measurements" && (
          <MeasurementsTab
            callerTargets={details?.callerTargets || []}
            behaviorTargets={effectiveTargets}
            measurements={measurements}
            rewardScore={rewardScore}
          />
        )}

        {activeTab === "prompt" && (
          <UnifiedDetailPromptTab prompts={triggeredPrompts} />
        )}
      </div>
    </div>
  );
}

// Prompt Tab - shows prompts triggered by this call
function PromptTab({ prompts }: { prompts: any[] }) {
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [copiedButton, setCopiedButton] = useState<string | null>(null);
  const copyToClipboard = (text: string, buttonId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedButton(buttonId);
    setTimeout(() => setCopiedButton(null), 1500);
  };

  if (prompts.length === 0) {
    return (
      <div className="hf-text-center hf-text-placeholder hf-p-20">
        No prompt generated after this call. Run the Prompt pipeline step to generate one.
      </div>
    );
  }

  return (
    <div className="hf-flex-col hf-gap-md">
      {prompts.map((prompt: any) => {
        const isExpanded = expandedPrompt === prompt.id;
        return (
          <div key={prompt.id} className="hf-expandable-card">
            {/* Header */}
            <div
              onClick={() => setExpandedPrompt(isExpanded ? null : prompt.id)}
              className="hf-flex-between hf-p-12"
              style={{
                cursor: "pointer",
                borderBottom: isExpanded ? "1px solid var(--border-default)" : "none",
              }}
            >
              <div className="hf-flex hf-gap-md">
                <span
                  className="hf-micro-pill hf-text-500"
                  style={{
                    background: prompt.status === "SUCCESS" ? "var(--status-success-bg)" : "var(--status-warning-bg)",
                    color: prompt.status === "SUCCESS" ? "var(--status-success-text)" : "var(--status-warning-text)",
                  }}
                >
                  {prompt.status || "COMPOSED"}
                </span>
                <span style={{ fontSize: 12 }} className="hf-text-muted">
                  {new Date(prompt.composedAt).toLocaleString()}
                </span>
                {prompt.model && (
                  <span className="hf-text-xs" style={{ color: "var(--text-placeholder)" }}>
                    via {prompt.model}
                  </span>
                )}
              </div>
              <div className="hf-flex hf-gap-sm">
                <span className="hf-text-xs" style={{ color: "var(--text-placeholder)" }}>
                  {prompt.prompt?.length || 0} chars
                </span>
                <span className="hf-text-muted">{isExpanded ? "▼" : "▶"}</span>
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div className="hf-p-sm">
                {/* Prompt text */}
                <div className="hf-code-block-sm">
                  {prompt.prompt || "No prompt content"}
                </div>

                {/* Inputs used */}
                {prompt.inputs && Object.keys(prompt.inputs).length > 0 && (
                  <div className="hf-mt-sm">
                    <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">
                      Inputs Used:
                    </div>
                    <div className="hf-text-xs hf-text-secondary">
                      {Object.entries(prompt.inputs).map(([key, value]) => (
                        <div key={key} style={{ marginBottom: 2 }}>
                          <span className="hf-text-500">{key}:</span>{" "}
                          <span className="hf-text-muted">
                            {typeof value === "object" ? JSON.stringify(value).slice(0, 100) : String(value).slice(0, 100)}
                            {String(value).length > 100 ? "..." : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Copy button */}
                <div className="hf-flex hf-gap-sm hf-mt-sm">
                  <button
                    onClick={() => copyToClipboard(prompt.prompt || "", `prompt-${prompt.id}`)}
                    className="hf-btn hf-btn-sm"
                    style={{
                      background: copiedButton === `prompt-${prompt.id}` ? "var(--button-success-bg)" : "var(--button-primary-bg)",
                      color: "white",
                      boxShadow: copiedButton === `prompt-${prompt.id}` ? "0 0 12px var(--button-success-bg)" : "none",
                    }}
                  >
                    {copiedButton === `prompt-${prompt.id}` ? "✓ Copied" : "Copy Prompt"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Unified Detail Prompt Tab - combines human-readable and LLM-friendly views
// Matches the layout of UnifiedPromptSection in the header
function UnifiedDetailPromptTab({ prompts }: { prompts: any[] }) {
  const [viewMode, setViewMode] = useState<"human" | "llm">("human");
  const [llmViewMode, setLlmViewMode] = useState<"pretty" | "raw">("pretty");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedButton, setCopiedButton] = useState<string | null>(null);
  const copyToClipboard = (text: string, buttonId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedButton(buttonId);
    setTimeout(() => setCopiedButton(null), 1500);
  };

  if (prompts.length === 0) {
    return (
      <div className="hf-text-center hf-text-placeholder hf-p-20">
        No prompt generated after this call. Run the Prompt pipeline step to generate one.
      </div>
    );
  }

  const selectedPrompt = prompts[selectedIndex] || prompts[0];
  const llm = selectedPrompt?.llmPrompt;
  const inputs = selectedPrompt?.inputs || {};

  return (
    <div className="hf-flex-col hf-gap-md">
      {/* Prompt selector when multiple prompts exist */}
      {prompts.length > 1 && (
        <div className="hf-flex hf-gap-sm hf-p-sm" style={{ background: "var(--surface-secondary)", borderRadius: 8 }}>
          <span className="hf-text-xs hf-text-muted">Prompts ({prompts.length}):</span>
          <div className="hf-flex-wrap hf-gap-xs">
            {prompts.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setSelectedIndex(i)}
                className="hf-text-xs"
                style={{
                  padding: "4px 10px",
                  background: i === selectedIndex ? "var(--button-primary-bg)" : "var(--surface-primary)",
                  color: i === selectedIndex ? "var(--text-on-dark)" : "var(--text-secondary)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                #{i + 1} - {new Date(p.composedAt).toLocaleTimeString()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Header with toggle - matches UnifiedPromptSection */}
      <div className="hf-flex-between">
        <div className="hf-flex hf-gap-md">
          <span
            className="hf-micro-pill hf-text-500"
            style={{
              background: selectedPrompt.status === "SUCCESS" ? "var(--status-success-bg)" : "var(--status-warning-bg)",
              color: selectedPrompt.status === "SUCCESS" ? "var(--status-success-text)" : "var(--status-warning-text)",
            }}
          >
            {selectedPrompt.status || "COMPOSED"}
          </span>
          <span style={{ fontSize: 12 }} className="hf-text-muted">
            {new Date(selectedPrompt.composedAt).toLocaleString()}
          </span>
          {selectedPrompt.model && (
            <span className="hf-text-xs" style={{ color: "var(--text-placeholder)" }}>via {selectedPrompt.model}</span>
          )}
        </div>
        <div className="hf-flex hf-gap-sm">
          <div className="hf-toggle-group">
            <button
              onClick={() => setViewMode("human")}
              className="hf-text-xs"
              style={{
                padding: "6px 12px",
                fontWeight: 500,
                background: viewMode === "human" ? "var(--button-primary-bg)" : "var(--surface-primary)",
                color: viewMode === "human" ? "var(--text-on-dark)" : "var(--text-secondary)",
                border: "none",
                cursor: "pointer",
              }}
            >
              📖 Human-Readable
            </button>
            <button
              onClick={() => setViewMode("llm")}
              className="hf-text-xs"
              style={{
                padding: "6px 12px",
                fontWeight: 500,
                background: viewMode === "llm" ? "var(--button-primary-bg)" : "var(--surface-primary)",
                color: viewMode === "llm" ? "var(--text-on-dark)" : "var(--text-secondary)",
                border: "none",
                cursor: "pointer",
              }}
            >
              🤖 LLM-Friendly
            </button>
          </div>
        </div>
      </div>

      {/* Human-Readable View */}
      {viewMode === "human" && (
        <div className="hf-flex-col hf-gap-md">
          <div className="hf-code-block-sm">
            {selectedPrompt.prompt || "No prompt content"}
          </div>

          {/* Inputs used */}
          {inputs && Object.keys(inputs).length > 0 && (
            <div className="hf-banner hf-banner-warning hf-p-12">
              <div className="hf-text-xs hf-text-bold hf-mb-sm" style={{ color: "var(--status-warning-text)" }}>
                Composition Inputs
              </div>
              <div className="hf-flex-wrap hf-gap-md" style={{ fontSize: 12, color: "var(--status-warning-text)" }}>
                {inputs.memoriesCount !== undefined && <span>Memories: {inputs.memoriesCount}</span>}
                {inputs.personalityAvailable !== undefined && <span>Personality: {inputs.personalityAvailable ? "Yes" : "No"}</span>}
                {inputs.recentCallsCount !== undefined && <span>Recent Calls: {inputs.recentCallsCount}</span>}
                {inputs.behaviorTargetsCount !== undefined && <span>Behavior Targets: {inputs.behaviorTargetsCount}</span>}
              </div>
            </div>
          )}

          {/* Copy button */}
          <button
            onClick={() => copyToClipboard(selectedPrompt.prompt || "", "latest-prompt")}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              background: copiedButton === "latest-prompt" ? "var(--button-success-bg)" : "var(--button-primary-bg)",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              alignSelf: "flex-start",
              transition: "all 0.2s ease",
              boxShadow: copiedButton === "latest-prompt" ? "0 0 12px var(--button-success-bg)" : "none",
            }}
          >
            {copiedButton === "latest-prompt" ? "✓ Copied" : "📋 Copy Prompt"}
          </button>
        </div>
      )}

      {/* LLM-Friendly View - matches UnifiedPromptSection with Pretty/Raw toggle */}
      {viewMode === "llm" && (
        <div className="hf-flex-col hf-gap-md">
          {!llm ? (
            <div className="hf-text-center hf-p-20" style={{ color: "var(--text-placeholder)", background: "var(--background)", borderRadius: 8 }}>
              No LLM-friendly JSON available for this prompt.
            </div>
          ) : (
            <>
              {/* Pretty/Raw Toggle */}
              <div className="hf-flex-between">
                <span className="hf-text-xs hf-text-muted">Structured JSON for AI agent consumption</span>
                <div className="hf-flex hf-gap-sm">
                  <div className="hf-toggle-group">
                    <button
                      onClick={() => setLlmViewMode("pretty")}
                      className="hf-text-xs"
                      style={{
                        padding: "4px 10px",
                        background: llmViewMode === "pretty" ? "var(--button-primary-bg)" : "var(--surface-primary)",
                        color: llmViewMode === "pretty" ? "var(--text-on-dark)" : "var(--text-secondary)",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Pretty
                    </button>
                    <button
                      onClick={() => setLlmViewMode("raw")}
                      className="hf-text-xs"
                      style={{
                        padding: "4px 10px",
                        background: llmViewMode === "raw" ? "var(--button-primary-bg)" : "var(--surface-primary)",
                        color: llmViewMode === "raw" ? "var(--text-on-dark)" : "var(--text-secondary)",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Raw JSON
                    </button>
                  </div>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(llm, null, 2), "llm-json-1")}
                    className="hf-text-xs"
                    style={{
                      padding: "4px 10px",
                      background: copiedButton === "llm-json-1" ? "var(--button-success-bg)" : "var(--surface-secondary)",
                      color: copiedButton === "llm-json-1" ? "white" : "var(--text-secondary)",
                      border: "1px solid var(--border-default)",
                      borderRadius: 6,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      boxShadow: copiedButton === "llm-json-1" ? "0 0 12px var(--button-success-bg)" : "none",
                    }}
                  >
                    {copiedButton === "llm-json-1" ? "✓ Copied" : "📋 Copy JSON"}
                  </button>
                </div>
              </div>

              {llmViewMode === "raw" ? (
                <div className="hf-code-block" style={{ color: "var(--text-on-dark-muted)", fontSize: 12 }}>
                  {JSON.stringify(llm, null, 2)}
                </div>
              ) : (
                <div className="hf-flex-col" style={{ gap: 10 }}>
                  {/* Memories */}
                  {llm.memories && llm.memories.totalCount > 0 && (
                    <div className="hf-expandable-card hf-p-12">
                      <h4 className="hf-text-sm hf-text-bold hf-mb-sm" style={{ color: "var(--badge-cyan-text)" }}>
                        💭 Memories ({llm.memories.totalCount})
                      </h4>
                      <div className="hf-flex-col hf-gap-sm">
                        {llm.memories.byCategory && Object.entries(llm.memories.byCategory).slice(0, 3).map(([category, items]: [string, any]) => (
                          <div key={category}>
                            <div className="hf-text-xxs hf-mb-xs" style={{ fontWeight: 600, color: CATEGORY_COLORS[category]?.text || "var(--text-muted)" }}>
                              {category}
                            </div>
                            <div className="hf-flex-col" style={{ gap: 2 }}>
                              {items.slice(0, 2).map((m: any, i: number) => (
                                <div
                                  key={i}
                                  className="hf-text-xs"
                                  style={{
                                    padding: 6,
                                    background: CATEGORY_COLORS[category]?.bg || "var(--surface-secondary)",
                                    borderRadius: 4,
                                  }}
                                >
                                  <span className="hf-text-500">{m.key}:</span> {m.value}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Behavior Targets */}
                  {llm.behaviorTargets && llm.behaviorTargets.totalCount > 0 && (
                    <div className="hf-expandable-card hf-p-12">
                      <h4 className="hf-text-sm hf-text-bold hf-text-success hf-mb-sm">
                        🎯 Behavior Targets ({llm.behaviorTargets.totalCount})
                      </h4>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                        {llm.behaviorTargets.all?.slice(0, 6).map((t: any, i: number) => (
                          <div
                            key={i}
                            style={{
                              padding: 8,
                              background: t.targetLevel === "HIGH" ? "var(--status-success-bg)" : t.targetLevel === "LOW" ? "var(--status-error-bg)" : "var(--surface-secondary)",
                              borderRadius: 4,
                            }}
                          >
                            <div className="hf-text-xxs hf-text-500" style={{ marginBottom: 2 }}>{t.name}</div>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: t.targetLevel === "HIGH" ? "var(--status-success-text)" : t.targetLevel === "LOW" ? "var(--status-error-text)" : "var(--text-muted)",
                              }}
                            >
                              {t.targetLevel}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Instructions */}
                  {llm.instructions && (
                    <div className="hf-banner hf-banner-warning hf-p-12">
                      <h4 className="hf-text-sm hf-text-bold hf-mb-sm" style={{ color: "var(--status-warning-text)" }}>
                        📋 AI Instructions
                      </h4>
                      <div className="hf-flex-col hf-text-xs" style={{ gap: 6, color: "var(--status-warning-text)" }}>
                        {llm.instructions.use_memories && (
                          <div><strong>Memories:</strong> {llm.instructions.use_memories}</div>
                        )}
                        {llm.instructions.personality_adaptation?.length > 0 && (
                          <div>
                            <strong>Personality Adaptation:</strong>
                            <ul style={{ margin: "2px 0 0 14px", padding: 0 }}>
                              {llm.instructions.personality_adaptation.slice(0, 3).map((tip: string, i: number) => (
                                <li key={i} style={{ marginBottom: 2 }}>{tip}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Personality Observation Tab - shows personality data observed from this call
// NOTE: This displays LEGACY PersonalityObservation model with hardcoded OCEAN fields
// TODO: Migrate PersonalityObservation to use parameterValues field for dynamic parameters
function PersonalityObservationTab({ observation }: { observation: any }) {
  if (!observation) {
    return (
      <div className="hf-text-center hf-text-placeholder hf-p-20">
        No personality observation for this call. Run the Personality analysis to generate one.
      </div>
    );
  }

  // LEGACY: PersonalityObservation has hardcoded OCEAN fields - will be migrated to parameterValues
  const traits = [
    { key: "openness", label: "Openness", color: "var(--trait-openness)", desc: "Curiosity, creativity, openness to new experiences" },
    { key: "conscientiousness", label: "Conscientiousness", color: "var(--trait-conscientiousness)", desc: "Organization, dependability, self-discipline" },
    { key: "extraversion", label: "Extraversion", color: "var(--trait-extraversion)", desc: "Sociability, assertiveness, positive emotions" },
    { key: "agreeableness", label: "Agreeableness", color: "var(--trait-agreeableness)", desc: "Cooperation, trust, helpfulness" },
    { key: "neuroticism", label: "Neuroticism", color: "var(--trait-neuroticism)", desc: "Emotional instability, anxiety, moodiness" },
  ];

  return (
    <div className="hf-flex-col hf-gap-lg">
      {/* Header with confidence and metadata */}
      <div className="hf-flex-between hf-expandable-card hf-p-12">
        <div>
          <div className="hf-text-md hf-text-bold">Personality Observation</div>
          <div style={{ fontSize: 12 }} className="hf-text-muted">
            Observed {new Date(observation.observedAt).toLocaleString()}
          </div>
        </div>
        <div className="hf-text-center">
          <div className="hf-text-xs hf-text-muted">Confidence</div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: observation.confidence >= 0.7 ? "var(--status-success-text)" : observation.confidence >= 0.4 ? "var(--status-warning-text)" : "var(--status-error-text)",
            }}
          >
            {(observation.confidence * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Trait scores */}
      <div className="hf-expandable-card hf-p-md">
        <div className="hf-text-bold hf-text-secondary hf-mb-md" style={{ fontSize: 12 }}>Big Five Traits</div>
        <div className="hf-flex-col hf-gap-md">
          {traits.map((trait) => {
            const value = observation[trait.key];
            if (value === null || value === undefined) return null;

            return (
              <div key={trait.key}>
                <div className="hf-flex-between hf-mb-xs">
                  <div>
                    <span className="hf-text-sm hf-text-500 hf-text-primary">{trait.label}</span>
                    <span className="hf-text-xs" style={{ color: "var(--text-placeholder)", marginLeft: 8 }}>{trait.desc}</span>
                  </div>
                  <span
                    className="hf-text-bold"
                    style={{
                      fontSize: 14,
                      color: value >= 0.7 ? "var(--status-success-text)" : value >= 0.3 ? "var(--status-warning-text)" : "var(--text-muted)",
                    }}
                  >
                    {(value * 100).toFixed(0)}%
                  </span>
                </div>
                {/* Progress bar */}
                <div className="hf-progress-track">
                  <div
                    className="hf-progress-fill"
                    style={{ width: `${value * 100}%`, background: trait.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Decay factor info */}
      {observation.decayFactor !== undefined && observation.decayFactor < 1 && (
        <div className="hf-flex hf-text-xs" style={{ color: "var(--text-placeholder)", gap: 6 }}>
          <span>Decay factor:</span>
          <span className="hf-text-500">{observation.decayFactor.toFixed(2)}</span>
          <span>(older observations have less weight)</span>
        </div>
      )}
    </div>
  );
}

// Prompt Prep Tab - shows inputs that went into prompt composition
function PromptPrepTab({ prompts }: { prompts: any[] }) {
  const [expandedSection, setExpandedSection] = useState<string | null>("caller");
  const [viewMode, setViewMode] = useState<"human" | "llm">("llm"); // Default to LLM-friendly view
  const [copiedButton, setCopiedButton] = useState<string | null>(null);
  const copyToClipboard = (text: string, buttonId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedButton(buttonId);
    setTimeout(() => setCopiedButton(null), 1500);
  };

  if (prompts.length === 0) {
    return (
      <div className="hf-text-center hf-text-placeholder hf-p-20">
        No prompt composition data available. Run the Prompt pipeline step to generate one.
      </div>
    );
  }

  // Get the most recent prompt's inputs
  const latestPrompt = prompts[0];
  const inputs = latestPrompt?.inputs || {};
  const llmPrompt = latestPrompt?.llmPrompt;

  // Parse callerContext to extract sections
  const callerContext = inputs.callerContext || "";
  const sections: Record<string, string[]> = {};
  let currentSection = "";

  for (const line of callerContext.split("\n")) {
    if (line.startsWith("## ")) {
      currentSection = line.replace("## ", "").trim();
      sections[currentSection] = [];
    } else if (line.startsWith("### ")) {
      currentSection = line.replace("### ", "").trim();
      sections[currentSection] = [];
    } else if (currentSection && line.trim()) {
      sections[currentSection].push(line.trim());
    }
  }

  const sectionStyles = {
    header: {
      padding: "10px 12px",
      cursor: "pointer",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottom: "1px solid var(--border-default)",
      background: "var(--background)",
    },
    content: {
      padding: 12,
      fontSize: 13,
      lineHeight: 1.6,
    },
  };

  return (
    <div className="hf-flex-col hf-gap-md">
      {/* Format Toggle */}
      <div className="hf-flex-between hf-expandable-card" style={{ padding: "8px 12px" }}>
        <div style={{ fontSize: 12 }} className="hf-text-muted">Prompt Format:</div>
        <div style={{ display: "flex", gap: 4, background: "var(--surface-secondary)", borderRadius: 6, padding: 2 }}>
          <button
            onClick={() => setViewMode("human")}
            style={{
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 500,
              background: viewMode === "human" ? "var(--surface-primary)" : "transparent",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              color: viewMode === "human" ? "var(--button-primary-bg)" : "var(--text-muted)",
              boxShadow: viewMode === "human" ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
            }}
          >
            Human-Readable
          </button>
          <button
            onClick={() => setViewMode("llm")}
            style={{
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 500,
              background: viewMode === "llm" ? "var(--surface-primary)" : "transparent",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              color: viewMode === "llm" ? "var(--status-success-text)" : "var(--text-muted)",
              boxShadow: viewMode === "llm" ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
            }}
          >
            LLM-Friendly (JSON)
          </button>
        </div>
      </div>

      {viewMode === "llm" ? (
        // LLM-Friendly JSON View
        <div className="hf-flex-col hf-gap-md">
          {llmPrompt ? (
            <>
              {/* Instructions Summary */}
              {llmPrompt.instructions && (
                <div className="hf-banner hf-banner-success hf-p-12">
                  <div className="hf-text-xs hf-text-bold hf-text-success hf-category-label hf-mb-sm">
                    AI Instructions
                  </div>
                  <div style={{ fontSize: 12 }} className="hf-text-success">
                    <div style={{ marginBottom: 6 }}><strong>Memories:</strong> {llmPrompt.instructions.use_memories}</div>
                    <div style={{ marginBottom: 6 }}><strong>Preferences:</strong> {llmPrompt.instructions.use_preferences}</div>
                    <div style={{ marginBottom: 6 }}><strong>Topics:</strong> {llmPrompt.instructions.use_topics}</div>
                    {llmPrompt.instructions.personality_adaptation?.length > 0 && (
                      <div>
                        <strong>Personality:</strong>
                        <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                          {llmPrompt.instructions.personality_adaptation.map((item: string, i: number) => (
                            <li key={i} style={{ marginBottom: 2 }}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Caller Data */}
              <div className="hf-expandable-card">
                <div
                  onClick={() => setExpandedSection(expandedSection === "llm-caller" ? null : "llm-caller")}
                  style={sectionStyles.header as any}
                >
                  <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>Caller Data</span>
                  <span className="hf-text-muted">{expandedSection === "llm-caller" ? "−" : "+"}</span>
                </div>
                {expandedSection === "llm-caller" && (
                  <div style={sectionStyles.content}>
                    <pre className="hf-text-xs hf-text-secondary hf-pre-wrap">
                      {JSON.stringify(llmPrompt.caller, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Personality */}
              {llmPrompt.personality && (
                <div className="hf-expandable-card">
                  <div
                    onClick={() => setExpandedSection(expandedSection === "llm-personality" ? null : "llm-personality")}
                    style={sectionStyles.header as any}
                  >
                    <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>Personality Profile</span>
                    <span className="hf-text-muted">{expandedSection === "llm-personality" ? "−" : "+"}</span>
                  </div>
                  {expandedSection === "llm-personality" && (
                    <div style={sectionStyles.content}>
                      <pre className="hf-text-xs hf-text-secondary hf-pre-wrap">
                        {JSON.stringify(llmPrompt.personality, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Memories */}
              <div className="hf-expandable-card">
                <div
                  onClick={() => setExpandedSection(expandedSection === "llm-memories" ? null : "llm-memories")}
                  style={sectionStyles.header as any}
                >
                  <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Memories ({llmPrompt.memories?.totalCount || 0})
                  </span>
                  <span className="hf-text-muted">{expandedSection === "llm-memories" ? "−" : "+"}</span>
                </div>
                {expandedSection === "llm-memories" && (
                  <div style={sectionStyles.content}>
                    <pre className="hf-text-xs hf-text-secondary hf-pre-wrap">
                      {JSON.stringify(llmPrompt.memories, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Behavior Targets */}
              <div className="hf-expandable-card">
                <div
                  onClick={() => setExpandedSection(expandedSection === "llm-targets" ? null : "llm-targets")}
                  style={sectionStyles.header as any}
                >
                  <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Behavior Targets ({llmPrompt.behaviorTargets?.totalCount || 0})
                  </span>
                  <span className="hf-text-muted">{expandedSection === "llm-targets" ? "−" : "+"}</span>
                </div>
                {expandedSection === "llm-targets" && (
                  <div style={sectionStyles.content}>
                    <pre className="hf-text-xs hf-text-secondary hf-pre-wrap">
                      {JSON.stringify(llmPrompt.behaviorTargets, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Call History */}
              <div className="hf-expandable-card">
                <div
                  onClick={() => setExpandedSection(expandedSection === "llm-history" ? null : "llm-history")}
                  style={sectionStyles.header as any}
                >
                  <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Call History ({llmPrompt.callHistory?.totalCalls || 0})
                  </span>
                  <span className="hf-text-muted">{expandedSection === "llm-history" ? "−" : "+"}</span>
                </div>
                {expandedSection === "llm-history" && (
                  <div style={sectionStyles.content}>
                    <pre className="hf-text-xs hf-text-secondary hf-pre-wrap">
                      {JSON.stringify(llmPrompt.callHistory, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Full JSON */}
              <div className="hf-expandable-card">
                <div
                  onClick={() => setExpandedSection(expandedSection === "llm-full" ? null : "llm-full")}
                  style={sectionStyles.header as any}
                >
                  <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>Full LLM Prompt JSON</span>
                  <div className="hf-flex hf-items-center" style={{ gap: 8 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(JSON.stringify(llmPrompt, null, 2), "llm-prompt-json");
                      }}
                      style={{
                        padding: "4px 8px",
                        fontSize: 10,
                        background: "var(--button-success-bg)",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        boxShadow: copiedButton === "llm-prompt-json" ? "0 0 12px var(--button-success-bg)" : "none",
                      }}
                    >
                      {copiedButton === "llm-prompt-json" ? "✓ Copied" : "Copy JSON"}
                    </button>
                    <span className="hf-text-muted">{expandedSection === "llm-full" ? "−" : "+"}</span>
                  </div>
                </div>
                {expandedSection === "llm-full" && (
                  <div style={sectionStyles.content}>
                    <pre style={{
                      margin: 0,
                      fontSize: 10,
                      color: "var(--text-on-dark)",
                      background: "var(--surface-dark)",
                      padding: 12,
                      borderRadius: 6,
                      whiteSpace: "pre-wrap",
                      maxHeight: 500,
                      overflowY: "auto",
                    }}>
                      {JSON.stringify(llmPrompt, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="hf-empty hf-expandable-card">
              <div className="hf-text-md hf-mb-sm">No LLM-friendly prompt available</div>
              <div style={{ fontSize: 12 }}>Re-compose the prompt to generate the JSON version</div>
            </div>
          )}
        </div>
      ) : (
        // Human-Readable View (original)
        <>
          {/* Summary stats */}
          <div className="hf-flex-wrap hf-gap-lg hf-expandable-card hf-p-12">
            <div>
              <div className="hf-category-label hf-text-xxs">Memories</div>
              <div className="hf-stat-value">{inputs.memoriesCount || 0}</div>
            </div>
            <div>
              <div className="hf-category-label hf-text-xxs">Recent Calls</div>
              <div className="hf-stat-value">{inputs.recentCallsCount || 0}</div>
            </div>
            <div>
              <div className="hf-category-label hf-text-xxs">Behavior Targets</div>
              <div className="hf-stat-value">{inputs.behaviorTargetsCount || 0}</div>
            </div>
            <div>
              <div className="hf-category-label hf-text-xxs">Personality</div>
              <div className="hf-stat-value" style={{ color: inputs.personalityAvailable ? "var(--status-success-text)" : "var(--status-error-text)" }}>
                {inputs.personalityAvailable ? "Yes" : "No"}
              </div>
            </div>
            <div>
              <div className="hf-category-label hf-text-xxs">Spec Used</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--button-primary-bg)" }}>{inputs.specUsed || "defaults"}</div>
            </div>
          </div>

          {/* Spec Config */}
          {inputs.specConfig && (
            <div className="hf-expandable-card">
              <div
                onClick={() => setExpandedSection(expandedSection === "config" ? null : "config")}
                style={sectionStyles.header as any}
              >
                <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>Spec Configuration</span>
                <span className="hf-text-muted">{expandedSection === "config" ? "−" : "+"}</span>
              </div>
              {expandedSection === "config" && (
                <div style={sectionStyles.content}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                    {Object.entries(inputs.specConfig).map(([key, value]) => (
                      <div key={key}>
                        <div className="hf-category-label hf-text-xxs">{key}</div>
                        <div className="hf-text-sm" style={{ color: "var(--text-primary)" }}>
                          {typeof value === "object" ? JSON.stringify(value) : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Caller Context Sections */}
          {Object.entries(sections).map(([sectionName, lines]) => (
            <div key={sectionName} className="hf-expandable-card">
              <div
                onClick={() => setExpandedSection(expandedSection === sectionName ? null : sectionName)}
                style={sectionStyles.header as any}
              >
                <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>{sectionName}</span>
                <div className="hf-flex hf-gap-sm">
                  <span className="hf-text-xs" style={{ color: "var(--text-placeholder)" }}>{lines.length} items</span>
                  <span className="hf-text-muted">{expandedSection === sectionName ? "−" : "+"}</span>
                </div>
              </div>
              {expandedSection === sectionName && (
                <div style={sectionStyles.content}>
                  {lines.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {lines.map((line, i) => (
                        <li key={i} className="hf-text-secondary hf-mb-xs">
                          {line.replace(/^- /, "")}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="hf-text-italic" style={{ color: "var(--text-placeholder)" }}>No data</div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Raw Context (collapsed by default) */}
          <div className="hf-expandable-card">
            <div
              onClick={() => setExpandedSection(expandedSection === "raw" ? null : "raw")}
              style={sectionStyles.header as any}
            >
              <span className="hf-text-bold" style={{ fontSize: 12, color: "var(--text-secondary)" }}>Raw Context</span>
              <span className="hf-text-muted">{expandedSection === "raw" ? "−" : "+"}</span>
            </div>
            {expandedSection === "raw" && (
              <div style={sectionStyles.content}>
                <pre style={{
                  background: "var(--surface-dark)",
                  color: "var(--text-on-dark)",
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 11,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  maxHeight: 400,
                  overflowY: "auto",
                  margin: 0,
                }}>
                  {callerContext || "No caller context available"}
                </pre>
              </div>
            )}
          </div>
        </>
      )}

      {/* Timestamp */}
      <div className="hf-text-xs" style={{ color: "var(--text-placeholder)", textAlign: "right" }}>
        Composed: {latestPrompt.composedAt ? new Date(latestPrompt.composedAt).toLocaleString() : "Unknown"}
      </div>
    </div>
  );
}

// Shared Two-Column Targets Display Component
export function TwoColumnTargetsDisplay({
  callerTargets,
  behaviorTargets,
  measurements = [],
  historyByParameter = {},
}: {
  callerTargets: any[];
  behaviorTargets: any[];
  measurements?: any[];
  historyByParameter?: Record<string, number[]>;
}) {
  const { isAdvanced } = useViewMode();
  const [expandedTarget, setExpandedTarget] = useState<string | null>(null);

  // Create measurement lookup
  const measurementMap = new Map(measurements.map((m: any) => [m.parameterId, m.actualValue]));

  // RHS filter counts
  const adjustedCount = behaviorTargets.filter(
    (t: any) => t.effectiveScope === "CALLER" || t.effectiveScope === "SEGMENT"
  ).length;
  const baseCount = behaviorTargets.filter(
    (t: any) => t.effectiveScope === "SYSTEM" || t.effectiveScope === "PLAYBOOK"
  ).length;

  // Smart default: show "adjusted" if any exist, otherwise "all"
  const [rhsFilter, setRhsFilter] = useState<"adjusted" | "base" | "all">(
    adjustedCount > 0 ? "adjusted" : "all"
  );

  // Filter RHS targets
  const filteredBehaviorTargets = behaviorTargets.filter((t: any) => {
    if (rhsFilter === "adjusted") return t.effectiveScope === "CALLER" || t.effectiveScope === "SEGMENT";
    if (rhsFilter === "base") return t.effectiveScope === "SYSTEM" || t.effectiveScope === "PLAYBOOK";
    return true;
  });

  // TODO: SEGMENT support - schema exists but UI not yet built
  // When implementing segments, we'll need:
  // 1. /x/segments page - CRUD for segments (name, description, parent hierarchy)
  // 2. API routes: /api/segments (list, create), /api/segments/[id] (get, update, delete)
  // 3. Caller assignment UI - dropdown on caller page to assign callerIdentity.segmentId
  // 4. Segment targets UI - set BehaviorTarget with scope=SEGMENT and segmentId
  // 5. Re-enable SEGMENT in scopeColors and getScopeColor below
  // Schema ready: Segment model, BehaviorTarget.segmentId, CallerIdentity.segmentId
  const scopeColors: Record<string, { bg: string; text: string }> = {
    SYSTEM: { bg: "var(--surface-secondary)", text: "var(--text-muted)" },
    PLAYBOOK: { bg: "var(--status-info-bg)", text: "var(--button-primary-bg)" },
    // SEGMENT: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)" }, // Not yet implemented
    CALLER: { bg: "var(--status-success-bg)", text: "var(--status-success-text)" },
  };

  // Group targets by domainGroup
  const groupTargets = (targets: any[]) => {
    const grouped: Record<string, any[]> = {};
    for (const t of targets) {
      const group = t.parameter?.domainGroup || "Other";
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(t);
    }
    return grouped;
  };

  const groupedCallerTargets = groupTargets(callerTargets);
  const groupedBehaviorTargets = groupTargets(filteredBehaviorTargets);

  const renderTargetCard = (target: any, prefix: string) => {
    const isExpanded = expandedTarget === `${prefix}-${target.parameterId}`;
    const actual = measurementMap.get(target.parameterId);
    const history = historyByParameter[target.parameterId] || [];
    const targetValue = target.targetValue;
    const delta = actual !== undefined ? actual - targetValue : null;

    // Extract the SYSTEM (base) layer value so the slider can show where the default was
    const systemLayer = target.layers?.find((l: any) => l.scope === "SYSTEM");
    const baseValue = systemLayer?.value;

    // Map scope to slider colors (SEGMENT not yet implemented - see TODO above)
    const getScopeColor = (scope: string) => {
      const colorMap: Record<string, { primary: string; glow: string }> = {
        SYSTEM: { primary: "var(--text-placeholder)", glow: "var(--text-muted)" },
        PLAYBOOK: { primary: "var(--badge-indigo-text)", glow: "var(--button-primary-bg)" },
        // SEGMENT: { primary: "var(--status-warning-border)", glow: "var(--status-warning-text)" },
        CALLER: { primary: "var(--status-success-text)", glow: "var(--status-success-text)" },
      };
      return colorMap[scope] || { primary: "var(--text-placeholder)", glow: "var(--text-muted)" };
    };

    const sliderColor = getScopeColor(target.effectiveScope);
    const scopeColor = scopeColors[target.effectiveScope]?.text || "var(--text-muted)";

    // Build tooltip text
    const historyInfo = history.length >= 2
      ? `\n\nHistory: ${history.length} calls\nRange: ${(Math.min(...history) * 100).toFixed(0)}% - ${(Math.max(...history) * 100).toFixed(0)}%`
      : "";
    const baseInfo = baseValue !== undefined && Math.abs(baseValue - targetValue) > 0.01
      ? `\nBase (system): ${(baseValue * 100).toFixed(0)}% (dashed line)`
      : "";
    const tooltipText = actual !== undefined
      ? `${target.parameter?.name || target.parameterId}\n\nTarget: ${(targetValue * 100).toFixed(0)}% (left bar)\nActual: ${(actual * 100).toFixed(0)}% (right bar)\nDelta: ${delta! >= 0 ? "+" : ""}${(delta! * 100).toFixed(0)}%${baseInfo}${historyInfo}\n\n${target.parameter?.definition || ""}\n\nClick to view layer cascade and interpretation`
      : `${target.parameter?.name || target.parameterId}\n\nTarget: ${(targetValue * 100).toFixed(0)}%${baseInfo}${historyInfo}\n\n${target.parameter?.definition || ""}\n\nClick to view layer cascade and interpretation`;

    return (
      <div
        key={`${prefix}-${target.parameterId}`}
        className="hf-flex-col hf-items-center"
        style={{ position: "relative" }}
      >
        {/* Use shared VerticalSlider component */}
        <VerticalSlider
          value={targetValue}
          secondaryValue={actual}
          baseValue={baseValue}
          color={sliderColor}
          onClick={() => setExpandedTarget(isExpanded ? null : `${prefix}-${target.parameterId}`)}
          isActive={isExpanded}
          tooltip={tooltipText}
          width={56}
          height={140}
          showGauge={false}
          historyPoints={history}
        />

        {/* Label */}
        <div
          style={{
            marginTop: 8,
            fontSize: 9,
            fontWeight: 500,
            color: isExpanded ? scopeColor : "var(--text-muted)",
            textAlign: "center",
            maxWidth: 70,
            lineHeight: 1.2,
            textTransform: "uppercase",
            letterSpacing: "0.3px",
            cursor: "pointer",
          }}
          onClick={() => setExpandedTarget(isExpanded ? null : `${prefix}-${target.parameterId}`)}
        >
          {target.parameter?.name?.replace("BEH-", "").replace(/-/g, " ") || target.parameterId}
        </div>

        {/* Scope indicator */}
        <div
          title={
            target.effectiveScope === "SYSTEM"
              ? "SYSTEM: Default value from system configuration"
              : target.effectiveScope === "PLAYBOOK"
              ? "PLAYBOOK: Value set by the playbook for this domain"
              : target.effectiveScope === "CALLER"
              ? "CALLER: Personalized value adjusted for this individual caller"
              // SEGMENT not yet implemented - see TODO at top of TwoColumnTargetsDisplay
              : "Effective scope for this target value"
          }
          style={{
            marginTop: 4,
            fontSize: 8,
            padding: "1px 4px",
            borderRadius: 3,
            background: scopeColors[target.effectiveScope]?.bg || "var(--surface-secondary)",
            color: scopeColors[target.effectiveScope]?.text || "var(--text-muted)",
            fontWeight: 500,
            cursor: "help",
          }}
        >
          {target.effectiveScope}
        </div>

        {/* Expanded: show layer cascade below (advanced only) */}
        {isAdvanced && isExpanded && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              marginTop: 8,
              background: "var(--surface-primary)",
              border: `2px solid ${scopeColor}`,
              borderRadius: 8,
              padding: 12,
              zIndex: 10,
              minWidth: 280,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
          >
            <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-sm">
              Layer Cascade
            </div>
            <div className="hf-flex-col" style={{ gap: 6 }}>
              {target.layers?.map((layer: any, idx: number) => (
                <div
                  key={idx}
                  className="hf-flex hf-gap-sm"
                  style={{
                    padding: 6,
                    background: "var(--background)",
                    borderRadius: 4,
                    border: "1px solid var(--border-default)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      padding: "2px 6px",
                      borderRadius: 3,
                      background: scopeColors[layer.scope]?.bg || "var(--surface-secondary)",
                      color: scopeColors[layer.scope]?.text || "var(--text-muted)",
                      fontWeight: 500,
                      minWidth: 60,
                      textAlign: "center",
                    }}
                  >
                    {layer.scope}
                  </span>
                  <span className="hf-text-sm hf-text-bold">
                    {(layer.value * 100).toFixed(0)}%
                  </span>
                  <span className="hf-text-xxs" style={{ color: "var(--text-placeholder)" }}>
                    ({layer.source})
                  </span>
                  {idx === target.layers?.length - 1 && (
                    <span style={{ fontSize: 9, color: "var(--status-success-text)", fontWeight: 500 }}>
                      ✓
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Interpretation hints */}
            {(target.parameter?.interpretationHigh || target.parameter?.interpretationLow) && (
              <div className="hf-mt-sm hf-text-xxs" style={{ borderTop: "1px solid var(--border-default)", paddingTop: 8 }}>
                <div className="hf-text-muted hf-mb-xs hf-text-500">Interpretation:</div>
                {target.parameter?.interpretationHigh && (
                  <div className="hf-mb-xs">
                    <span className="hf-text-success hf-text-500">High:</span>{" "}
                    <span className="hf-text-muted">{target.parameter.interpretationHigh}</span>
                  </div>
                )}
                {target.parameter?.interpretationLow && (
                  <div>
                    <span className="hf-text-error hf-text-500">Low:</span>{" "}
                    <span className="hf-text-muted">{target.parameter.interpretationLow}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderColumn = (targets: Record<string, any[]>, prefix: string, emptyMessage: string) => {
    if (Object.keys(targets).length === 0) {
      return (
        <div className="hf-text-center hf-text-placeholder hf-p-20" style={{ fontSize: 12 }}>
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="hf-flex-wrap hf-items-start" style={{ gap: 20, width: "100%" }}>
        {Object.entries(targets).map(([group, groupTargets]) => (
          <div
            key={`${prefix}-${group}`}
            style={{
              flex: "1 1 auto",
              minWidth: "fit-content",
              maxWidth: "100%",
              background: "var(--surface-secondary)",
              borderRadius: 12,
              padding: "12px 16px 16px",
              border: "1px solid var(--border-default)",
            }}
          >
            <div
              title={`${group} parameters - ${groupTargets.length} target${groupTargets.length !== 1 ? "s" : ""}\n\nThese sliders show target values (left bar) and actual measured values (right bar) for behavior parameters in the ${group} category.\n\nClick any slider to see the layer cascade showing how SYSTEM → PLAYBOOK → CALLER targets combine.`}
              className="hf-category-label hf-mb-md hf-cursor-help"
              style={{ display: "inline-block" }}
            >
              {group} ({groupTargets.length})
            </div>
            {/* Flex layout for vertical sliders - allows wrapping within group */}
            <div className="hf-flex-wrap hf-gap-md" style={{ justifyContent: "flex-start" }}>
              {groupTargets.map((target: any) => renderTargetCard(target, prefix))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (callerTargets.length === 0 && behaviorTargets.length === 0) {
    return (
      <div className="hf-empty">
        <div style={{ fontSize: 48 }} className="hf-mb-md">🤖</div>
        <div className="hf-text-bold hf-text-secondary" style={{ fontSize: 16 }}>No behaviour configuration</div>
        <div className="hf-text-md hf-text-muted hf-mt-sm">
          Behaviour is configured via playbook. Personalized adjustments are computed by ADAPT specs after calls.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="hf-banner hf-banner-info hf-mb-md">
        <div className="hf-text-md hf-text-bold hf-mb-xs" style={{ color: "var(--status-info-text)" }}>
          🤖 Behaviour Configuration
        </div>
        <div style={{ fontSize: 12, color: "var(--status-info-text)" }}>
          Defines how the AI agent behaves in conversations with this caller
        </div>
      </div>

      {/* Legend (advanced only) */}
      {isAdvanced && (
        <div
          title="Layer Cascade Explanation\n\nTarget values follow a cascade system where later layers override earlier ones:\n\n1. SYSTEM (gray) - Default values from system configuration\n2. PLAYBOOK (blue) - Domain-specific values from the playbook\n3. CALLER (green) - Personalized adjustments for this individual\n\nExample: If SYSTEM sets warmth to 60%, PLAYBOOK raises it to 75%, and CALLER adjusts to 85%, the effective value is 85%.\n\nClick any slider to see the complete cascade for that parameter."
          className="hf-flex-wrap hf-text-xs hf-text-muted hf-gap-md hf-mb-md hf-cursor-help"
        >
          <span className="hf-text-bold">Layer cascade:</span>
          {["SYSTEM", "PLAYBOOK", "CALLER"].map((scope) => (
            <span
              key={scope}
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                background: scopeColors[scope].bg,
                color: scopeColors[scope].text,
                fontWeight: 500,
              }}
            >
              {scope}
            </span>
          ))}
          <span style={{ color: "var(--text-placeholder)" }}>(later overrides earlier)</span>
        </div>
      )}

      {/* Two-column layout - CSS Grid for clean separation */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Personalized Adjustments Column */}
        <div style={{
          minWidth: 0,
          background: "var(--surface-primary)",
          padding: 16,
          borderRadius: 12,
          border: "2px solid var(--status-success-border)",
        }}>
          <div
            title="Personalized Adjustments\n\nThese are behavior targets that have been automatically adjusted for this specific caller based on their interactions and preferences.\n\nADAPT specs analyze each call and fine-tune these parameters to optimize the AI's behavior for this individual.\n\nLeft bar: Target value\nRight bar: Most recent actual value from call analysis\n\nThese override the base playbook configuration."
            style={{
              marginBottom: 12,
              padding: "8px 12px",
              background: "var(--status-success-bg)",
              borderRadius: 6,
              cursor: "help",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--status-success-text)" }}>
              ✨ Personalized Adjustments ({callerTargets.length})
            </div>
            <div style={{ fontSize: 11, color: "var(--status-success-text)", marginTop: 2 }}>
              How behaviour adapts for this caller
            </div>
          </div>
          {renderColumn(groupedCallerTargets, "caller", "No personalized adjustments yet")}
        </div>

        {/* Effective Targets Column (with filter) */}
        <div style={{
          minWidth: 0,
          background: "var(--surface-primary)",
          padding: 16,
          borderRadius: 12,
          border: `2px solid ${rhsFilter === "adjusted" ? "var(--status-success-border)" : "var(--status-info-border)"}`,
        }}>
          {/* Header with segmented control */}
          <div style={{ marginBottom: 12 }}>
            <div
              title={
                rhsFilter === "adjusted"
                  ? "Showing targets where ADAPT specs have personalized the value for this caller (CALLER or SEGMENT scope)."
                  : rhsFilter === "base"
                  ? "Showing baseline targets from system defaults and playbook configuration (SYSTEM or PLAYBOOK scope)."
                  : "Showing all effective targets across all scope levels."
              }
              style={{
                padding: "8px 12px",
                background: rhsFilter === "adjusted" ? "var(--status-success-bg)" : "var(--badge-blue-bg)",
                borderRadius: 6,
                cursor: "help",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: rhsFilter === "adjusted" ? "var(--status-success-text)" : "var(--status-info-text)" }}>
                {rhsFilter === "adjusted" ? "✨ Personalized Adjustments" : rhsFilter === "base" ? "⚙️ Base Configuration" : "📊 All Targets"} ({filteredBehaviorTargets.length})
              </div>
              <div style={{ fontSize: 11, color: rhsFilter === "adjusted" ? "var(--status-success-text)" : "var(--status-info-text)", marginTop: 2 }}>
                {rhsFilter === "adjusted" ? "Targets adapted for this caller" : rhsFilter === "base" ? "Behaviour baseline from playbook" : "All effective cascade targets"}
              </div>
            </div>

            {/* Segmented control */}
            <div style={{
              display: "flex",
              gap: 0,
              marginTop: 8,
              borderRadius: 6,
              overflow: "hidden",
              border: "1px solid var(--border-default)",
              background: "var(--surface-secondary)",
            }}>
              {([
                { key: "adjusted" as const, label: "Adjusted", count: adjustedCount },
                { key: "base" as const, label: "Base", count: baseCount },
                { key: "all" as const, label: "All", count: behaviorTargets.length },
              ]).map((option, idx) => (
                <button
                  key={option.key}
                  onClick={() => setRhsFilter(option.key)}
                  style={{
                    flex: 1,
                    padding: "5px 8px",
                    fontSize: 11,
                    fontWeight: rhsFilter === option.key ? 600 : 400,
                    color: rhsFilter === option.key ? "var(--text-on-primary)" : "var(--text-muted)",
                    background: rhsFilter === option.key ? "var(--button-primary-bg)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderRight: idx < 2 ? "1px solid var(--border-default)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  {option.label} ({option.count})
                </button>
              ))}
            </div>
          </div>

          {/* Filtered content or empty state */}
          {filteredBehaviorTargets.length === 0 && rhsFilter === "adjusted" ? (
            <div className="hf-text-center hf-text-placeholder hf-p-20" style={{ fontSize: 12 }}>
              <div className="hf-mb-sm" style={{ fontSize: 32 }}>✨</div>
              <div className="hf-text-500 hf-mb-xs">No personalized adjustments yet</div>
              <div className="hf-text-xs">Targets will appear here as ADAPT specs run after calls</div>
            </div>
          ) : (
            renderColumn(groupedBehaviorTargets, "behavior", "No targets in this category")
          )}
        </div>
      </div>
    </div>
  );
}

// Targets Tab - uses shared TwoColumnTargetsDisplay
// Scores Tab - per-call scores (agent behavior has its own Behaviour tab via BehaviorMeasurement)
function ScoresTab({ scores }: { scores: any[] }) {
  const [expandedScore, setExpandedScore] = useState<string | null>(null);

  if (scores.length === 0) {
    return (
      <div className="hf-empty">
        <div style={{ fontSize: 48 }} className="hf-mb-md">📊</div>
        <div className="hf-text-md hf-text-500">No scores</div>
        <div className="hf-mt-sm" style={{ fontSize: 12 }}>
          Scores haven't been measured for this call yet.
        </div>
      </div>
    );
  }

  const renderScoreCard = (score: any) => {
    const isExpanded = expandedScore === score.id;
    const percentage = (score.score * 100).toFixed(0);
    const color = score.score >= 0.7 ? "var(--status-success-text)" :
                  score.score >= 0.4 ? "var(--status-warning-text)" :
                  "var(--status-error-text)";

    return (
      <div
        key={score.id}
        className="hf-stat-card"
        style={{
          cursor: (score.reasoning || (score.evidence && score.evidence.length > 0)) ? "pointer" : "default",
        }}
        onClick={() => {
          if (score.reasoning || (score.evidence && score.evidence.length > 0)) {
            setExpandedScore(isExpanded ? null : score.id);
          }
        }}
      >
        {/* Header with Score */}
        <div className="hf-flex-between">
          <span className="hf-text-sm hf-text-bold">
            {score.parameter?.name || score.parameterId}
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, color }}>
            {percentage}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="hf-progress-track">
          <div className="hf-progress-fill" style={{ width: `${percentage}%`, background: color }} />
        </div>

        {/* Definition */}
        {score.parameter?.definition && (
          <p className="hf-text-xs hf-text-muted" style={{ margin: 0, lineHeight: 1.4 }}>
            {score.parameter.definition}
          </p>
        )}

        {/* Metadata */}
        <div className="hf-flex-wrap hf-gap-sm hf-text-xxs" style={{ color: "var(--text-placeholder)" }}>
          <span>Confidence: {(score.confidence * 100).toFixed(0)}%</span>
          {score.analysisSpec && (
            <>
              <span>•</span>
              <span className="hf-micro-badge hf-text-500" style={{ background: "var(--badge-purple-bg)", color: "var(--badge-purple-text)" }}>
                {score.analysisSpec.slug || score.analysisSpec.name}
              </span>
            </>
          )}
          {(score.reasoning || (score.evidence && score.evidence.length > 0)) && (
            <>
              <span>•</span>
              <span className="hf-text-500" style={{ color: "var(--button-primary-bg)" }}>
                {isExpanded ? "▼ Hide details" : "▶ Show details"}
              </span>
            </>
          )}
        </div>

        {/* Expanded: show reasoning and evidence */}
        {isExpanded && (
          <div className="hf-mt-sm" style={{ paddingTop: 12, borderTop: "1px solid var(--border-default)" }}>
            {/* Reasoning */}
            {score.reasoning && (
              <div className="hf-mb-md">
                <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">
                  Reasoning
                </div>
                <div className="hf-text-secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {score.reasoning}
                </div>
              </div>
            )}

            {/* Evidence */}
            {score.evidence && score.evidence.length > 0 && (
              <div>
                <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">
                  Evidence ({score.evidence.length} excerpt{score.evidence.length > 1 ? "s" : ""})
                </div>
                <div className="hf-flex-col" style={{ gap: 6 }}>
                  {score.evidence.map((e: string, idx: number) => (
                    <div
                      key={idx}
                      className="hf-text-xs hf-text-secondary hf-text-italic hf-p-sm"
                      style={{
                        background: "var(--background)",
                        borderRadius: 4,
                        borderLeft: "3px solid var(--status-info-border)",
                      }}
                    >
                      "{e}"
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (scores.length === 0) {
    return (
      <div className="hf-text-center hf-text-placeholder hf-p-20">
        No scores yet. Run MEASURE to analyze this call.
      </div>
    );
  }

  return (
    <div className="hf-card-grid">
      {scores.map(renderScoreCard)}
    </div>
  );
}

// Memories Tab - enhanced with expandable source/evidence info
function MemoriesTab({ memories }: { memories: any[] }) {
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);

  if (memories.length === 0) {
    return (
      <div className="hf-text-center hf-text-placeholder hf-p-20">
        No memories extracted. Run LEARN to extract memories from this call.
      </div>
    );
  }

  const categoryColors: Record<string, { bg: string; text: string }> = {
    FACT: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)" },
    PREFERENCE: { bg: "var(--badge-yellow-bg)", text: "var(--badge-yellow-text)" },
    EVENT: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text)" },
    TOPIC: { bg: "var(--badge-purple-bg)", text: "var(--badge-purple-text)" },
    CONTEXT: { bg: "var(--surface-secondary)", text: "var(--text-secondary)" },
  };

  return (
    <div className="hf-flex-col hf-gap-sm">
      {memories.map((memory: any) => {
        const style = categoryColors[memory.category] || categoryColors.CONTEXT;
        const isExpanded = expandedMemory === memory.id;

        return (
          <div key={memory.id} className="hf-expandable-card">
            {/* Header row - clickable */}
            <button
              onClick={() => setExpandedMemory(isExpanded ? null : memory.id)}
              className="hf-btn-unstyled hf-flex hf-gap-md"
              style={{
                width: "100%",
                padding: 10,
                background: isExpanded ? "var(--background)" : "var(--surface-primary)",
              }}
            >
              <span
                className="hf-micro-pill"
                style={{
                  background: style.bg,
                  color: style.text,
                  flexShrink: 0,
                }}
              >
                {memory.category}
              </span>
              <span className="hf-text-sm hf-text-500">{memory.key}</span>
              <span className="hf-text-sm hf-text-muted hf-flex-1">= "{memory.value}"</span>
              <span className="hf-text-xxs hf-flex-shrink-0" style={{ color: "var(--text-placeholder)" }}>
                {(memory.confidence * 100).toFixed(0)}% conf
              </span>
              <span className="hf-flex-shrink-0" style={{ fontSize: 12, color: "var(--text-placeholder)" }}>
                {isExpanded ? "▼" : "▶"}
              </span>
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div
                className="hf-flex-col hf-gap-md"
                style={{
                  padding: "12px 16px",
                  background: "var(--background)",
                  borderTop: "1px solid var(--border-default)",
                }}
              >
                {/* Source spec/extractor */}
                {memory.extractedBy && (
                  <div>
                    <div className="hf-category-label hf-text-xxs hf-mb-xs">
                      EXTRACTED BY
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        padding: "6px 10px",
                        background: "var(--badge-purple-bg)",
                        color: "var(--badge-purple-text)",
                        borderRadius: 4,
                        display: "inline-block",
                      }}
                    >
                      {memory.extractedBy}
                    </div>
                  </div>
                )}

                {/* Evidence */}
                {memory.evidence && (
                  <div>
                    <div className="hf-category-label hf-text-xxs hf-mb-xs">
                      EVIDENCE
                    </div>
                    <div
                      className="hf-text-secondary hf-text-italic"
                      style={{
                        fontSize: 12,
                        background: "var(--surface-primary)",
                        padding: 10,
                        borderRadius: 4,
                        border: "1px solid var(--border-default)",
                        lineHeight: 1.5,
                      }}
                    >
                      "{memory.evidence}"
                    </div>
                  </div>
                )}

                {/* Extraction timestamp */}
                {memory.extractedAt && (
                  <div className="hf-text-xxs" style={{ color: "var(--text-placeholder)" }}>
                    Extracted: {new Date(memory.extractedAt).toLocaleString()}
                    {memory.expiresAt && (
                      <span> · Expires: {new Date(memory.expiresAt).toLocaleString()}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Call Traits Tab - shows personality observation from this specific call
function CallTraitsTab({ observation }: { observation: any }) {
  if (!observation) {
    return (
      <div className="hf-empty">
        <div style={{ fontSize: 48 }} className="hf-mb-md">🧠</div>
        <div className="hf-text-md hf-text-500">No personality observation</div>
        <div className="hf-mt-sm" style={{ fontSize: 12 }}>
          Personality traits haven't been measured for this call yet.
        </div>
      </div>
    );
  }

  // Extract trait values (Big Five)
  const traits = [
    { id: "openness", label: "Openness", value: observation.openness, desc: "Curiosity, creativity, openness to new experiences" },
    { id: "conscientiousness", label: "Conscientiousness", value: observation.conscientiousness, desc: "Organization, dependability, discipline" },
    { id: "extraversion", label: "Extraversion", value: observation.extraversion, desc: "Sociability, assertiveness, talkativeness" },
    { id: "agreeableness", label: "Agreeableness", value: observation.agreeableness, desc: "Compassion, respectfulness, trust" },
    { id: "neuroticism", label: "Neuroticism", value: observation.neuroticism, desc: "Anxiety, moodiness, emotional reactivity" },
  ].filter(t => t.value !== null);

  if (traits.length === 0) {
    return (
      <div className="hf-empty">
        <div style={{ fontSize: 48 }} className="hf-mb-md">🧠</div>
        <div className="hf-text-md hf-text-500">No trait values</div>
        <div className="hf-mt-sm" style={{ fontSize: 12 }}>
          Personality observation exists but no trait scores are available.
        </div>
      </div>
    );
  }

  return (
    <div className="hf-flex-col hf-gap-lg">
      {/* Header */}
      <div className="hf-flex-between">
        <div>
          <h3 className="hf-text-md hf-text-bold" style={{ margin: 0 }}>Personality Observation</h3>
          <p className="hf-text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Measured from this call on {new Date(observation.observedAt).toLocaleString()}
          </p>
        </div>
        {observation.confidence && (
          <div className="hf-flex" style={{ gap: 6 }}>
            <span className="hf-text-xs hf-text-muted">Confidence:</span>
            <span className="hf-text-bold" style={{ fontSize: 12 }}>
              {(observation.confidence * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Trait Cards Grid */}
      <div className="hf-card-grid">
        {traits.map((trait) => {
          const percentage = ((trait.value || 0) * 100).toFixed(0);
          const color = trait.value >= 0.7 ? "var(--status-success-text)" :
                       trait.value >= 0.3 ? "var(--status-info-text)" :
                       "var(--status-warning-text)";

          return (
            <div key={trait.id} className="hf-stat-card">
              {/* Trait Header */}
              <div className="hf-flex-between">
                <span className="hf-text-sm hf-text-bold">{trait.label}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color }}>{percentage}%</span>
              </div>

              {/* Progress Bar */}
              <div className="hf-progress-track">
                <div className="hf-progress-fill" style={{ width: `${percentage}%`, background: color }} />
              </div>

              {/* Description */}
              <p className="hf-text-xs hf-text-muted" style={{ margin: 0, lineHeight: 1.4 }}>
                {trait.desc}
              </p>
            </div>
          );
        })}
      </div>

      {/* Decay Factor Info */}
      {observation.decayFactor !== undefined && observation.decayFactor !== 1.0 && (
        <div className="hf-text-xs" style={{
          color: "var(--text-placeholder)",
          padding: 12,
          background: "var(--background)",
          borderRadius: 6,
          border: "1px solid var(--border-default)"
        }}>
          📊 Decay factor: {observation.decayFactor.toFixed(2)} (used for time-weighted aggregation)
        </div>
      )}
    </div>
  );
}

// Measurements Tab - Now uses slider visualization for consistency with Targets tab
function MeasurementsTab({ callerTargets = [], behaviorTargets = [], measurements, rewardScore }: { callerTargets?: any[]; behaviorTargets?: any[]; measurements: any[]; rewardScore: any }) {
  if (measurements.length === 0 && behaviorTargets.length === 0 && callerTargets.length === 0) {
    return (
      <div className="hf-text-center hf-text-placeholder hf-p-20">
        No behaviour data. Run BEHAVIOUR to measure behaviour.
      </div>
    );
  }

  // Format measurements for the display
  const formattedMeasurements = measurements.map((m: any) => ({
    parameterId: m.parameterId,
    actualValue: m.actualValue,
  }));

  // If we have explicit behavior targets, use them directly
  // Otherwise fall back to synthesizing from measurements
  const effectiveBehaviorTargets = behaviorTargets.length > 0
    ? behaviorTargets
    : measurements.map((m: any) => ({
        parameterId: m.parameterId,
        targetValue: m.targetValue || 0.5,
        effectiveScope: "MEASUREMENT" as any,
        parameter: m.parameter,
      }));

  return <TwoColumnTargetsDisplay callerTargets={callerTargets} behaviorTargets={effectiveBehaviorTargets} measurements={formattedMeasurements} />;
}

// Legacy card-based measurements view (kept for reference, can be removed later)
function MeasurementsTabLegacy({ measurements, rewardScore }: { measurements: any[]; rewardScore: any }) {
  const [expandedMeasurement, setExpandedMeasurement] = useState<string | null>(null);

  if (measurements.length === 0) {
    return (
      <div className="hf-text-center hf-text-placeholder hf-p-20">
        No behaviour measurements. Run BEHAVIOUR to measure behaviour.
      </div>
    );
  }

  // Parse parameter diffs from reward score
  const diffs = (rewardScore?.parameterDiffs || []) as any[];
  const diffMap = new Map(diffs.map((d: any) => [d.parameterId, d]));

  return (
    <div className="hf-flex-col hf-gap-md">
      {measurements.map((m: any) => {
        const diff = diffMap.get(m.parameterId);
        const isExpanded = expandedMeasurement === m.id;

        return (
          <div key={m.id} className="hf-expandable-card">
            {/* Row header - clickable */}
            <button
              onClick={() => setExpandedMeasurement(isExpanded ? null : m.id)}
              className="hf-btn-unstyled hf-flex hf-gap-lg"
              style={{
                width: "100%",
                padding: 12,
                background: isExpanded ? "var(--background)" : "var(--surface-primary)",
              }}
            >
              {/* Actual value */}
              <div className="hf-text-center" style={{ width: 60 }}>
                <div className="hf-text-secondary" style={{ fontSize: 20, fontWeight: 700 }}>
                  {(m.actualValue * 100).toFixed(0)}
                </div>
                <div className="hf-text-xxs" style={{ color: "var(--text-placeholder)" }}>actual</div>
              </div>

              {/* Target comparison if available */}
              {diff && (
                <div className="hf-text-center" style={{ width: 60 }}>
                  <div className="hf-text-muted hf-text-500" style={{ fontSize: 14 }}>
                    {(diff.target * 100).toFixed(0)}
                  </div>
                  <div className="hf-text-xxs" style={{ color: "var(--text-placeholder)" }}>target</div>
                </div>
              )}

              {/* Delta indicator */}
              {diff && (
                <div
                  className="hf-text-xs hf-text-bold"
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: diff.diff < 0.1 ? "var(--status-success-bg)" : diff.diff < 0.3 ? "var(--status-warning-bg)" : "var(--status-error-bg)",
                    color: diff.diff < 0.1 ? "var(--status-success-text)" : diff.diff < 0.3 ? "var(--status-warning-text)" : "var(--status-error-text)",
                  }}
                >
                  {diff.diff < 0.1 ? "On Target" : diff.diff < 0.3 ? "Close" : "Off Target"}
                </div>
              )}

              {/* Parameter name */}
              <div className="hf-flex-1">
                <div className="hf-text-sm hf-text-bold">
                  {m.parameter?.name || m.parameterId}
                </div>
                {m.evidence && m.evidence.length > 0 && (
                  <div className="hf-text-xs hf-text-muted hf-mt-sm">
                    {m.evidence[0]}
                  </div>
                )}
              </div>

              {/* Expand indicator */}
              <span style={{ color: "var(--text-placeholder)", fontSize: 12 }}>{isExpanded ? "▼" : "▶"}</span>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--border-default)", background: "var(--background)" }}>
                {/* Parameter definition */}
                {m.parameter?.definition && (
                  <div className="hf-mb-md">
                    <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">Definition</div>
                    <div className="hf-text-secondary" style={{ fontSize: 12 }}>{m.parameter.definition}</div>
                  </div>
                )}

                {/* All evidence items */}
                {m.evidence && m.evidence.length > 0 && (
                  <div className="hf-mb-md">
                    <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">Evidence</div>
                    {m.evidence.map((e: string, i: number) => (
                      <div key={i} className="hf-text-secondary" style={{ fontSize: 12, padding: "4px 0", borderLeft: "2px solid var(--border-default)", paddingLeft: 8, marginBottom: 4 }}>
                        {e}
                      </div>
                    ))}
                  </div>
                )}

                {/* Target comparison details */}
                {diff && (
                  <div className="hf-mb-md">
                    <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">Target Comparison</div>
                    <div className="hf-flex hf-gap-xl" style={{ fontSize: 12 }}>
                      <div>
                        <span className="hf-text-muted">Actual: </span>
                        <span className="hf-text-bold hf-text-secondary">{(diff.actual * 100).toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className="hf-text-muted">Target: </span>
                        <span className="hf-text-bold hf-text-secondary">{(diff.target * 100).toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className="hf-text-muted">Difference: </span>
                        <span className="hf-text-bold" style={{
                          color: diff.diff < 0.1 ? "var(--status-success-text)" : diff.diff < 0.3 ? "var(--status-warning-text)" : "var(--status-error-text)"
                        }}>
                          {(diff.diff * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Confidence */}
                <div className="hf-mb-md">
                  <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">Confidence</div>
                  <div className="hf-flex hf-gap-sm">
                    <div className="hf-flex-1" style={{ maxWidth: 200, height: 6, background: "var(--border-default)", borderRadius: 3, overflow: "hidden" }}>
                      <div
                        className="hf-progress-fill"
                        style={{
                          width: `${(m.confidence || 0.75) * 100}%`,
                          background: m.confidence >= 0.8 ? "var(--status-success-text)" : m.confidence >= 0.6 ? "var(--status-warning-text)" : "var(--status-error-text)",
                        }}
                      />
                    </div>
                    <span className="hf-text-bold hf-text-secondary" style={{ fontSize: 12 }}>
                      {((m.confidence || 0.75) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* Metadata */}
                <div className="hf-flex hf-gap-lg hf-text-xxs" style={{ color: "var(--text-placeholder)" }}>
                  <span>Parameter ID: {m.parameterId}</span>
                  <span>Measurement ID: {m.id?.slice(0, 8)}...</span>
                  {m.createdAt && <span>Measured: {new Date(m.createdAt).toLocaleString()}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Transcript Tab
function TranscriptTab({ transcript }: { transcript: string }) {
  return (
    <pre
      className="hf-text-secondary"
      style={{
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        fontFamily: "ui-monospace, monospace",
        maxHeight: 400,
        overflow: "auto",
        background: "var(--surface-primary)",
        padding: 12,
        borderRadius: 6,
        border: "1px solid var(--border-default)",
      }}
    >
      {transcript}
    </pre>
  );
}

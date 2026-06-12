"use client";

import "./run-inspector.css";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  ExpandMore,
  ExpandLess,
  Refresh,
  Warning,
  Psychology,
} from "@mui/icons-material";
import {
  StepIcon,
  StatusBadge,
  ConfigBadge,
  SectionIcon,
  SPIN_KEYFRAMES,
} from "@/lib/pipeline/icons";
import { FancySelect } from "@/components/shared/FancySelect";

// =============================================================================
// AI CONFIG TYPES
// =============================================================================

interface AIConfigInfo {
  callPoint: string;
  provider: string;
  model: string;
  transcriptLimit: number | null;
  defaultTranscriptLimit: number | null;
}

// Map step operations to AI config call points
const STEP_TO_CALLPOINT: Record<string, string> = {
  EXTRACT: "pipeline.measure",
  MEASURE: "pipeline.measure",
  LEARN: "pipeline.learn",
  SCORE_AGENT: "pipeline.score_agent",
  ADAPT: "pipeline.adapt",
};

// Steps that use AI
const AI_POWERED_STEPS = new Set(Object.keys(STEP_TO_CALLPOINT));

// =============================================================================
// TYPES
// =============================================================================

interface PipelineStep {
  id: string;
  operation: string;
  label: string | null;
  status: string;
  durationMs: number | null;
  specSlug: string | null;
  outputCounts: Record<string, number> | null;
  error: string | null;
  sectionsActivated: string[];
  sectionsSkipped: string[];
  inputs?: Record<string, unknown> | null;
  outputs?: Record<string, unknown> | null;
  sectionTimings?: Record<string, number> | null;
}

interface PipelineRun {
  id: string;
  phase: "LEARN" | "ADAPT";
  callerId: string | null;
  callId: string | null;
  triggeredBy: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  stepsTotal: number;
  stepsSucceeded: number;
  stepsFailed: number;
  stepsSkipped: number;
  errorSummary: string | null;
  steps: PipelineStep[];
  // Extra metadata from ComposedPrompt
  _caller?: { id: string; name: string | null };
  _model?: string | null;
  _status?: string;
}

// =============================================================================
// RECENT CALLERS (derived from pipeline runs)
// =============================================================================

interface RecentCaller {
  id: string;
  name: string | null;
  lastRunAt: string;
  totalRuns: number;
  lastStatus: string;
  lastModel: string | null;
  lastDurationMs: number | null;
}

type SortMode = "recent" | "most-runs" | "name";

function groupByCallerId(runs: PipelineRun[]): RecentCaller[] {
  const map = new Map<string, RecentCaller>();
  for (const run of runs) {
    const cid = run.callerId || run._caller?.id;
    if (!cid) continue;
    const existing = map.get(cid);
    if (existing) {
      existing.totalRuns++;
      // Keep most recent
      if (run.startedAt > existing.lastRunAt) {
        existing.lastRunAt = run.startedAt;
        existing.lastStatus = run.status;
        existing.lastModel = run._model || null;
        existing.lastDurationMs = run.durationMs;
      }
    } else {
      map.set(cid, {
        id: cid,
        name: run._caller?.name || null,
        lastRunAt: run.startedAt,
        totalRuns: 1,
        lastStatus: run.status,
        lastModel: run._model || null,
        lastDurationMs: run.durationMs,
      });
    }
  }
  return Array.from(map.values());
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function sortCallers(callers: RecentCaller[], mode: SortMode): RecentCaller[] {
  const sorted = [...callers];
  switch (mode) {
    case "recent":
      sorted.sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt));
      break;
    case "most-runs":
      sorted.sort((a, b) => b.totalRuns - a.totalRuns);
      break;
    case "name":
      sorted.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      break;
  }
  return sorted;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function RunInspector() {
  // Recent callers state
  const [allRecentRuns, setAllRecentRuns] = useState<PipelineRun[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [callerSearch, setCallerSearch] = useState("");

  // Selected caller state
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [aiConfigs, setAiConfigs] = useState<Record<string, AIConfigInfo>>({});

  // Derive recent callers list
  const recentCallers = useMemo(() => {
    const grouped = groupByCallerId(allRecentRuns);
    let filtered = grouped;
    if (callerSearch.trim()) {
      const q = callerSearch.toLowerCase();
      filtered = grouped.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q),
      );
    }
    return sortCallers(filtered, sortMode);
  }, [allRecentRuns, sortMode, callerSearch]);

  // Fetch recent runs + AI configs on mount
  useEffect(() => {
    setLoadingRecent(true);
    fetch("/api/pipeline/runs?limit=200")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.runs) {
          setAllRecentRuns(data.runs);
        }
      })
      .catch((e) => console.warn("[RunInspector] Failed to load recent runs:", e))
      .finally(() => setLoadingRecent(false));
  }, []);

  useEffect(() => {
    async function fetchAIConfigs() {
      try {
        const res = await fetch("/api/ai-config");
        const data = await res.json();
        if (data.ok && data.configs) {
          const configMap: Record<string, AIConfigInfo> = {};
          for (const config of data.configs) {
            configMap[config.callPoint] = {
              callPoint: config.callPoint,
              provider: config.provider,
              model: config.model,
              transcriptLimit: config.transcriptLimit,
              defaultTranscriptLimit: config.defaultTranscriptLimit,
            };
          }
          setAiConfigs(configMap);
        }
      } catch (err) {
        console.error("Failed to fetch AI configs:", err);
      }
    }
    fetchAIConfigs();
  }, []);

  // Fetch runs when caller changes
  useEffect(() => {
    if (!selectedCallerId) {
      setRuns([]);
      setSelectedRunId(null);
      return;
    }

    async function fetchRuns() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/pipeline/runs?callerId=${selectedCallerId}&limit=50`
        );
        const data = await res.json();
        if (data.ok && data.runs) {
          setRuns(data.runs);
          if (data.runs.length > 0) {
            setSelectedRunId(data.runs[0].id);
          } else {
            setSelectedRunId(null);
          }
        }
      } catch (err) {
        console.error("Failed to fetch runs:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchRuns();
  }, [selectedCallerId]);

  const selectedRun = runs.find((r) => r.id === selectedRunId);

  // Expand all steps by default when a run is selected
  useEffect(() => {
    if (selectedRun) {
      setExpandedSteps(new Set(selectedRun.steps.map((s) => s.id)));
    }
  }, [selectedRunId]);

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const refreshRuns = async () => {
    if (!selectedCallerId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/pipeline/runs?callerId=${selectedCallerId}&limit=50`
      );
      const data = await res.json();
      if (data.ok && data.runs) {
        setRuns(data.runs);
      }
    } catch (err) {
      console.error("Failed to refresh runs:", err);
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async () => {
    setLoadingRecent(true);
    try {
      const res = await fetch("/api/pipeline/runs?limit=200");
      const data = await res.json();
      if (data.ok && data.runs) setAllRecentRuns(data.runs);
    } catch {}
    finally { setLoadingRecent(false); }
    if (selectedCallerId) refreshRuns();
  };

  return (
    <div className="ri-layout">
      {/* Add spin keyframes + highlight animation */}
      {/* SECURITY: inline <style> body is a static CSS template literal built from
          local module constants (SPIN_KEYFRAMES etc.) — no user input flows in.
          Audit HF-O/HF-P, "what other checks" sweep. */}
      <style dangerouslySetInnerHTML={{ __html: `
        ${SPIN_KEYFRAMES}
        @keyframes highlightPulse {
          0% { background-color: rgba(139, 92, 246, 0.3); }
          100% { background-color: transparent; }
        }
        .highlight-row {
          animation: highlightPulse 1.5s ease-out;
        }
      ` }} />

      {/* ======== LEFT PANEL: Recent Callers ======== */}
      <div className="ri-sidebar">
        {/* Header + search */}
        <div className="ri-sidebar-header">
          <div className="hf-flex-between hf-mb-sm">
            <span className="ri-sidebar-title">
              Recent Callers
            </span>
            <button
              onClick={refreshAll}
              className="ri-refresh-btn"
              title="Refresh"
            >
              <Refresh style={{ fontSize: 14 }} />
            </button>
          </div>

          {/* Search */}
          <div className="ri-search-box">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={callerSearch}
              onChange={(e) => setCallerSearch(e.target.value)}
              placeholder="Search callers..."
              className="ri-search-input"
            />
            {callerSearch && (
              <button
                onClick={() => setCallerSearch("")}
                className="ri-search-clear"
              >
                &times;
              </button>
            )}
          </div>

          {/* Sort */}
          <div className="hf-flex hf-gap-xs">
            {([
              { id: "recent" as const, label: "Recent" },
              { id: "most-runs" as const, label: "Most Runs" },
              { id: "name" as const, label: "Name" },
            ]).map((s) => (
              <button
                key={s.id}
                onClick={() => setSortMode(s.id)}
                className={`ri-sort-btn ${sortMode === s.id ? "ri-sort-btn-active" : "ri-sort-btn-inactive"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Caller list */}
        <div className="ri-caller-list">
          {loadingRecent ? (
            <div className="ri-caller-empty">
              Loading recent activity...
            </div>
          ) : recentCallers.length === 0 ? (
            <div className="ri-caller-empty">
              {callerSearch ? "No callers match" : "No pipeline runs found"}
            </div>
          ) : (
            <div className="hf-flex-col" style={{ gap: 3 }}>
              {recentCallers.map((caller) => {
                const isSelected = caller.id === selectedCallerId;
                return (
                  <button
                    key={caller.id}
                    onClick={() => setSelectedCallerId(caller.id)}
                    className={`ri-caller-item ${isSelected ? "ri-caller-item-selected" : "ri-caller-item-default"}`}
                  >
                    {/* Status dot */}
                    <span
                      className={`ri-status-dot ${caller.lastStatus === "SUCCESS" ? "ri-status-dot-success" : "ri-status-dot-error"}`}
                    />

                    {/* Name + metadata */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ri-caller-name">
                        {caller.name || caller.id.slice(0, 8)}
                      </div>
                      <div className="ri-caller-meta">
                        {caller.totalRuns} run{caller.totalRuns !== 1 ? "s" : ""}
                        {caller.lastDurationMs != null && ` \u00B7 ${caller.lastDurationMs}ms`}
                      </div>
                    </div>

                    {/* Relative time */}
                    <span className="ri-caller-time">
                      {formatRelativeTime(caller.lastRunAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer count */}
        <div className="ri-sidebar-footer">
          {recentCallers.length} caller{recentCallers.length !== 1 ? "s" : ""} with activity
        </div>
      </div>

      {/* ======== RIGHT PANEL: Run Detail ======== */}
      <div className="ri-main">
        {/* Run picker bar */}
        {selectedCallerId && (
          <div className="ri-run-picker">
            <div className="ri-run-picker-select">
              <FancySelect
                value={selectedRunId || ""}
                onChange={(v) => setSelectedRunId(v || null)}
                disabled={runs.length === 0}
                placeholder={loading ? "Loading..." : runs.length === 0 ? "No runs found" : "Select a run..."}
                searchable={runs.length > 5}
                options={runs.map((r) => ({
                  value: r.id,
                  label: `${new Date(r.startedAt).toLocaleString()}`,
                  subtitle: `${r.triggeredBy || "manual"} (${r.durationMs}ms)`,
                }))}
              />
            </div>
            <button
              onClick={refreshRuns}
              className="ri-run-refresh-btn"
              title="Refresh runs"
            >
              <Refresh style={{ fontSize: 16 }} />
            </button>
            <span className="ri-run-count">
              {runs.length} run{runs.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Content area */}
        <div className="ri-content">
          {/* Empty State: no caller selected */}
          {!selectedCallerId && (
            <div className="ri-empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="ri-empty-icon">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <div className="ri-empty-title">
                Select a caller to inspect traces
              </div>
              <div className="ri-empty-desc">
                Callers are sorted by most recent pipeline activity
              </div>
            </div>
          )}

          {/* Empty State: caller selected but no run */}
          {selectedCallerId && !selectedRun && !loading && (
            <div className="ri-empty-state">
              <div className="hf-text-md">
                {runs.length === 0 ? "No pipeline runs for this caller" : "Select a run above"}
              </div>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="ri-loading">
              Loading runs...
            </div>
          )}

          {/* Run Details */}
          {selectedRun && (
            <div>
              {/* Run Header */}
              <div className="ri-run-header">
                <StatusBadge status={selectedRun.status} size={24} />
                <div style={{ flex: 1 }}>
                  <div className="ri-run-title">
                    Prompt Composition
                    {selectedRun._model && (
                      <span
                        className={`ri-model-badge ${selectedRun._model === "deterministic" ? "ri-model-badge-deterministic" : "ri-model-badge-ai"}`}
                      >
                        {selectedRun._model}
                      </span>
                    )}
                  </div>
                  <div className="ri-run-subtitle">
                    {new Date(selectedRun.startedAt).toLocaleString()} •{" "}
                    {selectedRun.durationMs}ms • {selectedRun.stepsSucceeded}/
                    {selectedRun.stepsTotal} steps • triggered by {selectedRun.triggeredBy || "manual"}
                  </div>
                </div>
                {selectedRun.errorSummary && (
                  <div className="ri-error-banner">
                    <Warning style={{ fontSize: 16 }} />
                    {selectedRun.errorSummary}
                  </div>
                )}
              </div>

              {/* Steps Timeline */}
              <div className="ri-steps-timeline">
                {selectedRun.steps.map((step, idx) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    isLast={idx === selectedRun.steps.length - 1}
                    expanded={expandedSteps.has(step.id)}
                    onToggle={() => toggleStep(step.id)}
                    aiConfigs={aiConfigs}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// DATA TYPE COLORS
// =============================================================================

const DATA_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  memories: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", border: "color-mix(in srgb, var(--badge-blue-text) 40%, transparent)" },
  recentCalls: { bg: "var(--badge-yellow-bg)", text: "var(--badge-yellow-text)", border: "color-mix(in srgb, var(--badge-yellow-text) 40%, transparent)" },
  behaviorTargets: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text)", border: "color-mix(in srgb, var(--badge-green-text) 40%, transparent)" },
  playbooks: { bg: "var(--badge-purple-bg)", text: "var(--badge-purple-text)", border: "color-mix(in srgb, var(--badge-purple-text) 40%, transparent)" },
  personality: { bg: "var(--badge-pink-bg)", text: "var(--badge-pink-text)", border: "var(--badge-pink-border)" },
  curriculum: { bg: "var(--badge-cyan-bg)", text: "var(--badge-cyan-text)", border: "var(--badge-cyan-border)" },
  identity: { bg: "var(--badge-orange-bg)", text: "var(--badge-orange-text)", border: "var(--badge-orange-border)" },
  instructions: { bg: "var(--badge-indigo-bg)", text: "var(--badge-indigo-text)", border: "var(--badge-indigo-border)" },
  learnerGoals: { bg: "var(--badge-lime-bg)", text: "var(--badge-lime-text)", border: "var(--badge-lime-border)" },
  default: { bg: "var(--surface-secondary)", text: "var(--text-primary)", border: "var(--border-default)" },
};

function getTypeColor(key: string) {
  return DATA_TYPE_COLORS[key] || DATA_TYPE_COLORS.default;
}

// =============================================================================
// AI CALL BADGE (with hover tooltip)
// =============================================================================

function AICallBadge({
  operation,
  aiConfigs,
}: {
  operation: string;
  aiConfigs: Record<string, AIConfigInfo>;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  const callPoint = STEP_TO_CALLPOINT[operation];
  if (!callPoint) return null;

  const config = aiConfigs[callPoint];
  if (!config) {
    // Show placeholder badge
    return (
      <span
        className="ri-ai-badge ri-ai-badge-default"
        title="AI-powered step"
      >
        <Psychology style={{ fontSize: 12 }} />
        AI
      </span>
    );
  }

  const transcriptLimit = config.transcriptLimit ?? config.defaultTranscriptLimit;
  const isCustomized = config.transcriptLimit !== null;

  return (
    <div
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        className={`ri-ai-badge ri-ai-badge-custom ${isCustomized ? "ri-ai-badge-custom-modified" : "ri-ai-badge-custom-default"}`}
      >
        <Psychology style={{ fontSize: 12 }} />
        {config.provider === "mock" ? "Mock" : "AI"}
        {transcriptLimit && (
          <span style={{ opacity: 0.7 }}>{"\u2022"} {(transcriptLimit / 1000).toFixed(1)}k</span>
        )}
      </span>

      {/* Hover Tooltip */}
      {showTooltip && (
        <div className="ri-tooltip">
          <div className="ri-tooltip-title">
            AI Configuration
          </div>
          <div className="hf-flex-col" style={{ gap: 6 }}>
            <div className="ri-tooltip-row">
              <span className="ri-tooltip-label">Provider</span>
              <span className="ri-tooltip-value">
                {config.provider}
              </span>
            </div>
            <div className="ri-tooltip-row">
              <span className="ri-tooltip-label">Model</span>
              <span
                className="ri-tooltip-value ri-tooltip-model"
                title={config.model}
              >
                {config.model.split("-").slice(-2).join("-")}
              </span>
            </div>
            {transcriptLimit && (
              <div className="ri-tooltip-row">
                <span className="ri-tooltip-label">Transcript Limit</span>
                <span className="ri-tooltip-value">
                  {transcriptLimit.toLocaleString()} chars
                  {isCustomized && (
                    <span className="ri-tooltip-custom-badge">
                      custom
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
          <div className="ri-tooltip-footer">
            Configure in <a href="/x/ai-config" className="ri-tooltip-link">AI Config</a>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// DATA VIEWER - Type-aware rendering for different data types
// =============================================================================

function DataViewer({
  data,
  dataType,
  highlight,
}: {
  data: unknown;
  dataType: string;
  highlight: boolean;
}) {
  // Handle arrays - render as rows
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <div className="ri-data-empty">
          Empty array
        </div>
      );
    }

    // Special handling for memories array
    if (dataType === "memories") {
      return (
        <div>
          {data.map((item: any, i: number) => (
            <div
              key={i}
              className={`ri-data-row ${highlight ? "highlight-row" : ""} ${i < data.length - 1 ? "ri-data-row-bordered" : ""}`}
            >
              <div className="ri-data-text">
                {item.content || item.text || item.memory || JSON.stringify(item)}
              </div>
              <div className="ri-data-meta">
                {item.category && <span className="ri-data-meta-tag">{item.category}</span>}
                {item.importance && <span>{"\u2605"} {item.importance}</span>}
                {item.createdAt && <span>{new Date(item.createdAt).toLocaleDateString()}</span>}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Generic array rendering
    return (
      <div>
        {data.map((item: any, i: number) => (
          <div
            key={i}
            className={`ri-data-row ri-data-generic ${highlight ? "highlight-row" : ""} ${i < data.length - 1 ? "ri-data-row-bordered" : ""}`}
          >
            {typeof item === "object" ? (
              <pre className="ri-data-pre">
                {JSON.stringify(item, null, 2)}
              </pre>
            ) : (
              String(item)
            )}
          </div>
        ))}
      </div>
    );
  }

  // Handle objects with 'all' array (common pattern for targets, etc.)
  if (data && typeof data === "object" && "all" in data && Array.isArray((data as any).all)) {
    const allItems = (data as any).all;
    return (
      <div>
        {allItems.map((item: any, i: number) => (
          <div
            key={i}
            className={`ri-data-all-item ${highlight ? "highlight-row" : ""} ${i < allItems.length - 1 ? "ri-data-all-item-bordered" : ""}`}
          >
            <div className="ri-data-all-name">
              {item.name || item.parameterId || item.key || `Item ${i + 1}`}
            </div>
            <div className="hf-flex-center hf-gap-sm">
              {item.value !== undefined && (
                <span className="ri-data-all-value">
                  {typeof item.value === "number" ? item.value.toFixed(2) : item.value}
                </span>
              )}
              {item.confidence !== undefined && (
                <span className="ri-data-confidence">
                  {"\u00B1"}{(item.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Handle plain objects - render as key-value pairs
  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>).filter(([k]) => !k.startsWith("_"));
    return (
      <div>
        {entries.map(([key, value], i) => (
          <div
            key={key}
            className={`ri-data-kv-row ${highlight ? "highlight-row" : ""} ${i < entries.length - 1 ? "ri-data-kv-row-bordered" : ""}`}
          >
            <span className="ri-data-key">{key}</span>
            <span
              className="ri-data-value"
              style={{
                fontFamily: typeof value === "number" || typeof value === "boolean" ? "monospace" : "inherit",
              }}
            >
              {typeof value === "object" ? JSON.stringify(value) : String(value)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Fallback for primitives
  return (
    <pre className="ri-json-pre">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// =============================================================================
// STEP CARD
// =============================================================================

function StepCard({
  step,
  isLast,
  expanded,
  onToggle,
  aiConfigs,
}: {
  step: PipelineStep;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  aiConfigs: Record<string, AIConfigInfo>;
}) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [highlightRows, setHighlightRows] = useState(false);
  const dataViewerRef = useRef<HTMLDivElement>(null);

  // Extract llmPrompt from outputs for structured viewing
  const llmPrompt = (step.outputs as any)?.llmPrompt || null;
  const hasLlmPrompt = !!llmPrompt;

  // Get sections from llmPrompt for tabbed view
  const llmSections = llmPrompt
    ? Object.keys(llmPrompt).filter(
        (k) => !k.startsWith("_") && llmPrompt[k] && typeof llmPrompt[k] === "object"
      )
    : [];

  const hasDetails =
    step.inputs ||
    step.outputs ||
    step.sectionsActivated.length > 0 ||
    step.sectionsSkipped.length > 0;

  // Scroll to data viewer and trigger highlight when section changes
  useEffect(() => {
    if (activeSection && dataViewerRef.current) {
      dataViewerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setHighlightRows(true);
      const timer = setTimeout(() => setHighlightRows(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [activeSection]);

  return (
    <div className="ri-step-row">
      {/* Timeline connector */}
      <div className="ri-timeline-connector">
        <StatusBadge status={step.status} size={18} />
        {!isLast && (
          <div className="ri-timeline-line" />
        )}
      </div>

      {/* Card */}
      <div className="ri-step-card">
        {/* Header */}
        <div
          onClick={hasDetails ? onToggle : undefined}
          className={`ri-step-header ${hasDetails ? "ri-step-header-clickable" : ""}`}
        >
          <StepIcon operation={step.operation} size={18} />

          <div style={{ flex: 1 }}>
            <div className="hf-flex-center hf-gap-sm">
              <span className="ri-step-label">
                {step.label || step.operation}
              </span>
              {step.specSlug && <ConfigBadge source="spec" />}
              {AI_POWERED_STEPS.has(step.operation) && (
                <AICallBadge operation={step.operation} aiConfigs={aiConfigs} />
              )}
            </div>
            {step.outputCounts && (
              <div className="hf-flex hf-flex-wrap" style={{ gap: 6, marginTop: 4 }}>
                {Object.entries(step.outputCounts).map(([key, value]) => {
                  const colors = getTypeColor(key);
                  return (
                    <button
                      key={key}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!expanded) onToggle();
                        setActiveSection(activeSection === key ? null : key);
                      }}
                      className="ri-output-pill"
                      style={{
                        background: activeSection === key ? colors.text : colors.bg,
                        color: activeSection === key ? "white" : colors.text,
                        border: `1px solid ${colors.border}`,
                      }}
                    >
                      {value} {key}
                    </button>
                  );
                })}
              </div>
            )}
            {step.error && step.status === "FAILED" && (
              <div className="ri-step-error">
                {step.error}
              </div>
            )}
          </div>

          <div className="ri-step-duration">
            {step.durationMs !== null ? `${step.durationMs}ms` : "\u2014"}
          </div>

          {hasDetails && (
            <div className="hf-text-muted">
              {expanded ? (
                <ExpandLess style={{ fontSize: 20 }} />
              ) : (
                <ExpandMore style={{ fontSize: 20 }} />
              )}
            </div>
          )}
        </div>

        {/* Expanded Details */}
        {expanded && hasDetails && (
          <div className="ri-details">
            {/* Sections for compose step */}
            {(step.sectionsActivated.length > 0 ||
              step.sectionsSkipped.length > 0) && (
              <div className="hf-mb-md" style={{ marginBottom: 12 }}>
                <div className="ri-section-label">
                  Sections ({step.sectionsActivated.length} active, {step.sectionsSkipped.length} skipped)
                </div>
                <div className="ri-section-chips">
                  {step.sectionsActivated.map((s) => {
                    // Map section names to llmPrompt fields
                    const sectionToField: Record<string, string> = {
                      caller_info: "caller",
                      personality: "personality",
                      memories: "memories",
                      behavior_targets: "behaviorTargets",
                      curriculum: "curriculum",
                      identity: "identity",
                      instructions: "instructions",
                      instructions_pedagogy: "instructions",
                      instructions_voice: "instructions",
                      learner_goals: "learnerGoals",
                      call_history: "callHistory",
                      domain_context: "domain",
                      quick_start: "_quickStart",
                      preamble: "_preamble",
                    };
                    const fieldName = sectionToField[s] || s;
                    const hasData = hasLlmPrompt && llmPrompt[fieldName];
                    const colors = getTypeColor(fieldName);
                    const isActive = activeSection === fieldName;

                    return (
                      <button
                        key={s}
                        onClick={() => {
                          if (hasData) {
                            setActiveSection(isActive ? null : fieldName);
                          }
                        }}
                        className={`ri-section-chip ${hasData ? "ri-section-chip-clickable" : ""}`}
                        style={{
                          background: isActive ? colors.text : hasData ? colors.bg : "var(--badge-green-bg)",
                          color: isActive ? "var(--button-primary-text)" : hasData ? colors.text : "var(--badge-green-text)",
                          border: hasData ? `1px solid ${colors.border}` : "1px solid color-mix(in srgb, var(--badge-green-text) 40%, transparent)",
                          cursor: hasData ? "pointer" : "default",
                          opacity: hasData ? 1 : 0.7,
                        }}
                      >
                        <SectionIcon section={s} size={14} />
                        {s}
                        {step.sectionTimings?.[s] && (
                          <span className="ri-section-chip-timing">
                            ({step.sectionTimings[s]}ms)
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {step.sectionsSkipped.map((s) => (
                    <div
                      key={s}
                      className="ri-section-skipped"
                    >
                      <SectionIcon section={s.split(":")[0]} size={14} />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Input/Output JSON */}
            {step.inputs && (
              <div style={{ marginBottom: 12 }}>
                <div className="ri-section-label ri-section-label-compact">
                  Inputs
                </div>
                <div className="ri-json-container">
                  <pre className="ri-json-pre">
                    {JSON.stringify(step.inputs, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {step.outputs && (
              <div>
                {/* If we have llmPrompt, show structured tabs */}
                {hasLlmPrompt && (
                  <>
                    <div className="ri-section-label">
                      Prompt Data (click a section to view)
                    </div>
                    {/* Section tabs */}
                    <div className="hf-flex hf-flex-wrap" style={{ gap: 6, marginBottom: 12 }}>
                      {llmSections.map((section) => {
                        const colors = getTypeColor(section);
                        const isActive = activeSection === section;
                        const sectionData = llmPrompt[section];
                        const count = Array.isArray(sectionData)
                          ? sectionData.length
                          : Array.isArray(sectionData?.all)
                          ? sectionData.all.length
                          : sectionData?.totalCount || null;
                        return (
                          <button
                            key={section}
                            onClick={() => setActiveSection(isActive ? null : section)}
                            className="ri-prompt-tab"
                            style={{
                              background: isActive ? colors.text : colors.bg,
                              color: isActive ? "white" : colors.text,
                              border: `1px solid ${colors.border}`,
                            }}
                          >
                            {section}
                            {count !== null && (
                              <span
                                className="ri-prompt-tab-count"
                                style={{
                                  background: isActive ? "rgba(255,255,255,0.3)" : colors.border,
                                }}
                              >
                                {count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {/* Active section content */}
                    {activeSection && llmPrompt[activeSection] && (
                      <div
                        ref={dataViewerRef}
                        className="ri-section-viewer"
                        style={{
                          borderLeft: `4px solid ${getTypeColor(activeSection).border}`,
                        }}
                      >
                        <div
                          className="ri-section-viewer-header"
                          style={{
                            background: getTypeColor(activeSection).bg,
                            color: getTypeColor(activeSection).text,
                          }}
                        >
                          {activeSection}
                        </div>
                        <DataViewer
                          data={llmPrompt[activeSection]}
                          dataType={activeSection}
                          highlight={highlightRows}
                        />
                      </div>
                    )}
                    {!activeSection && (
                      <div className="ri-section-viewer-empty">
                        Click a section above to view its data
                      </div>
                    )}
                  </>
                )}
                {/* Fallback: show raw outputs if no llmPrompt */}
                {!hasLlmPrompt && (
                  <>
                    <div className="ri-section-label ri-section-label-compact">
                      Outputs
                    </div>
                    <div className="ri-json-container ri-json-container-lg">
                      <pre className="ri-json-pre">
                        {JSON.stringify(step.outputs, null, 2)}
                      </pre>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

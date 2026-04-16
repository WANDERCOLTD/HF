"use client";

/**
 * CallsPromptsTab — unified call timeline. The single tab for everything call-related.
 *
 * Per call (accordion cards, cpt-* styling):
 * 1. Transcript — preview + full conversation
 * 2. Extraction — memories, traits, scores, actions (lazy-loaded)
 * 3. Behaviour — measurements + reward score (lazy-loaded)
 * 4. Prompt used — the composed prompt active during this call
 * 5. What changed — diff between this call's prompt and the next
 * 6. Logs — pipeline operation logs (conditional, after pipeline runs)
 *
 * Toolbar: Analyze All, Prompt All, AI Config, progress bar
 *
 * Educator intent: "What happened in each call, and how do I make the next one better?"
 * Story: #175 (timeline) → Journey merge
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  ChevronDown, ChevronRight, Phone, Brain, TrendingUp,
  FileText, Diff, CheckCircle2, AlertCircle, Clock,
  MessageSquare, BarChart3, Target, ClipboardCheck,
  CheckSquare, Play, Zap, ScrollText,
} from "lucide-react";
import { AIConfigButton } from "@/components/shared/AIConfigButton";
import { SectionSelector, useSectionVisibility } from "@/components/shared/SectionSelector";
import { useTerminology } from "@/contexts/TerminologyContext";
import { computeDiff } from "./PromptsSection";
import { TwoColumnTargetsDisplay } from "./CallsTab";
import { CATEGORY_COLORS, ACTION_TYPE_ICONS, ASSIGNEE_COLORS } from "./constants";
import type { Call, ComposedPrompt, CallDetail, PipelineMode, PipelineStatus, OpResult, LogEntry } from "./types";
import "./calls-prompts-tab.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CallWithPrompts = Call & {
  promptUsed: ComposedPrompt | null;
  promptAfter: ComposedPrompt | null;
};

type DiffLine = { type: "same" | "added" | "removed"; text: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

function getAIEngine(): "mock" | "claude" | "openai" {
  if (typeof window === "undefined") return "mock";
  const stored = localStorage.getItem("hf_ai_engine");
  if (stored === "mock" || stored === "claude" || stored === "openai") return stored;
  return "mock";
}

function getLogLevel(): "full" | "med" | "off" {
  if (typeof window === "undefined") return "full";
  const stored = localStorage.getItem("hf_log_level");
  if (stored === "full" || stored === "med" || stored === "off") return stored;
  return "full";
}

function filterLogs(logs: LogEntry[], level: "full" | "med" | "off"): LogEntry[] {
  if (level === "off") return [];
  if (level === "med") return logs.filter((log) => log.level !== "debug");
  return logs;
}

/** Join calls to their prompts using triggerCallId */
function buildTimeline(
  calls: Call[],
  prompts: ComposedPrompt[],
): { entries: CallWithPrompts[]; bootstrap: ComposedPrompt | null } {
  const sorted = [...calls].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const sortedPrompts = [...prompts].sort(
    (a, b) => new Date(a.composedAt).getTime() - new Date(b.composedAt).getTime(),
  );

  const bootstrap = sortedPrompts.find(p => !p.triggerCallId) ?? null;

  const afterCallMap = new Map<string, ComposedPrompt>();
  for (const p of sortedPrompts) {
    if (p.triggerCallId) afterCallMap.set(p.triggerCallId, p);
  }

  const entries = sorted.map((call) => {
    const callTime = new Date(call.createdAt).getTime();
    let promptUsed: ComposedPrompt | null = null;
    for (let i = sortedPrompts.length - 1; i >= 0; i--) {
      if (new Date(sortedPrompts[i].composedAt).getTime() <= callTime) {
        promptUsed = sortedPrompts[i];
        break;
      }
    }
    return { ...call, promptUsed, promptAfter: afterCallMap.get(call.id) ?? null };
  });

  return { entries, bootstrap };
}

function parseTranscript(transcript: string): { role: "user" | "assistant"; content: string }[] {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  const lines = transcript.split("\n");
  let current: { role: "user" | "assistant"; content: string } | null = null;
  for (const line of lines) {
    if (line.startsWith("User: ")) {
      if (current) messages.push(current);
      current = { role: "user", content: line.slice(6) };
    } else if (line.startsWith("Assistant: ")) {
      if (current) messages.push(current);
      current = { role: "assistant", content: line.slice(11) };
    } else if (current) {
      current.content += "\n" + line;
    }
  }
  if (current) messages.push(current);
  return messages;
}

// ---------------------------------------------------------------------------
// Accordion sub-components (all cpt-* styled)
// ---------------------------------------------------------------------------

function TranscriptCard({ transcript }: { transcript: string }) {
  const [expanded, setExpanded] = useState(false);
  const messages = useMemo(() => parseTranscript(transcript), [transcript]);

  if (messages.length === 0) return null;

  return (
    <div className="cpt-accordion-card">
      <button className="cpt-accordion-header" onClick={() => setExpanded(!expanded)}>
        <MessageSquare size={13} />
        <span className="cpt-accordion-label">Transcript</span>
        <span className="cpt-accordion-count">{messages.length} messages</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {!expanded && (
        <div className="cpt-transcript-preview">
          {messages.slice(0, 2).map((m, i) => (
            <div key={i} className="cpt-transcript-preview-line">
              <span className={`cpt-transcript-role cpt-transcript-role--${m.role}`}>
                {m.role === "user" ? "Learner" : "AI"}
              </span>
              <span className="cpt-transcript-preview-text">
                {m.content.slice(0, 120)}{m.content.length > 120 ? "…" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {expanded && (
        <div className="cpt-transcript-body">
          {messages.map((m, i) => (
            <div key={i} className={`cpt-msg cpt-msg--${m.role}`}>
              <span className={`cpt-msg-role cpt-msg-role--${m.role}`}>
                {m.role === "user" ? "Learner" : "AI"}
              </span>
              <div className="cpt-msg-content">{m.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExtractionCard({ details, callId, callerId, isProcessing }: {
  details: CallDetail | null;
  callId: string;
  callerId: string;
  isProcessing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [extractionVis, toggleExtractionVis] = useSectionVisibility("call-extraction", {
    memories: true, traits: true, scores: true, actions: true,
  });
  const [callActions, setCallActions] = useState<any[]>([]);

  useEffect(() => {
    if (!expanded) return;
    fetch(`/api/callers/${callerId}/actions?callId=${callId}&limit=50`)
      .then((r) => r.json())
      .then((result) => { if (result.ok) setCallActions(result.actions || []); })
      .catch(() => {});
  }, [expanded, callId, callerId]);

  const memories = details?.memories || [];
  const scores = details?.scores || [];
  const observation = details?.personalityObservation;
  const totalCount = memories.length + scores.length + (observation ? 1 : 0);

  if (!details && !isProcessing) return null;

  return (
    <div className="cpt-accordion-card">
      <button className="cpt-accordion-header" onClick={() => setExpanded(!expanded)}>
        <BarChart3 size={13} />
        <span className="cpt-accordion-label">Extraction</span>
        <span className="cpt-accordion-count">
          {isProcessing && totalCount === 0 ? "processing…" : `${totalCount} items`}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {!expanded && totalCount > 0 && (
        <div className="cpt-extraction-preview">
          {memories.length > 0 && <span>{memories.length} memories</span>}
          {scores.length > 0 && <span>{scores.length} scores</span>}
          {observation && <span>1 trait obs</span>}
        </div>
      )}
      {expanded && (
        <div className="cpt-accordion-body">
          {isProcessing && totalCount === 0 && (
            <div className="cpt-processing-banner">
              Pipeline running — memories, scores, and traits will appear once analysis completes.
            </div>
          )}
          <SectionSelector
            storageKey="call-extraction"
            sections={[
              { id: "memories", label: "Memories", icon: <MessageSquare size={13} />, count: memories.length },
              { id: "traits", label: "Traits", icon: <Brain size={13} />, count: observation ? 1 : 0 },
              { id: "scores", label: "Scores", icon: <BarChart3 size={13} />, count: scores.length },
              { id: "actions", label: "Actions", icon: <ClipboardCheck size={13} />, count: callActions.length },
            ]}
            visible={extractionVis}
            onToggle={toggleExtractionVis}
          />
          {extractionVis.memories !== false && memories.length > 0 && (
            <div className="cpt-extraction-section">
              {memories.map((memory: any) => {
                const style = CATEGORY_COLORS[memory.category] || CATEGORY_COLORS.CONTEXT;
                return (
                  <div key={memory.id} className="cpt-memory-row">
                    <span className="cpt-memory-cat" style={{ background: style.bg, color: style.text }}>{memory.category}</span>
                    <span className="cpt-memory-key">{memory.key}</span>
                    <span className="cpt-memory-val">= &ldquo;{memory.value}&rdquo;</span>
                    <span className="cpt-memory-conf">{(memory.confidence * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          )}
          {extractionVis.traits !== false && observation && (
            <div className="cpt-extraction-section">
              <div className="cpt-traits-grid">
                {[
                  { label: "O", full: "Openness", value: observation.openness },
                  { label: "C", full: "Conscientiousness", value: observation.conscientiousness },
                  { label: "E", full: "Extraversion", value: observation.extraversion },
                  { label: "A", full: "Agreeableness", value: observation.agreeableness },
                  { label: "N", full: "Neuroticism", value: observation.neuroticism },
                ].filter(t => t.value !== null).map((t) => (
                  <div key={t.label} className="cpt-trait-pill" title={t.full}>
                    <span className="cpt-trait-letter">{t.label}</span>
                    <span className="cpt-trait-value">{(t.value * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {extractionVis.scores !== false && scores.length > 0 && (
            <div className="cpt-extraction-section">
              <div className="cpt-scores-grid">
                {scores.map((score: any) => {
                  const pct = (score.score * 100).toFixed(0);
                  const color = score.score >= 0.7 ? "var(--status-success-text)" : score.score >= 0.4 ? "var(--status-warning-text)" : "var(--status-error-text)";
                  return (
                    <div key={score.id} className="cpt-score-item">
                      <span className="cpt-score-name">{score.parameter?.name || score.parameterId}</span>
                      <span className="cpt-score-val" style={{ color }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {extractionVis.actions !== false && callActions.length > 0 && (
            <div className="cpt-extraction-section">
              {callActions.map((action: any) => {
                const colors = ASSIGNEE_COLORS[action.assignee] || ASSIGNEE_COLORS.CALLER;
                return (
                  <div key={action.id} className="cpt-action-row">
                    <span className="cpt-action-icon">{ACTION_TYPE_ICONS[action.type] || <CheckSquare size={13} />}</span>
                    <span className="cpt-action-title">{action.title}</span>
                    <span className="cpt-action-assignee" style={{ background: colors.bg, color: colors.text }}>{action.assignee}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BehaviourCard({ details, isProcessing }: {
  details: CallDetail | null;
  isProcessing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const measurements = details?.measurements || [];
  const rewardScore = details?.rewardScore;
  const effectiveTargets = details?.effectiveTargets || [];
  const callerTargets = details?.callerTargets || [];

  if (!details && !isProcessing) return null;

  const rewardPct = rewardScore ? (rewardScore.overallScore * 100).toFixed(0) : null;
  const rewardColor = rewardScore
    ? rewardScore.overallScore >= 0.7 ? "var(--status-success-text)" : rewardScore.overallScore >= 0.4 ? "var(--status-warning-text)" : "var(--status-error-text)"
    : undefined;

  return (
    <div className="cpt-accordion-card">
      <button className="cpt-accordion-header" onClick={() => setExpanded(!expanded)}>
        <Target size={13} />
        <span className="cpt-accordion-label">Behaviour</span>
        <span className="cpt-accordion-count">
          {isProcessing && measurements.length === 0 ? "processing…" : `${measurements.length} measurements`}
        </span>
        {rewardPct && (
          <span className="cpt-reward-badge" style={{ color: rewardColor }}>
            Reward: {rewardPct}%
          </span>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="cpt-accordion-body">
          {isProcessing && measurements.length === 0 && (
            <div className="cpt-processing-banner">
              Pipeline running — behaviour data will appear once analysis completes.
            </div>
          )}
          {(measurements.length > 0 || effectiveTargets.length > 0) && (
            <TwoColumnTargetsDisplay
              callerTargets={callerTargets}
              behaviorTargets={effectiveTargets.length > 0 ? effectiveTargets : measurements.map((m: any) => ({
                parameterId: m.parameterId,
                targetValue: m.targetValue || 0.5,
                effectiveScope: "MEASUREMENT" as any,
                parameter: m.parameter,
              }))}
              measurements={measurements.map((m: any) => ({ parameterId: m.parameterId, actualValue: m.actualValue }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PipelineSummary({ call }: { call: Call }) {
  const items: { icon: React.ReactNode; label: string; ok: boolean }[] = [
    { icon: <Brain size={13} />, label: "Memories", ok: !!call.hasMemories },
    { icon: <TrendingUp size={13} />, label: "Scores", ok: !!call.hasScores },
    { icon: <CheckCircle2 size={13} />, label: "Behaviour", ok: !!call.hasBehaviorMeasurements },
  ];

  const allDone = items.every(i => i.ok);
  if (!allDone && !items.some(i => i.ok)) {
    return (
      <div className="cpt-pipeline cpt-pipeline--pending">
        <Clock size={13} />
        <span>Pipeline not yet run</span>
      </div>
    );
  }

  return (
    <div className="cpt-pipeline">
      {items.map((item) => (
        <span key={item.label} className={`cpt-pip ${item.ok ? "cpt-pip--ok" : "cpt-pip--pending"}`}>
          {item.icon} {item.label}
        </span>
      ))}
    </div>
  );
}

function PromptPreview({ prompt, label }: { prompt: ComposedPrompt; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = prompt.prompt || "";
  const preview = text.slice(0, 200);

  return (
    <div className="cpt-accordion-card">
      <button className="cpt-accordion-header" onClick={() => setExpanded(!expanded)}>
        <FileText size={13} />
        <span className="cpt-accordion-label">{label}</span>
        <span className="cpt-accordion-count">{prompt.triggerType}</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <pre className="cpt-prompt-body">{text}</pre>
      )}
      {!expanded && text.length > 0 && (
        <div className="cpt-prompt-preview">{preview}{text.length > 200 ? "..." : ""}</div>
      )}
    </div>
  );
}

function DiffCard({ before, after }: { before: ComposedPrompt; after: ComposedPrompt }) {
  const [expanded, setExpanded] = useState(false);

  const diffLines = useMemo<DiffLine[]>(() => {
    if (!expanded) return [];
    return computeDiff(before.prompt || "", after.prompt || "");
  }, [expanded, before.prompt, after.prompt]);

  const addedCount = diffLines.filter(l => l.type === "added").length;
  const removedCount = diffLines.filter(l => l.type === "removed").length;

  return (
    <div className="cpt-accordion-card">
      <button className="cpt-accordion-header" onClick={() => setExpanded(!expanded)}>
        <Diff size={13} />
        <span className="cpt-accordion-label">What changed for next call</span>
        {expanded && (
          <span className="cpt-diff-stats">
            <span className="cpt-diff-added">+{addedCount}</span>
            <span className="cpt-diff-removed">-{removedCount}</span>
          </span>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="cpt-diff-body">
          {diffLines.map((line, i) => (
            <div key={i} className={`cpt-diff-line cpt-diff-line--${line.type}`}>
              <span className="cpt-diff-gutter">
                {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
              </span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogsCard({ result }: { result: OpResult }) {
  const [expanded, setExpanded] = useState(false);
  const { terms } = useTerminology();
  const logLevel = getLogLevel();
  const filteredLogs = useMemo(() => filterLogs(result.logs, logLevel), [result.logs, logLevel]);

  const isZeroResults = result.ok && result.data &&
    (result.data.scoresCreated || 0) + (result.data.agentMeasurements || 0) === 0;

  return (
    <div className="cpt-accordion-card">
      <button className="cpt-accordion-header" onClick={() => setExpanded(!expanded)}>
        <ScrollText size={13} />
        <span className="cpt-accordion-label">Logs</span>
        <span className={`cpt-logs-status ${result.ok ? (isZeroResults ? "cpt-logs-status--warning" : "cpt-logs-status--ok") : "cpt-logs-status--error"}`}>
          {isZeroResults ? "0 RESULTS" : result.ok ? "SUCCESS" : "ERROR"}
        </span>
        <span className="cpt-accordion-count">{result.duration}ms</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="cpt-logs-body">
          {/* Summary counts */}
          {result.data && (
            <div className="cpt-logs-summary">
              <span>Scores: <strong>{result.data.scoresCreated || 0}</strong></span>
              <span>Behaviour: <strong>{result.data.agentMeasurements || 0}</strong></span>
              <span>Memories: <strong>{result.data.memoriesCreated || 0}</strong></span>
              {result.data.playbookUsed && <span>{terms.playbook}: <strong>{result.data.playbookUsed}</strong></span>}
            </div>
          )}
          {result.data?.composeFailed && (
            <div className="cpt-processing-banner cpt-processing-banner--error">
              Prompt generation failed: {result.data.composeError || "COMPOSE stage error"}
            </div>
          )}
          {/* Log entries */}
          <div className="cpt-logs-entries">
            {filteredLogs.map((log, i) => (
              <div key={i} className={`cpt-log-line cpt-log-line--${log.level}`}>
                <span className="cpt-log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className="cpt-log-level">{log.level.toUpperCase()}</span>
                <span className="cpt-log-msg">{log.message}</span>
              </div>
            ))}
            {filteredLogs.length === 0 && (
              <div className="cpt-log-line"><span className="cpt-log-msg">No log entries</span></div>
            )}
          </div>
          {result.error && (
            <div className="cpt-processing-banner cpt-processing-banner--error">
              Error: {result.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type CallsPromptsTabProps = {
  calls: Call[];
  composedPrompts: ComposedPrompt[];
  callerId: string;
  processingCallIds?: Set<string>;
  onCallUpdated?: () => void;
  expandedCall?: string | null;
  setExpandedCall?: (id: string | null) => void;
};

export function CallsPromptsTab({
  calls,
  composedPrompts,
  callerId,
  processingCallIds,
  onCallUpdated,
  expandedCall: externalExpanded,
  setExpandedCall: externalSetExpanded,
}: CallsPromptsTabProps) {
  // Expanded state — use external if provided (for GuideLens navigation)
  const [internalExpanded, setInternalExpanded] = useState<string | null>(null);
  const expandedCallId = externalExpanded !== undefined ? externalExpanded : internalExpanded;
  const setExpandedCallId = externalSetExpanded || setInternalExpanded;

  // Lazy-loaded call details
  const [callDetails, setCallDetails] = useState<Record<string, CallDetail>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});

  // Pipeline state
  const [pipelineStatus, setPipelineStatus] = useState<Record<string, Record<PipelineMode, PipelineStatus>>>({});
  const [pipelineResults, setPipelineResults] = useState<Record<string, Record<PipelineMode, OpResult>>>({});
  const [runningOnCall, setRunningOnCall] = useState<{ callId: string; mode: PipelineMode } | null>(null);
  const [bulkRunning, setBulkRunning] = useState<PipelineMode | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  // Initialize pipeline status from call flags
  useEffect(() => {
    const initial: Record<string, Record<PipelineMode, PipelineStatus>> = {};
    for (const call of calls) {
      const prepDone = call.hasScores && call.hasMemories && call.hasBehaviorMeasurements;
      initial[call.id] = {
        prep: prepDone ? "success" : "ready",
        prompt: call.hasPrompt ? "success" : "ready",
      };
    }
    setPipelineStatus(initial);
  }, [calls]);

  // Build timeline
  const { entries, bootstrap } = useMemo(
    () => buildTimeline(calls, composedPrompts),
    [calls, composedPrompts],
  );

  const latestId = entries[0]?.id ?? null;
  const effectiveExpanded = expandedCallId ?? latestId;

  // Lazy-load call details when expanded
  const loadCallDetails = useCallback(async (callId: string) => {
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
  }, [callDetails, loadingDetails]);

  useEffect(() => {
    if (effectiveExpanded) {
      loadCallDetails(effectiveExpanded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveExpanded]);

  // Cache invalidation — re-fetch when pipeline completes
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
      setCallDetails((prev) => {
        const next = { ...prev };
        for (const id of staleIds) delete next[id];
        return next;
      });
      if (effectiveExpanded && staleIds.includes(effectiveExpanded)) {
        setLoadingDetails((prev) => ({ ...prev, [effectiveExpanded]: true }));
        fetch(`/api/calls/${effectiveExpanded}`)
          .then((r) => r.json())
          .then((result) => {
            if (result.ok) setCallDetails((prev) => ({ ...prev, [effectiveExpanded!]: result }));
          })
          .catch(() => {})
          .finally(() => setLoadingDetails((prev) => ({ ...prev, [effectiveExpanded!]: false })));
      }
    }
  }, [calls, effectiveExpanded]);

  // Pipeline runner
  const runPipeline = useCallback(async (callId: string, mode: PipelineMode): Promise<boolean> => {
    setPipelineStatus((prev) => ({ ...prev, [callId]: { ...prev[callId], [mode]: "running" } }));

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
        [callId]: { ...prev[callId], [mode]: { ok: result.ok, opId: mode, logs: result.logs || [], duration: result.duration || 0, error: result.error, data: result.data } },
      }));

      const hasWarnings = result.ok && (result.data?.stageErrors?.length ?? 0) > 0;
      setPipelineStatus((prev) => ({
        ...prev,
        [callId]: { ...prev[callId], [mode]: result.ok ? (hasWarnings ? "warning" : "success") : "error" },
      }));

      return result.ok;
    } catch (error: any) {
      setPipelineResults((prev) => ({
        ...prev,
        [callId]: { ...prev[callId], [mode]: { ok: false, opId: mode, logs: [{ timestamp: new Date().toISOString(), level: "error", message: error.message || "Network error" }], duration: 0, error: error.message } },
      }));
      setPipelineStatus((prev) => ({ ...prev, [callId]: { ...prev[callId], [mode]: "error" } }));
      return false;
    }
  }, [callerId]);

  const runPipelineOnCall = useCallback(async (callId: string, mode: PipelineMode) => {
    setRunningOnCall({ callId, mode });
    await runPipeline(callId, mode);
    setRunningOnCall(null);
    if (onCallUpdated) onCallUpdated();
  }, [runPipeline, onCallUpdated]);

  const runBulkPipeline = useCallback(async (mode: PipelineMode) => {
    const sortedCalls = [...calls].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    if (mode === "prompt") {
      const existing = sortedCalls.filter(c => pipelineStatus[c.id]?.prompt === "success").length;
      if (existing > 0) {
        const replace = window.confirm(`${existing} call(s) already have prompts.\n\nOK = replace all, Cancel = skip existing.`);
        if (!replace) {
          const toProcess = sortedCalls.filter(c => pipelineStatus[c.id]?.prompt !== "success");
          if (toProcess.length === 0) { alert("All calls already have prompts."); return; }
          setBulkRunning(mode);
          setBulkProgress({ current: 0, total: toProcess.length });
          for (let i = 0; i < toProcess.length; i++) {
            setBulkProgress({ current: i + 1, total: toProcess.length });
            await runPipeline(toProcess[i].id, mode);
          }
          setBulkRunning(null); setBulkProgress(null);
          if (onCallUpdated) onCallUpdated();
          return;
        }
      }
    }

    setBulkRunning(mode);
    setBulkProgress({ current: 0, total: sortedCalls.length });
    for (let i = 0; i < sortedCalls.length; i++) {
      setBulkProgress({ current: i + 1, total: sortedCalls.length });
      await runPipeline(sortedCalls[i].id, mode);
    }
    setBulkRunning(null); setBulkProgress(null);
    if (onCallUpdated) onCallUpdated();
  }, [calls, pipelineStatus, runPipeline, onCallUpdated]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (entries.length === 0 && !bootstrap) {
    return (
      <div className="hf-empty">
        <Phone size={24} />
        <div>No calls yet</div>
        <div className="hf-text-xs hf-text-muted">Start a practice call to see the timeline here.</div>
      </div>
    );
  }

  return (
    <div className="cpt-root">
      {/* Toolbar — bulk ops */}
      {entries.length > 0 && (
        <div className="cpt-toolbar">
          <button
            className="cpt-toolbar-btn"
            onClick={() => runBulkPipeline("prep")}
            disabled={bulkRunning !== null}
          >
            <Zap size={13} />
            {bulkRunning === "prep" ? `Analyzing ${bulkProgress?.current}/${bulkProgress?.total}` : "Analyze All"}
          </button>
          <button
            className="cpt-toolbar-btn cpt-toolbar-btn--primary"
            onClick={() => runBulkPipeline("prompt")}
            disabled={bulkRunning !== null}
          >
            <Play size={13} />
            {bulkRunning === "prompt" ? `Prompting ${bulkProgress?.current}/${bulkProgress?.total}` : "Prompt All"}
          </button>
          <div className="cpt-toolbar-spacer" />
          <div onClick={(e) => e.stopPropagation()}>
            <AIConfigButton callPoint="pipeline.measure" label="AI Config" />
          </div>
          {bulkProgress && (
            <div className="cpt-bulk-progress">
              <div className="cpt-bulk-progress-bar" style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Call entries — newest first */}
      {entries.map((entry, idx) => {
        const isExpanded = effectiveExpanded === entry.id;
        const isProcessing = !!processingCallIds?.has(entry.id);
        const callNum = entries.length - idx;
        const details = callDetails[entry.id] || null;
        const isLoading = !!loadingDetails[entry.id];
        const callResults = pipelineResults[entry.id] || {};
        const isRunning = runningOnCall?.callId === entry.id;
        const latestResult = callResults.prompt || callResults.prep;

        return (
          <div key={entry.id} className={`cpt-call ${isExpanded ? "cpt-call--expanded" : ""} ${isProcessing ? "cpt-call--processing" : ""}`}>
            {/* Call header */}
            <div className="cpt-call-header">
              <button
                className="cpt-call-header-left"
                onClick={() => setExpandedCallId(isExpanded && entry.id !== latestId ? null : entry.id)}
              >
                <div className="cpt-call-icon">
                  <Phone size={14} />
                </div>
                <div className="cpt-call-info">
                  <span className="cpt-call-title">Call {callNum}</span>
                  <span className="cpt-call-date">{formatDate(entry.createdAt)}</span>
                  {entry.curriculumModule && (
                    <span className="cpt-call-module">{entry.curriculumModule.title}</span>
                  )}
                </div>
                <div className="cpt-call-status">
                  {isProcessing && <span className="cpt-processing-dot" />}
                  {entry.hasPrompt && <FileText size={12} className="cpt-has-prompt" />}
                </div>
              </button>

              {/* Pipeline action buttons */}
              <div className="cpt-call-actions">
                <button
                  className="cpt-action-btn"
                  onClick={(e) => { e.stopPropagation(); runPipelineOnCall(entry.id, "prep"); }}
                  disabled={isRunning || bulkRunning !== null}
                  title="Run analysis pipeline"
                >
                  {isRunning && runningOnCall?.mode === "prep" ? <Clock size={12} className="cpt-spinning" /> : <Zap size={12} />}
                  <span>Analyze</span>
                </button>
                <button
                  className="cpt-action-btn cpt-action-btn--primary"
                  onClick={(e) => { e.stopPropagation(); runPipelineOnCall(entry.id, "prompt"); }}
                  disabled={isRunning || bulkRunning !== null}
                  title="Run full pipeline + generate prompt"
                >
                  {isRunning && runningOnCall?.mode === "prompt" ? <Clock size={12} className="cpt-spinning" /> : <Play size={12} />}
                  <span>Prompt</span>
                </button>
              </div>

              <button
                className="cpt-call-chevron"
                onClick={() => setExpandedCallId(isExpanded && entry.id !== latestId ? null : entry.id)}
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            </div>

            {/* Expanded detail — accordion cards */}
            {isExpanded && (
              <div className="cpt-call-body">
                {/* 1. Transcript */}
                {entry.transcript && <TranscriptCard transcript={entry.transcript} />}

                {/* 2. Extraction (lazy-loaded) */}
                {(details || isProcessing || isLoading) && (
                  <ExtractionCard
                    details={details}
                    callId={entry.id}
                    callerId={callerId}
                    isProcessing={isProcessing}
                  />
                )}

                {/* 3. Behaviour (lazy-loaded) */}
                {(details || isProcessing || isLoading) && (
                  <BehaviourCard details={details} isProcessing={isProcessing} />
                )}

                {/* 4. Prompt used */}
                {entry.promptUsed ? (
                  <PromptPreview prompt={entry.promptUsed} label="Prompt used" />
                ) : (
                  <div className="cpt-accordion-card cpt-accordion-card--empty">
                    <AlertCircle size={13} />
                    <span>No prompt was composed before this call</span>
                  </div>
                )}

                {/* 5. Pipeline summary */}
                <PipelineSummary call={entry} />

                {/* 6. What changed for next call */}
                {entry.promptUsed && entry.promptAfter && (
                  <DiffCard before={entry.promptUsed} after={entry.promptAfter} />
                )}
                {entry.promptAfter && !entry.promptUsed && (
                  <PromptPreview prompt={entry.promptAfter} label="Prompt composed after call" />
                )}

                {/* 7. Logs (conditional — only after pipeline runs) */}
                {latestResult && (
                  <LogsCard result={latestResult} />
                )}

                {/* Loading indicator */}
                {isLoading && !details && (
                  <div className="cpt-loading">Loading call details…</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Bootstrap prompt */}
      {bootstrap && (
        <div className="cpt-bootstrap">
          <PromptPreview prompt={bootstrap} label="Bootstrap (enrollment)" />
        </div>
      )}
    </div>
  );
}

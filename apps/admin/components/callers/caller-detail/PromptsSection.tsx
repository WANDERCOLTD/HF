"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, ChevronUp } from "lucide-react";
import { diffLines as jsDiffLines } from "diff";
import type { ComposedPrompt } from "./types";
import { CATEGORY_COLORS } from "./constants";
import "./prompts-section.css";

// ---------------------------------------------------------------------------
// Eval Types
// ---------------------------------------------------------------------------

interface EvalDimension {
  name: string;
  score: number;
  verdict: "strong" | "adequate" | "weak";
  findings: string[];
  improvements: string[];
}

interface EvalImprovement {
  priority: number;
  title: string;
  description: string;
  adminPath: string;
  adminLabel: string;
  sectionKeys: string[];
}

interface EvalResult {
  overall: { score: number; verdict: string; summary: string };
  dimensions: EvalDimension[];
  topImprovements: EvalImprovement[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sort prompts oldest → newest and assign sequential index */
function indexPrompts(prompts: ComposedPrompt[]) {
  const sorted = [...prompts].sort(
    (a, b) => new Date(a.composedAt).getTime() - new Date(b.composedAt).getTime(),
  );
  return sorted.map((p, i) => ({ ...p, _idx: i }));
}

/** Human-readable label for a prompt */
function promptLabel(p: ComposedPrompt & { _idx: number }, total: number): string {
  if (p._idx === 0) return "Bootstrap";
  if (p._idx === total - 1 && p.status === "active") return "Next Prompt";
  if (p.triggerCallId) return `After Call ${p._idx}`;
  return `Prompt ${p._idx}`;
}

/** Short trigger badge */
function triggerBadge(p: ComposedPrompt): string {
  if (p.triggerType === "sim") return "sim";
  if (p.triggerType === "pipeline") return "pipeline";
  if (p.triggerType === "manual") return "manual";
  return p.triggerType || "—";
}

/** Compute a proper line-level diff (Myers algorithm) between two prompt texts */
function computeDiff(
  prev: string,
  curr: string,
): { type: "same" | "added" | "removed"; text: string }[] {
  const changes = jsDiffLines(prev, curr);
  const result: { type: "same" | "added" | "removed"; text: string }[] = [];

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, "").split("\n");
    const type = change.added ? "added" : change.removed ? "removed" : "same";
    for (const text of lines) {
      result.push({ type, text });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function UnifiedPromptSection({
  prompts,
  loading,
  onRefresh,
  callerId,
  appliedChanges,
  onDismissApplied,
}: {
  prompts: ComposedPrompt[];
  loading: boolean;
  onRefresh: () => void;
  callerId: string;
  appliedChanges?: { label: string; oldValue: string; newValue: string }[] | null;
  onDismissApplied?: () => void;
}) {
  const indexed = useMemo(() => indexPrompts(prompts), [prompts]);
  const total = indexed.length;

  // Default to latest prompt
  const [selectedIdx, setSelectedIdx] = useState<number>(Math.max(total - 1, 0));
  // Clamp if prompts changed
  const idx = Math.min(selectedIdx, Math.max(total - 1, 0));

  const [viewMode, setViewMode] = useState<"human" | "llm" | "diff">("human");
  const [llmViewMode, setLlmViewMode] = useState<"pretty" | "raw">("pretty");
  const [copiedButton, setCopiedButton] = useState<string | null>(null);

  // ── Eval state ──
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const selected = indexed[idx] ?? null;
  const prevPrompt = idx > 0 ? indexed[idx - 1] : null;

  const copyToClipboard = (text: string, buttonId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedButton(buttonId);
    setTimeout(() => setCopiedButton(null), 1500);
  };

  // Load persisted eval when navigating to a different prompt
  useEffect(() => {
    setEvalError(null);
    const current = indexed[idx];
    if (current?.evalResult) {
      setEvalResult(current.evalResult as EvalResult);
    } else {
      setEvalResult(null);
    }
  }, [idx, indexed]);

  const runEval = useCallback(async () => {
    const selected = indexed[idx];
    if (!selected) return;
    setEvalLoading(true);
    setEvalError(null);
    try {
      const res = await fetch(`/api/callers/${callerId}/eval-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composedPromptId: selected.id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Evaluation failed");
      setEvalResult(data.eval);
    } catch (err: any) {
      setEvalError(err.message);
    } finally {
      setEvalLoading(false);
    }
  }, [callerId, indexed, idx]);

  if (loading) {
    return <div className="hf-empty hf-text-muted">Loading prompts...</div>;
  }

  if (!selected) {
    return (
      <div className="hf-flex-col hf-gap-20">
        <div className="hf-empty-dashed">
          <div className="hf-empty-state-icon hf-mb-md">📝</div>
          <div className="hf-empty-state-title">No Prompt Available</div>
          <div className="hf-text-sm hf-text-muted hf-mt-sm hf-empty-hint-centered">
            Run the pipeline on a call to generate prompts. Use &quot;Prompt ALL&quot; or click 📝 on individual calls.
          </div>
        </div>
      </div>
    );
  }

  const label = promptLabel(selected, total);
  const llm = selected.llmPrompt;
  const diffLines = viewMode === "diff" && prevPrompt
    ? computeDiff(prevPrompt.prompt, selected.prompt)
    : null;

  return (
    <div className="hf-flex-col hf-gap-20">
      {/* ── Timeline Navigator ── */}
      <div className="ps-timeline-nav">
        <div className="ps-timeline-stepper">
          <button
            className="ps-timeline-btn"
            disabled={idx === 0}
            onClick={() => setSelectedIdx(0)}
            title="First (Bootstrap)"
          >
            <ChevronsLeft size={16} />
          </button>
          <button
            className="ps-timeline-btn"
            disabled={idx === 0}
            onClick={() => setSelectedIdx(idx - 1)}
            title="Previous prompt"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="ps-timeline-label">
            <span className="ps-timeline-number">#{selected._idx}</span>
            <span className="ps-timeline-name">{label}</span>
            <span className="ps-timeline-of">{idx + 1} of {total}</span>
          </div>

          <button
            className="ps-timeline-btn"
            disabled={idx >= total - 1}
            onClick={() => setSelectedIdx(idx + 1)}
            title="Next prompt"
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="ps-timeline-btn"
            disabled={idx >= total - 1}
            onClick={() => setSelectedIdx(total - 1)}
            title="Latest (Next Prompt)"
          >
            <ChevronsRight size={16} />
          </button>
        </div>

        {/* Quick jump pills — show when > 5 prompts */}
        {total > 5 && (
          <select
            className="ps-timeline-select hf-input"
            value={idx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
          >
            {indexed.map((p) => (
              <option key={p.id} value={p._idx}>
                #{p._idx} — {promptLabel(p, total)} ({new Date(p.composedAt).toLocaleDateString()})
              </option>
            ))}
          </select>
        )}

        {/* Dot track — show when <= 10 prompts */}
        {total <= 10 && total > 1 && (
          <div className="ps-timeline-dots">
            {indexed.map((p) => (
              <button
                key={p.id}
                className={`ps-timeline-dot${p._idx === idx ? " ps-timeline-dot--active" : ""}${p.status === "active" ? " ps-timeline-dot--current" : ""}`}
                onClick={() => setSelectedIdx(p._idx)}
                title={`#${p._idx} ${promptLabel(p, total)}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Meta row ── */}
      <div className="ps-meta-row">
        <div className="ps-meta-left">
          <span className={`hf-micro-badge hf-uppercase ${selected.status === "active" ? "ps-status-badge-active" : "ps-status-badge-default"}`}>
            {selected.status}
          </span>
          <span className="hf-micro-badge ps-status-badge-default hf-uppercase">
            {triggerBadge(selected)}
          </span>
          <span className="hf-text-sm hf-text-muted">
            {new Date(selected.composedAt).toLocaleString()}
          </span>
          {selected.triggerCall && (
            <span className="hf-text-xs hf-text-placeholder">
              triggered by {selected.triggerCall.source} call
            </span>
          )}
        </div>
        <div className="ps-meta-right">
          {/* View Toggle */}
          <div className="hf-toggle-group">
            <button
              onClick={() => setViewMode("human")}
              className={`hf-toggle-btn hf-toggle-btn-sm ${viewMode === "human" ? "hf-toggle-btn-active" : ""}`}
            >
              Human
            </button>
            <button
              onClick={() => setViewMode("llm")}
              className={`hf-toggle-btn hf-toggle-btn-sm ${viewMode === "llm" ? "hf-toggle-btn-active" : ""}`}
            >
              LLM
            </button>
            {prevPrompt && (
              <button
                onClick={() => setViewMode("diff")}
                className={`hf-toggle-btn hf-toggle-btn-sm ${viewMode === "diff" ? "hf-toggle-btn-active" : ""}`}
              >
                Diff
              </button>
            )}
          </div>
          <button
            onClick={runEval}
            disabled={evalLoading}
            className={`hf-btn hf-btn-xs${evalResult ? " ps-eval-btn--has-result" : ""}`}
            title="Evaluate prompt quality"
          >
            {evalLoading ? (
              <><span className="hf-spinner hf-spinner-xs" /> Evaluating...</>
            ) : evalResult ? (
              "Re-eval"
            ) : (
              "Eval"
            )}
          </button>
          <button onClick={onRefresh} className="hf-btn-icon" title="Refresh prompts">
            ↻
          </button>
        </div>
      </div>

      {/* ── Applied Changes Banner (from Prompt Tuner) ── */}
      {appliedChanges && appliedChanges.length > 0 && (
        <div className="ps-tuner-applied-banner">
          <div className="ps-tuner-applied-changes">
            {appliedChanges.map((c, i) => (
              <span key={i} className="ps-tuner-applied-chip">
                <span className="ps-tuner-applied-checkmark">&#10003;</span>
                {c.label} {c.oldValue}&rarr;{c.newValue}
              </span>
            ))}
          </div>
          {onDismissApplied && (
            <button
              className="hf-btn hf-btn-xs hf-btn-secondary"
              onClick={onDismissApplied}
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* ── Composition Inputs ── */}
      {selected.inputs && (
        <div className="ps-inputs-bar">
          {selected.inputs.memoriesCount !== undefined && (
            <span className="ps-input-chip">Memories: {selected.inputs.memoriesCount}</span>
          )}
          {selected.inputs.personalityAvailable !== undefined && (
            <span className="ps-input-chip">Personality: {selected.inputs.personalityAvailable ? "Yes" : "No"}</span>
          )}
          {selected.inputs.recentCallsCount !== undefined && (
            <span className="ps-input-chip">Recent Calls: {selected.inputs.recentCallsCount}</span>
          )}
          {selected.inputs.behaviorTargetsCount !== undefined && (
            <span className="ps-input-chip">Targets: {selected.inputs.behaviorTargetsCount}</span>
          )}
          {selected.inputs.playbooksUsed?.length > 0 && (
            <span className="ps-input-chip">Courses: {selected.inputs.playbooksUsed.join(", ")}</span>
          )}
        </div>
      )}

      {/* ── Human-Readable View ── */}
      {viewMode === "human" && (
        <div className="hf-flex-col hf-gap-lg">
          <div className="hf-code-block">{selected.prompt}</div>
          <div className="hf-flex hf-gap-sm">
            <button
              onClick={() => copyToClipboard(selected.prompt, "prompt-copy")}
              className="hf-btn-copy ps-btn-copy-dynamic"
              data-copied={copiedButton === "prompt-copy" ? "true" : undefined}
            >
              {copiedButton === "prompt-copy" ? "✓ Copied" : "📋 Copy Prompt"}
            </button>
          </div>
        </div>
      )}

      {/* ── Diff View ── */}
      {viewMode === "diff" && diffLines && (
        <div className="hf-flex-col hf-gap-lg">
          <div className="hf-text-sm hf-text-muted">
            Changes from #{(prevPrompt as any)?._idx} → #{selected._idx}
          </div>
          <div className="ps-diff-block">
            {diffLines.map((line, i) => (
              <div
                key={i}
                className={`ps-diff-line${line.type === "added" ? " ps-diff-added" : line.type === "removed" ? " ps-diff-removed" : ""}`}
              >
                <span className="ps-diff-marker">
                  {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
                </span>
                {line.text || "\u00A0"}
              </div>
            ))}
          </div>
        </div>
      )}
      {viewMode === "diff" && !prevPrompt && (
        <div className="hf-text-sm hf-text-muted">
          This is the first prompt — no previous version to compare.
        </div>
      )}

      {/* ── LLM-Friendly View ── */}
      {viewMode === "llm" && (
        <div className="hf-flex-col hf-gap-lg">
          {!llm ? (
            <div className="hf-empty-dashed">
              <div className="hf-text-md hf-text-muted">
                No structured LLM data available for this prompt.
              </div>
            </div>
          ) : (
            <>
              {/* Pretty/Raw Toggle + Copy */}
              <div className="hf-flex-between">
                <span className="hf-text-sm hf-text-muted">Structured JSON for AI agent consumption</span>
                <div className="hf-flex hf-gap-sm">
                  <div className="hf-toggle-group">
                    <button
                      onClick={() => setLlmViewMode("pretty")}
                      className={`hf-toggle-btn hf-toggle-btn-sm ${llmViewMode === "pretty" ? "hf-toggle-btn-active" : ""}`}
                    >
                      Pretty
                    </button>
                    <button
                      onClick={() => setLlmViewMode("raw")}
                      className={`hf-toggle-btn hf-toggle-btn-sm ${llmViewMode === "raw" ? "hf-toggle-btn-active" : ""}`}
                    >
                      Raw JSON
                    </button>
                  </div>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(llm, null, 2), "llm-json")}
                    className="hf-btn hf-btn-xs ps-btn-json-copy"
                    data-copied={copiedButton === "llm-json" ? "true" : undefined}
                  >
                    {copiedButton === "llm-json" ? "✓ Copied" : "📋 Copy JSON"}
                  </button>
                </div>
              </div>

              {llmViewMode === "raw" ? (
                <div className="hf-code-block-raw">{JSON.stringify(llm, null, 2)}</div>
              ) : (
                <LlmPrettyView llm={llm} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── Eval Error ── */}
      {evalError && (
        <div className="hf-banner hf-banner-error">
          Eval failed: {evalError}
          <button className="hf-btn hf-btn-xs hf-ml-sm" onClick={() => setEvalError(null)}>Dismiss</button>
        </div>
      )}

      {/* ── Eval Results Panel ── */}
      {evalResult && <EvalResultsPanel result={evalResult} onDismiss={() => setEvalResult(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eval Results Panel
// ---------------------------------------------------------------------------

function verdictClass(verdict: string): string {
  if (verdict === "strong") return "ps-eval-verdict--strong";
  if (verdict === "adequate") return "ps-eval-verdict--adequate";
  return "ps-eval-verdict--weak";
}

function EvalResultsPanel({ result, onDismiss }: { result: EvalResult; onDismiss: () => void }) {
  const [expandedDim, setExpandedDim] = useState<string | null>(null);

  return (
    <div className="ps-eval-panel">
      {/* Overall score */}
      <div className="ps-eval-overall">
        <div className="ps-eval-score-row">
          <span className="ps-eval-score-number">{result.overall.score}</span>
          <span className="ps-eval-score-of">/100</span>
          <span className={`ps-eval-verdict-badge ${verdictClass(result.overall.verdict)}`}>
            {result.overall.verdict}
          </span>
        </div>
        <div className="ps-eval-score-bar">
          <div
            className={`ps-eval-score-fill ${verdictClass(result.overall.verdict)}`}
            style={{ width: `${Math.min(result.overall.score, 100)}%` }}
          />
        </div>
        <p className="hf-text-sm hf-text-muted ps-eval-summary">{result.overall.summary}</p>
      </div>

      {/* Two-column grid */}
      <div className="ps-eval-grid">
        {/* Column 1 — Scorecard */}
        <div className="ps-eval-col">
          <h4 className="hf-heading-sm hf-mb-md">Scorecard</h4>
          <div className="hf-flex-col hf-gap-xs">
            {result.dimensions.map((dim) => {
              const isExpanded = expandedDim === dim.name;
              const hasFindings = dim.findings.length > 0 || dim.improvements.length > 0;
              return (
                <div key={dim.name} className="ps-eval-dimension">
                  <button
                    className="ps-eval-dimension-row"
                    onClick={() => hasFindings && setExpandedDim(isExpanded ? null : dim.name)}
                    disabled={!hasFindings}
                  >
                    <span className="ps-eval-dim-name">{dim.name}</span>
                    <span className="ps-eval-dim-score">{dim.score}</span>
                    <span className={`ps-eval-verdict-badge ps-eval-verdict-badge--sm ${verdictClass(dim.verdict)}`}>
                      {dim.verdict}
                    </span>
                    {hasFindings && (
                      isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="ps-eval-dimension-detail">
                      {dim.findings.length > 0 && (
                        <ul className="ps-eval-findings">
                          {dim.findings.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2 — How to Improve */}
        <div className="ps-eval-col">
          <h4 className="hf-heading-sm hf-mb-md">How to Improve</h4>
          {result.topImprovements.length === 0 ? (
            <div className="hf-banner hf-banner-success">This prompt looks great!</div>
          ) : (
            <div className="hf-flex-col hf-gap-md">
              {result.topImprovements.map((imp) => (
                <div key={imp.priority} className="ps-eval-improvement">
                  <span className="ps-eval-improvement-num">{imp.priority}</span>
                  <div className="ps-eval-improvement-body">
                    <div className="hf-text-sm hf-text-bold">{imp.title}</div>
                    <div className="hf-text-sm hf-text-muted">{imp.description}</div>
                    {imp.adminPath && (
                      <Link href={imp.adminPath} className="ps-eval-improvement-link">
                        Go to {imp.adminLabel || imp.adminPath}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ps-eval-footer">
        <button className="hf-btn hf-btn-xs hf-btn-secondary" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LLM Pretty View (extracted for readability)
// ---------------------------------------------------------------------------

function LlmPrettyView({ llm }: { llm: Record<string, any> }) {
  return (
    <div className="hf-flex-col hf-gap-md">
      {/* Memories */}
      {llm.memories && llm.memories.totalCount > 0 && (
        <div className="hf-card-compact hf-mb-0">
          <h4 className="hf-heading-sm ps-heading-cyan">
            💭 Memories ({llm.memories.totalCount})
          </h4>
          <div className="hf-flex-col hf-gap-md">
            {llm.memories.byCategory && Object.entries(llm.memories.byCategory).map(([category, items]: [string, any]) => (
              <div key={category}>
                <div className="hf-text-xs hf-text-bold hf-mb-xs" style={{ color: CATEGORY_COLORS[category]?.text || "var(--text-muted)" }}>
                  {category}
                </div>
                <div className="hf-flex-col hf-gap-xs">
                  {items.slice(0, 3).map((m: any, i: number) => (
                    <div
                      key={i}
                      className="hf-info-cell hf-text-sm"
                      style={{ background: CATEGORY_COLORS[category]?.bg || "var(--surface-secondary)" }}
                    >
                      <span className="hf-text-bold">{m.key}:</span> {m.value}
                      <span className="hf-text-xs hf-text-placeholder hf-ml-sm">
                        ({(m.confidence * 100).toFixed(0)}%)
                      </span>
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
        <div className="hf-card-compact hf-mb-0">
          <h4 className="hf-heading-sm hf-text-success">
            🎯 Behavior Targets ({llm.behaviorTargets.totalCount})
          </h4>
          <div className="hf-grid-3">
            {llm.behaviorTargets.all?.slice(0, 9).map((t: any, i: number) => (
              <div
                key={i}
                className={`hf-info-cell ${t.targetLevel === "HIGH" ? "ps-target-high" : t.targetLevel === "LOW" ? "ps-target-low" : "ps-target-neutral"}`}
              >
                <div className="hf-text-xs hf-text-500 hf-mb-xs">{t.name}</div>
                <div
                  className={`hf-text-sm hf-text-bold ${t.targetLevel === "HIGH" ? "ps-target-text-high" : t.targetLevel === "LOW" ? "ps-target-text-low" : "ps-target-text-neutral"}`}
                >
                  {t.targetLevel}
                </div>
                <div className="hf-text-xs hf-text-muted">
                  {(t.targetValue * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Call History Summary */}
      {llm.callHistory && llm.callHistory.totalCalls > 0 && (
        <div className="hf-card-compact hf-mb-0">
          <h4 className="hf-heading-sm ps-heading-indigo">
            📞 Call History ({llm.callHistory.totalCalls} calls)
          </h4>
          <div className="hf-text-sm hf-text-muted">
            Recent calls included in prompt context
          </div>
        </div>
      )}

      {/* AI Instructions */}
      {llm.instructions && (
        <div className="hf-callout-warning">
          <h4 className="hf-heading-sm hf-text-warning">📋 AI Instructions</h4>
          <div className="hf-flex-col hf-gap-sm hf-text-sm hf-text-warning">
            {llm.instructions.use_memories && (
              <div><strong>Memories:</strong> {llm.instructions.use_memories}</div>
            )}
            {llm.instructions.use_preferences && (
              <div><strong>Preferences:</strong> {llm.instructions.use_preferences}</div>
            )}
            {llm.instructions.personality_adaptation?.length > 0 && (
              <div>
                <strong>Personality Adaptation:</strong>
                <ul className="ps-adaptation-list">
                  {llm.instructions.personality_adaptation.map((tip: string, i: number) => (
                    <li key={i} className="hf-mb-xs">{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

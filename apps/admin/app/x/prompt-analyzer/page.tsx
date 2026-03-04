"use client";

import { useState, useCallback, useMemo } from "react";
import { Copy, Check, RotateCcw, X } from "lucide-react";
import { CallerPicker } from "@/components/shared/CallerPicker";
import "./prompt-analyzer.css";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface ComposedPrompt {
  id: string;
  prompt: string;
  llmPrompt: Record<string, any> | null;
  status: string;
  triggerType: string;
  composedAt: string;
}

interface SectionAnalysis {
  sectionKey: string;
  label: string;
  status: "changed" | "unchanged";
  changes: string[];
  adminSurfaces: Array<{ path: string; label: string; action: string }>;
}

interface Recommendation {
  priority: number;
  title: string;
  description: string;
  adminPath: string;
  adminLabel: string;
  sectionKeys: string[];
}

interface AnalysisResult {
  summary: string;
  sections: SectionAnalysis[];
  recommendations: Recommendation[];
}

type PageState = "empty" | "loading" | "loaded" | "analysing" | "results";

// ------------------------------------------------------------------
// Diff helper (same algorithm as PromptsSection)
// ------------------------------------------------------------------

function computeDiff(
  prev: string,
  curr: string,
): { type: "same" | "added" | "removed"; text: string }[] {
  const prevLines = prev.split("\n");
  const currLines = curr.split("\n");
  const prevSet = new Set(prevLines);
  const currSet = new Set(currLines);

  const result: { type: "same" | "added" | "removed"; text: string }[] = [];

  for (const line of prevLines) {
    if (!currSet.has(line)) {
      result.push({ type: "removed", text: line });
    }
  }

  for (const line of currLines) {
    if (prevSet.has(line)) {
      result.push({ type: "same", text: line });
    } else {
      result.push({ type: "added", text: line });
    }
  }

  return result;
}

// ------------------------------------------------------------------
// Prompt label (mirrors PromptsSection pattern)
// ------------------------------------------------------------------

function promptLabel(prompt: ComposedPrompt, index: number, total: number): string {
  if (index === 0) return "#0 Bootstrap";
  if (index === total - 1 && prompt.status === "active") return `#${index} Active (${prompt.triggerType || "manual"})`;
  if (prompt.triggerType === "pipeline") return `#${index} After Call ${index}`;
  return `#${index} ${prompt.triggerType || "manual"}`;
}

// ------------------------------------------------------------------
// Main Page
// ------------------------------------------------------------------

export default function PromptAnalyzerPage() {
  const [state, setState] = useState<PageState>("empty");
  const [error, setError] = useState<string | null>(null);

  // Caller
  const [callerId, setCallerId] = useState<string | null>(null);
  const [callerName, setCallerName] = useState<string>("");
  const [callerDomain, setCallerDomain] = useState<string>("");

  // Prompts
  const [prompts, setPrompts] = useState<ComposedPrompt[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [desiredPrompt, setDesiredPrompt] = useState("");

  // Analysis
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  // UI
  const [copied, setCopied] = useState(false);

  const selectedPrompt = prompts[selectedIdx] || null;
  const currentPrompt = selectedPrompt?.prompt || "";
  const hasChanges = desiredPrompt.trim() !== currentPrompt.trim();

  // ── Fetch prompts for caller ──
  const handleCallerSelect = useCallback(async (id: string, caller?: any) => {
    setCallerId(id);
    setCallerName(caller?.name || "");
    setCallerDomain(caller?.domain?.name || "");
    setAnalysis(null);
    setError(null);
    setState("loading");

    try {
      const res = await fetch(`/api/callers/${id}/compose-prompt?limit=50&status=all`);
      const data = await res.json();

      if (!res.ok || !data.prompts?.length) {
        setError("No composed prompts found for this caller");
        setState("loaded");
        setPrompts([]);
        return;
      }

      // Sort oldest → newest
      const sorted = [...data.prompts].sort(
        (a: ComposedPrompt, b: ComposedPrompt) =>
          new Date(a.composedAt).getTime() - new Date(b.composedAt).getTime(),
      );
      setPrompts(sorted);

      // Default to latest active, or last prompt
      const activeIdx = sorted.findLastIndex((p: ComposedPrompt) => p.status === "active");
      const idx = activeIdx >= 0 ? activeIdx : sorted.length - 1;
      setSelectedIdx(idx);
      setDesiredPrompt(sorted[idx].prompt);
      setState("loaded");
    } catch (err: any) {
      setError(err.message || "Failed to load prompts");
      setState("loaded");
    }
  }, []);

  // ── Switch prompt selection ──
  const handlePromptSwitch = useCallback(
    (idx: number) => {
      setSelectedIdx(idx);
      setDesiredPrompt(prompts[idx]?.prompt || "");
      setAnalysis(null);
    },
    [prompts],
  );

  // ── Copy to clipboard ──
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(currentPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [currentPrompt]);

  // ── Reset desired to current ──
  const handleReset = useCallback(() => {
    setDesiredPrompt(currentPrompt);
    setAnalysis(null);
  }, [currentPrompt]);

  // ── Analyse ──
  const handleAnalyse = useCallback(async () => {
    if (!callerId || !hasChanges) return;
    setState("analysing");
    setError(null);
    setAnalysis(null);

    try {
      const res = await fetch("/api/prompt-analyzer/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerId,
          currentPrompt,
          desiredPrompt,
          llmPromptJson: selectedPrompt?.llmPrompt || {},
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Analysis failed");
        setState("loaded");
        return;
      }

      setAnalysis(data.analysis);
      setState("results");
    } catch (err: any) {
      setError(err.message || "Analysis failed");
      setState("loaded");
    }
  }, [callerId, hasChanges, currentPrompt, desiredPrompt, selectedPrompt]);

  // ── Diff (memoized) ──
  const diffLines = useMemo(() => {
    if (!analysis || !hasChanges) return [];
    return computeDiff(currentPrompt, desiredPrompt);
  }, [analysis, currentPrompt, desiredPrompt, hasChanges]);

  return (
    <div className="pa-page">
      {/* Header */}
      <div className="pa-header">
        <h1 className="hf-page-title">Prompt Analyzer</h1>
        <p className="hf-page-subtitle">
          Compare a caller&apos;s composed prompt against a desired version and see what settings need to change
        </p>
      </div>

      {/* Caller bar */}
      <div className="pa-caller-bar">
        <div className="pa-caller-picker">
          <CallerPicker
            value={callerId}
            onChange={handleCallerSelect}
            placeholder="Search callers..."
          />
        </div>
        {callerName && (
          <>
            <span className="pa-caller-name">{callerName}</span>
            {callerDomain && <span className="pa-caller-domain">{callerDomain}</span>}
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="hf-banner hf-banner-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {state === "empty" && (
        <div className="pa-empty">Select a caller to load their composed prompts</div>
      )}

      {/* Loading */}
      {state === "loading" && (
        <div className="pa-empty">
          <div className="hf-spinner" />
          <p>Loading prompts...</p>
        </div>
      )}

      {/* Loaded / Analysing / Results */}
      {(state === "loaded" || state === "analysing" || state === "results") && prompts.length > 0 && (
        <>
          {/* Prompt selector */}
          <div className="pa-prompt-bar">
            <label htmlFor="pa-prompt-select" style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
              Prompt:
            </label>
            <select
              id="pa-prompt-select"
              className="pa-prompt-select"
              value={selectedIdx}
              onChange={(e) => handlePromptSwitch(Number(e.target.value))}
            >
              {prompts.map((p, i) => (
                <option key={p.id} value={i}>
                  {promptLabel(p, i, prompts.length)}
                </option>
              ))}
            </select>
            <span className="pa-prompt-meta">
              {selectedIdx + 1} of {prompts.length}
              {selectedPrompt && ` · ${new Date(selectedPrompt.composedAt).toLocaleDateString()}`}
            </span>
          </div>

          {/* Side-by-side panels */}
          <div className="pa-split">
            {/* Left: Current */}
            <div className="pa-panel">
              <div className="pa-panel-header">
                <span className="pa-panel-label">Current</span>
                <button className="hf-btn hf-btn-secondary" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <Check size={14} />
                      <span className="pa-copied">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> Copy
                    </>
                  )}
                </button>
              </div>
              <div className="pa-prompt-display">{currentPrompt || "(empty prompt)"}</div>
            </div>

            {/* Right: Desired */}
            <div className="pa-panel">
              <div className="pa-panel-header">
                <span className="pa-panel-label">Desired</span>
                {hasChanges && (
                  <button className="hf-btn hf-btn-secondary" onClick={handleReset}>
                    <RotateCcw size={14} /> Reset
                  </button>
                )}
              </div>
              <textarea
                className="pa-prompt-textarea"
                value={desiredPrompt}
                onChange={(e) => {
                  setDesiredPrompt(e.target.value);
                  if (analysis) setAnalysis(null);
                  if (state === "results") setState("loaded");
                }}
                spellCheck={false}
              />
            </div>
          </div>

          {/* Analyse button */}
          <div className="pa-analyse-bar">
            <button
              className="hf-btn hf-btn-primary"
              onClick={handleAnalyse}
              disabled={!hasChanges || state === "analysing"}
            >
              {state === "analysing" ? (
                <>
                  <div className="hf-spinner" /> Analysing...
                </>
              ) : (
                "Analyse Changes"
              )}
            </button>
          </div>

          {/* Results */}
          {state === "results" && analysis && (
            <div className="pa-results">
              <div className="pa-results-header">
                <span className="pa-results-title">Analysis</span>
                <button
                  className="hf-btn hf-btn-secondary"
                  onClick={() => setState("loaded")}
                >
                  <X size={14} /> Close
                </button>
              </div>

              {/* Summary */}
              <div className="pa-summary">{analysis.summary}</div>

              {/* Diff */}
              {diffLines.length > 0 && (
                <div className="pa-diff">
                  <div className="pa-diff-header">Diff</div>
                  {diffLines.map((line, i) => (
                    <div
                      key={i}
                      className={`pa-diff-line ${
                        line.type === "added"
                          ? "pa-diff-added"
                          : line.type === "removed"
                            ? "pa-diff-removed"
                            : "pa-diff-same"
                      }`}
                    >
                      {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}
                      {line.text || "\u00A0"}
                    </div>
                  ))}
                </div>
              )}

              {/* Sections affected */}
              <div className="pa-sections-title">Sections Affected</div>
              {analysis.sections
                .filter((s) => s.status === "changed")
                .map((section) => (
                  <div key={section.sectionKey} className="pa-section-card pa-section-changed">
                    <div className="pa-section-header">
                      <span className="pa-section-label">{section.label}</span>
                      <span className="pa-section-status pa-section-status-changed">Changed</span>
                    </div>
                    {section.changes.map((c, i) => (
                      <div key={i} className="pa-section-change">
                        · {c}
                      </div>
                    ))}
                    {section.adminSurfaces.map((surface, i) => (
                      <div key={i} className="pa-section-link">
                        → <a href={surface.path}>{surface.label}</a>: {surface.action}
                      </div>
                    ))}
                  </div>
                ))}

              {/* Unchanged sections (collapsed) */}
              {analysis.sections.filter((s) => s.status === "unchanged").length > 0 && (
                <div className="pa-section-card pa-section-unchanged">
                  <div className="pa-section-header">
                    <span className="pa-section-label">
                      {analysis.sections.filter((s) => s.status === "unchanged").length} sections unchanged
                    </span>
                    <span className="pa-section-status pa-section-status-unchanged">OK</span>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {analysis.recommendations.length > 0 && (
                <>
                  <div className="pa-recs-title">Recommendations</div>
                  {analysis.recommendations.map((rec) => (
                    <div key={rec.priority} className="pa-recommendation">
                      <div className="pa-rec-priority">{rec.priority}</div>
                      <div className="pa-rec-body">
                        <div className="pa-rec-title">{rec.title}</div>
                        <div className="pa-rec-desc">{rec.description}</div>
                        {rec.adminPath && (
                          <div className="pa-rec-link">
                            → <a href={rec.adminPath}>{rec.adminLabel || rec.adminPath}</a>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

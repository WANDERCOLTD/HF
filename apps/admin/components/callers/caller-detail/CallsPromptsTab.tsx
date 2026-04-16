"use client";

/**
 * CallsPromptsTab — call-anchored timeline merging calls + prompts + diffs.
 *
 * Each call is the primary object. Nested inside:
 * 1. Prompt used — the composed prompt active during this call
 * 2. What happened — pipeline summary (memories, mastery, TPs)
 * 3. What changed — diff between this call's prompt and the next
 *
 * Educator intent: "How do I make the next call better?"
 * Story: #175
 */

import { useState, useMemo } from "react";
import {
  ChevronDown, ChevronRight, Phone, Brain, TrendingUp,
  FileText, Diff, CheckCircle2, AlertCircle, Clock,
} from "lucide-react";
import { computeDiff } from "./PromptsSection";
import type { Call, ComposedPrompt } from "./types";
import "./calls-prompts-tab.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CallWithPrompts = Call & {
  promptUsed: ComposedPrompt | null;    // The prompt active BEFORE this call
  promptAfter: ComposedPrompt | null;   // The prompt composed AFTER this call
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

/** Join calls to their prompts using triggerCallId */
function buildTimeline(
  calls: Call[],
  prompts: ComposedPrompt[],
): { entries: CallWithPrompts[]; bootstrap: ComposedPrompt | null } {
  // Sort calls newest first
  const sorted = [...calls].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Sort prompts by composedAt ascending
  const sortedPrompts = [...prompts].sort(
    (a, b) => new Date(a.composedAt).getTime() - new Date(b.composedAt).getTime(),
  );

  // Bootstrap = first prompt with no triggerCallId
  const bootstrap = sortedPrompts.find(p => !p.triggerCallId) ?? null;

  // Build lookup: triggerCallId → prompt composed AFTER that call
  const afterCallMap = new Map<string, ComposedPrompt>();
  for (const p of sortedPrompts) {
    if (p.triggerCallId) afterCallMap.set(p.triggerCallId, p);
  }

  // For "prompt used": the prompt active at call time = the most recent prompt
  // composed BEFORE this call's createdAt
  const entries = sorted.map((call) => {
    const callTime = new Date(call.createdAt).getTime();

    // Find the latest prompt composed before this call started
    let promptUsed: ComposedPrompt | null = null;
    for (let i = sortedPrompts.length - 1; i >= 0; i--) {
      if (new Date(sortedPrompts[i].composedAt).getTime() <= callTime) {
        promptUsed = sortedPrompts[i];
        break;
      }
    }

    return {
      ...call,
      promptUsed,
      promptAfter: afterCallMap.get(call.id) ?? null,
    };
  });

  return { entries, bootstrap };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
    <div className="cpt-prompt-card">
      <button className="cpt-prompt-header" onClick={() => setExpanded(!expanded)}>
        <FileText size={13} />
        <span className="cpt-prompt-label">{label}</span>
        <span className="cpt-prompt-trigger">{prompt.triggerType}</span>
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
    const prevText = before.prompt || "";
    const currText = after.prompt || "";
    return computeDiff(prevText, currText);
  }, [expanded, before.prompt, after.prompt]);

  const addedCount = diffLines.filter(l => l.type === "added").length;
  const removedCount = diffLines.filter(l => l.type === "removed").length;

  return (
    <div className="cpt-diff-card">
      <button className="cpt-diff-header" onClick={() => setExpanded(!expanded)}>
        <Diff size={13} />
        <span>What changed for next call</span>
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type CallsPromptsTabProps = {
  calls: Call[];
  composedPrompts: ComposedPrompt[];
  callerId: string;
  processingCallIds?: Set<string>;
};

export function CallsPromptsTab({
  calls,
  composedPrompts,
  callerId,
  processingCallIds,
}: CallsPromptsTabProps) {
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  const { entries, bootstrap } = useMemo(
    () => buildTimeline(calls, composedPrompts),
    [calls, composedPrompts],
  );

  // Auto-expand most recent call
  const latestId = entries[0]?.id ?? null;
  const effectiveExpanded = expandedCallId ?? latestId;

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
      {/* Call entries — newest first */}
      {entries.map((entry, idx) => {
        const isExpanded = effectiveExpanded === entry.id;
        const isProcessing = processingCallIds?.has(entry.id);
        const callNum = entries.length - idx;

        return (
          <div key={entry.id} className={`cpt-call ${isExpanded ? "cpt-call--expanded" : ""} ${isProcessing ? "cpt-call--processing" : ""}`}>
            {/* Call header — click to expand/collapse */}
            <button
              className="cpt-call-header"
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
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="cpt-call-body">
                {/* 1. Prompt used */}
                {entry.promptUsed ? (
                  <PromptPreview prompt={entry.promptUsed} label="Prompt used" />
                ) : (
                  <div className="cpt-prompt-card cpt-prompt-card--empty">
                    <AlertCircle size={13} />
                    <span>No prompt was composed before this call</span>
                  </div>
                )}

                {/* 2. What happened — pipeline summary */}
                <PipelineSummary call={entry} />

                {/* 3. What changed for next call — diff */}
                {entry.promptUsed && entry.promptAfter && (
                  <DiffCard before={entry.promptUsed} after={entry.promptAfter} />
                )}
                {entry.promptAfter && !entry.promptUsed && (
                  <PromptPreview prompt={entry.promptAfter} label="Prompt composed after call" />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Bootstrap prompt — quiet anchor at bottom */}
      {bootstrap && (
        <div className="cpt-bootstrap">
          <PromptPreview prompt={bootstrap} label="Bootstrap (enrollment)" />
        </div>
      )}
    </div>
  );
}

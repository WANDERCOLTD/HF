"use client";

/**
 * PromptTimelineRows — single-column rows view of every prompt for a caller,
 * grouped by the triggering call. Replaces the flat timeline navigator on
 * the Tune tab so siblings (multiple ComposedPrompts with the same
 * triggerCallId) are visually obvious as indented rows under their call.
 *
 * Layout (no two-panel split — everything is rows):
 *
 *   ── Bootstrap ──
 *     ⚪ #0  bootstrap   18:00
 *        ▸ Show prompt
 *   ── Call 7  Today 14:23 ──
 *     ⚪ #19 post_call   14:25   +3/−1 vs #18    ▸ prompt  ▸ diff
 *     ⚪ #20 tuner       14:30   +1/−0 vs #19    ▸ prompt  ▸ diff
 *     ★ #25 manual      14:32   +5/−2 vs #20    ▸ prompt  ▸ diff
 *
 * Each prompt row can be expanded to reveal its body + diff + eval inline.
 * Compact / Full diff toggle is global at the top of the timeline.
 *
 * Story: #642 — multi-prompts-per-call sibling visibility.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Star, Circle, Activity, GitCompare, GitBranch, FileText, Phone, MonitorPlay, SlidersHorizontal, Sparkles, Clock, CheckCircle2, Eye, User, BarChart2 } from "lucide-react";
import { computeDiff, compactDiffEntries } from "./PromptsSection";
import type { Call, CallScore, ComposedPrompt } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPACT_DIFF_KEY = "hf-prompt-diff-compact";

/** CSS class for triggerType badge (mirrors PromptsSection mapping) */
function triggerColourClass(p: ComposedPrompt): string {
  const t = (p.triggerType || "").toLowerCase();
  if (t === "post_call" || t === "pipeline") return "ps-trigger-badge--post-call";
  if (t === "manual") return "ps-trigger-badge--manual";
  if (t === "tuner_fanout" || t === "tuner") return "ps-trigger-badge--tuner";
  if (t === "analysis_complete") return "ps-trigger-badge--analysis";
  if (t === "preview_first_call") return "ps-trigger-badge--preview";
  if (t === "scheduled") return "ps-trigger-badge--scheduled";
  if (t === "sim") return "ps-trigger-badge--sim";
  return "ps-trigger-badge--default";
}

function triggerLabel(p: ComposedPrompt): string {
  const t = (p.triggerType || "").toLowerCase();
  if (t === "post_call" || t === "pipeline") return "post call";
  if (t === "tuner_fanout") return "tuner";
  return p.triggerType || "—";
}

/** #642 — triggerType → icon. Makes it obvious where a prompt came from at a glance. */
function TriggerIcon({ p, size = 13 }: { p: ComposedPrompt; size?: number }) {
  const t = (p.triggerType || "").toLowerCase();
  const cls = "ptr-row-icon";
  if (t === "post_call" || t === "pipeline") return <Phone size={size} className={cls} />;
  if (t === "sim") return <MonitorPlay size={size} className={cls} />;
  if (t === "tuner_fanout" || t === "tuner") return <SlidersHorizontal size={size} className={cls} />;
  if (t === "enrollment") return <Sparkles size={size} className={cls} />;
  if (t === "scheduled") return <Clock size={size} className={cls} />;
  if (t === "analysis_complete") return <CheckCircle2 size={size} className={cls} />;
  if (t === "preview_first_call") return <Eye size={size} className={cls} />;
  if (t === "manual") return <User size={size} className={cls} />;
  return <FileText size={size} className={cls} />;
}

/** Group prompts by triggerCallId. null group = bootstrap. */
type Group = { callId: string | null; prompts: ComposedPrompt[] };

function groupPrompts(prompts: ComposedPrompt[]): Group[] {
  const sorted = [...prompts].sort(
    (a, b) => new Date(a.composedAt).getTime() - new Date(b.composedAt).getTime(),
  );
  const groups: Group[] = [];
  let currentCallId: string | null | undefined = undefined;
  for (const p of sorted) {
    const cid = p.triggerCallId;
    if (cid !== currentCallId) {
      groups.push({ callId: cid, prompts: [p] });
      currentCallId = cid;
    } else {
      groups[groups.length - 1].prompts.push(p);
    }
  }
  return groups;
}

/** Index every prompt with a sequential # for display */
function indexed(prompts: ComposedPrompt[]): Map<string, number> {
  const map = new Map<string, number>();
  const sorted = [...prompts].sort(
    (a, b) => new Date(a.composedAt).getTime() - new Date(b.composedAt).getTime(),
  );
  sorted.forEach((p, i) => map.set(p.id, i));
  return map;
}

/** Pick the prompt to diff against for a given row. Sibling above (in group)
 * if it exists; otherwise the previous active prompt in chronological order. */
function comparatorFor(
  prompt: ComposedPrompt,
  groupPrompts: ComposedPrompt[],
  allChrono: ComposedPrompt[],
): ComposedPrompt | null {
  const groupIdx = groupPrompts.findIndex((p) => p.id === prompt.id);
  if (groupIdx > 0) return groupPrompts[groupIdx - 1];
  // Otherwise look back chronologically
  const chronoIdx = allChrono.findIndex((p) => p.id === prompt.id);
  if (chronoIdx > 0) return allChrono[chronoIdx - 1];
  return null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Eval Types (mirrors PromptsSection)
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
// Component
// ---------------------------------------------------------------------------

interface PromptTimelineRowsProps {
  prompts: ComposedPrompt[];
  calls: Call[];
  callScores?: CallScore[];
  loading: boolean;
  onRefresh: () => void;
  callerId: string;
}

/** Delta = (toCall avg) − (fromCall avg) per parameter present in both. */
interface CallScoreDelta {
  parameterId: string;
  name: string;
  from: number;
  to: number;
  delta: number;
}

function computeCallDiff(
  fromCall: Call,
  toCall: Call,
  scoresByCall: Map<string, Map<string, { avg: number; name: string }>>,
): CallScoreDelta[] {
  const fromScores = scoresByCall.get(fromCall.id);
  const toScores = scoresByCall.get(toCall.id);
  if (!fromScores || !toScores) return [];
  const out: CallScoreDelta[] = [];
  for (const [pid, fv] of fromScores) {
    const tv = toScores.get(pid);
    if (!tv) continue;
    const delta = tv.avg - fv.avg;
    out.push({ parameterId: pid, name: fv.name || tv.name, from: fv.avg, to: tv.avg, delta });
  }
  // Sort by magnitude — largest movers first
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}

function CallDiffRow({
  fromCall,
  toCall,
  deltas,
  defaultOpen,
}: {
  fromCall: Call;
  toCall: Call;
  deltas: CallScoreDelta[];
  /** When true, the row starts expanded (used for the most-recent CALL DIFF). */
  defaultOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!defaultOpen);
  if (deltas.length === 0) return null;
  const elapsedMs = new Date(toCall.createdAt).getTime() - new Date(fromCall.createdAt).getTime();
  const elapsed = formatElapsed(elapsedMs);
  const top = deltas.slice(0, 3);
  const rest = deltas.length - top.length;
  return (
    <div className={`ptr-call-diff${expanded ? " ptr-call-diff--open" : ""}`}>
      <button
        className="ptr-call-diff-head"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        title={`Score deltas from Call ${fromCall.callSequence ?? "?"} to Call ${toCall.callSequence ?? "?"}`}
      >
        <BarChart2 size={13} />
        <span className="ptr-call-diff-label">
          Call diff · Call {fromCall.callSequence ?? "?"} → Call {toCall.callSequence ?? "?"}
        </span>
        <span className="ptr-call-diff-summary">
          {top.map((d) => (
            <span key={d.parameterId} className={`ptr-call-diff-chip${d.delta > 0 ? " ptr-call-diff-chip--up" : d.delta < 0 ? " ptr-call-diff-chip--down" : ""}`}>
              {d.name} {d.delta >= 0 ? "+" : ""}{d.delta.toFixed(2)}
            </span>
          ))}
          {rest > 0 && <span className="ptr-call-diff-more">+{rest} more</span>}
        </span>
        {elapsed && <span className="ptr-call-diff-elapsed">{elapsed} elapsed</span>}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="ptr-call-diff-body">
          <table className="ptr-call-diff-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>From</th>
                <th>To</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <tr key={d.parameterId} className={d.delta > 0 ? "ptr-row-up" : d.delta < 0 ? "ptr-row-down" : ""}>
                  <td>{d.name}</td>
                  <td>{d.from.toFixed(2)}</td>
                  <td>{d.to.toFixed(2)}</td>
                  <td className={d.delta > 0 ? "ptr-cell-up" : d.delta < 0 ? "ptr-cell-down" : ""}>
                    {d.delta >= 0 ? "+" : ""}{d.delta.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms <= 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Per-call rolled-up scores for the MVP CALL DIFF. Param → average score. */
function rollupScoresByCall(scores: CallScore[]): Map<string, Map<string, { avg: number; name: string }>> {
  const byCall = new Map<string, Map<string, { sum: number; count: number; name: string }>>();
  for (const s of scores) {
    if (!s.callId || typeof s.score !== "number") continue;
    if (!byCall.has(s.callId)) byCall.set(s.callId, new Map());
    const callMap = byCall.get(s.callId)!;
    const existing = callMap.get(s.parameterId);
    if (existing) {
      existing.sum += s.score;
      existing.count += 1;
    } else {
      callMap.set(s.parameterId, { sum: s.score, count: 1, name: s.parameter?.name || s.parameterId });
    }
  }
  // Convert sums to averages
  const out = new Map<string, Map<string, { avg: number; name: string }>>();
  for (const [callId, params] of byCall) {
    const avg = new Map<string, { avg: number; name: string }>();
    for (const [pid, v] of params) {
      avg.set(pid, { avg: v.sum / v.count, name: v.name });
    }
    out.set(callId, avg);
  }
  return out;
}

export function PromptTimelineRows({
  prompts,
  calls,
  callScores,
  loading,
  callerId,
}: PromptTimelineRowsProps) {
  const groups = useMemo(() => groupPrompts(prompts), [prompts]);
  const indexMap = useMemo(() => indexed(prompts), [prompts]);
  const chrono = useMemo(
    () => [...prompts].sort(
      (a, b) => new Date(a.composedAt).getTime() - new Date(b.composedAt).getTime(),
    ),
    [prompts],
  );
  const callsById = useMemo(() => {
    const m = new Map<string, Call>();
    for (const c of calls) m.set(c.id, c);
    return m;
  }, [calls]);
  const scoresByCall = useMemo(
    () => rollupScoresByCall(callScores ?? []),
    [callScores],
  );

  // Auto-expand the latest active prompt's row
  const latestActiveId = useMemo(() => {
    for (let i = chrono.length - 1; i >= 0; i--) {
      if (chrono[i].status === "active") return chrono[i].id;
    }
    return null;
  }, [chrono]);

  const [expandedPrompt, setExpandedPrompt] = useState<Set<string>>(() => {
    return latestActiveId ? new Set([latestActiveId]) : new Set();
  });
  const [expandedDiff, setExpandedDiff] = useState<Set<string>>(() => {
    return latestActiveId ? new Set([latestActiveId]) : new Set();
  });
  const [expandedEval, setExpandedEval] = useState<Set<string>>(new Set());
  const [llmMode, setLlmMode] = useState<Map<string, "human" | "llm">>(new Map());

  // Compact diff toggle — global, localStorage-persisted (#642)
  const [compactDiff, setCompactDiff] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COMPACT_DIFF_KEY) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COMPACT_DIFF_KEY, compactDiff ? "1" : "0");
  }, [compactDiff]);

  const toggle = useCallback((set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }, []);

  // ── Eval state (per-prompt, with AbortController per #636 pattern) ──
  const [evalResults, setEvalResults] = useState<Map<string, EvalResult>>(() => {
    const m = new Map<string, EvalResult>();
    for (const p of prompts) {
      if (p.evalResult) m.set(p.id, p.evalResult as EvalResult);
    }
    return m;
  });
  const [evalLoadingIds, setEvalLoadingIds] = useState<Set<string>>(new Set());
  const evalAbortRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    const refSnapshot = evalAbortRef.current;
    return () => {
      for (const ctrl of refSnapshot.values()) ctrl.abort();
    };
  }, []);

  const runEval = useCallback(async (promptId: string) => {
    const prior = evalAbortRef.current.get(promptId);
    prior?.abort();
    const controller = new AbortController();
    evalAbortRef.current.set(promptId, controller);
    setEvalLoadingIds((prev) => new Set(prev).add(promptId));
    try {
      const res = await fetch(`/api/callers/${callerId}/eval-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composedPromptId: promptId }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Evaluation failed");
      setEvalResults((prev) => {
        const next = new Map(prev);
        next.set(promptId, data.eval);
        return next;
      });
      setExpandedEval((prev) => new Set(prev).add(promptId));
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) return;
      // Surface a row-local error by writing a stub result — keep UI honest
      console.error("[prompt-timeline] eval failed:", err);
    } finally {
      if (evalAbortRef.current.get(promptId) === controller) {
        evalAbortRef.current.delete(promptId);
      }
      setEvalLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(promptId);
        return next;
      });
    }
  }, [callerId]);

  if (loading) {
    return <div className="hf-empty hf-text-muted">Loading prompts…</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="hf-empty-dashed">
        <div className="hf-empty-state-icon hf-mb-md">📝</div>
        <div className="hf-empty-state-title">No Prompts Yet</div>
        <div className="hf-text-sm hf-text-muted hf-mt-sm hf-empty-hint-centered">
          Run the pipeline on a call (Calls &amp; Prompts tab) to generate the first prompt. Each call also lets you re-prompt manually.
        </div>
      </div>
    );
  }

  return (
    <div className="ptr-root">
      {/* ── Toolbar (single tight strip) ── */}
      <div className="ptr-toolbar">
        <div className="ptr-toolbar-counts">
          {prompts.length} prompts · {groups.length} groups
        </div>
        <button
          type="button"
          onClick={() => setCompactDiff(!compactDiff)}
          className="ptr-toolbar-toggle"
          title={compactDiff ? "Switch to Full diff (show every line)" : "Switch to Compact diff (only added/removed)"}
          aria-pressed={compactDiff}
        >
          <GitCompare size={11} /> {compactDiff ? "Compact" : "Full"}
        </button>
      </div>

      {/* ── Groups ── */}
      {(() => {
        // Pre-compute the index of the LAST group that will render a CALL DIFF
        // row, so we can auto-expand it (most-recent state delta is what the
        // user cares about by default).
        let lastCallDiffGroupIdx = -1;
        for (let i = 1; i < groups.length; i++) {
          const a = groups[i - 1].callId ? callsById.get(groups[i - 1].callId!) : null;
          const b = groups[i].callId ? callsById.get(groups[i].callId!) : null;
          if (a && b && computeCallDiff(a, b, scoresByCall).length > 0) {
            lastCallDiffGroupIdx = i;
          }
        }
        return groups.map((group, groupIdx) => {
        const call = group.callId ? callsById.get(group.callId) : null;
        // #642 — only the FIRST chronological null-triggerCallId group is
        // a real Bootstrap (initial enrollment prompt). Later null groups
        // are standalone recomposes (sim / TUNER_FANOUT / manual / etc.)
        // and get labelled by their dominant triggerType.
        const isFirstNullGroup = group.callId == null && groups.findIndex((g) => g.callId == null) === groupIdx;
        const dominantTrigger = group.prompts[0]?.triggerType || "—";
        const header = group.callId == null
          ? (isFirstNullGroup
              ? "Bootstrap"
              : `Standalone · ${dominantTrigger.toLowerCase().replace(/_/g, " ")} · ${formatDate(group.prompts[0].composedAt)}`)
          : call
            ? `Call ${call.callSequence ?? "—"} · ${formatDate(call.createdAt)}`
            : `Triggered by call ${group.callId.slice(0, 8)}…`;

        // #642 — CALL DIFF row: state-delta between this call and the previous one.
        // Only renders when both calls have scored params we can compare.
        const prevGroup = groupIdx > 0 ? groups[groupIdx - 1] : null;
        const prevCall = prevGroup?.callId ? callsById.get(prevGroup.callId) : null;
        const callDiff = call && prevCall
          ? computeCallDiff(prevCall, call, scoresByCall)
          : null;

        // #642 — CALL EFFECT summary: input prompt (last chrono before group) → final active in group.
        // Shows the net change this call produced, regardless of how many prompts were generated.
        const firstInGroup = group.prompts[0];
        const inputPrompt = firstInGroup
          ? chrono[chrono.findIndex((p) => p.id === firstInGroup.id) - 1] ?? null
          : null;
        const activeInGroup = group.prompts.find((p) => p.status === "active") ?? group.prompts[group.prompts.length - 1];
        const callEffect = inputPrompt && activeInGroup && inputPrompt.id !== activeInGroup.id
          ? computeDiff(inputPrompt.prompt, activeInGroup.prompt)
          : null;
        const callEffectAdded = callEffect ? callEffect.filter((d) => d.type === "added").length : 0;
        const callEffectRemoved = callEffect ? callEffect.filter((d) => d.type === "removed").length : 0;

        return (
          <section key={`${group.callId ?? "bootstrap"}-${groupIdx}`} className="ptr-group">
            {/* CALL DIFF row — between consecutive call groups.
                Auto-expand the most recent one (latest state delta is what
                the user lands on the page wanting to see). */}
            {callDiff && callDiff.length > 0 && (
              <CallDiffRow
                fromCall={prevCall!}
                toCall={call!}
                deltas={callDiff}
                defaultOpen={groupIdx === lastCallDiffGroupIdx}
              />
            )}
            {/* Strengthened group header — Phone for call groups, triggerType icon
                for standalone, accent-primary border so it visually anchors the section */}
            <header className={`ptr-group-header${call ? " ptr-group-header--call" : " ptr-group-header--standalone"}`}>
              {call
                ? <Phone size={13} className="ptr-group-header-icon" />
                : group.prompts[0]
                  ? <TriggerIcon p={group.prompts[0]} size={13} />
                  : null}
              <span className="ptr-group-title">{header}</span>
              {call && (
                <span className="ptr-group-meta">
                  {call.hasScores ? "scored · " : ""}
                  {call.hasMemories ? "memories · " : ""}
                  {call.hasRewardScore ? "rewarded" : ""}
                </span>
              )}
            </header>
            {/* Group effect summary — input → final active in this group.
                Labelled "Call effect" for call groups, "Group effect" for
                standalone (sim / TUNER_FANOUT / enrollment) groups. */}
            {callEffect && inputPrompt && activeInGroup && (
              <div className="ptr-call-effect" title={`Net change from input to the active prompt after this group (${group.prompts.length} generated)`}>
                <Activity size={12} />
                <span className="ptr-call-effect-label">
                  {call ? "Call effect" : "Group effect"}
                </span>
                <span className="ptr-call-effect-from">Input #{indexMap.get(inputPrompt.id) ?? "?"}</span>
                <span className="ptr-call-effect-arrow">→</span>
                <span className="ptr-call-effect-to">Active #{indexMap.get(activeInGroup.id) ?? "?"}</span>
                <span className="ptr-diff-chip">
                  <span className="ptr-diff-chip-added">+{callEffectAdded}</span>
                  <span className="ptr-diff-chip-removed">−{callEffectRemoved}</span>
                </span>
                <span className="ptr-call-effect-note">
                  net of {group.prompts.length} generated
                </span>
              </div>
            )}
            {group.prompts.map((p) => {
              const idxN = indexMap.get(p.id) ?? -1;
              const comparator = comparatorFor(p, group.prompts, chrono);
              const compIdx = comparator ? indexMap.get(comparator.id) ?? -1 : -1;
              const isActive = p.status === "active";
              const diff = comparator ? computeDiff(comparator.prompt, p.prompt) : null;
              const added = diff ? diff.filter((d) => d.type === "added").length : 0;
              const removed = diff ? diff.filter((d) => d.type === "removed").length : 0;
              const isPromptOpen = expandedPrompt.has(p.id);
              const isDiffOpen = expandedDiff.has(p.id);
              const isEvalOpen = expandedEval.has(p.id);
              const mode = llmMode.get(p.id) ?? "human";
              const ev = evalResults.get(p.id);
              const evLoading = evalLoadingIds.has(p.id);
              const compactEntries = diff && compactDiff ? compactDiffEntries(diff) : null;
              // Inner sibling index — NOT shadowing the outer `groupIdx` (the call group's
              // position in the timeline). This is "where within this call's sibling
              // chain does the prompt sit". `siblingIdx > 0` means there's an earlier
              // sibling in the same call group → the diff is intra-call.
              const siblingIdx = group.prompts.findIndex((x) => x.id === p.id);
              const isSibling = siblingIdx > 0;
              return (
                <div key={p.id} className="ptr-pair">
                  {/* DIFF ROW — precedes the prompt row to tell the evolution story */}
                  {comparator && (
                    <div className={`ptr-diff-row${isDiffOpen ? " ptr-diff-row--open" : ""}`}>
                      <button
                        className="ptr-diff-row-head"
                        onClick={() => toggle(expandedDiff, setExpandedDiff, p.id)}
                        aria-expanded={isDiffOpen}
                        title={isDiffOpen ? "Hide diff" : "Show diff body"}
                      >
                        {isSibling ? <GitBranch size={12} /> : <GitCompare size={12} />}
                        <span className="ptr-diff-row-label">
                          {isSibling
                            ? `Sibling diff #${compIdx} → #${idxN}`
                            : `Input #${compIdx} → Generated #${idxN}`}
                        </span>
                        <span className="ptr-diff-chip">
                          <span className="ptr-diff-chip-added">+{added}</span>
                          <span className="ptr-diff-chip-removed">−{removed}</span>
                        </span>
                        <span className="ptr-diff-row-kind">
                          {isSibling ? "intra-call (sibling)" : "post-call generation"}
                        </span>
                        {isDiffOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      {isDiffOpen && diff && (
                        <div className="ptr-diff-row-body">
                          <div className="ps-diff-block">
                            {!compactDiff && diff.map((line, i) => (
                              <div
                                key={i}
                                className={`ps-diff-line${line.type === "added" ? " ps-diff-added" : line.type === "removed" ? " ps-diff-removed" : ""}`}
                              >
                                <span className="ps-diff-marker">
                                  {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
                                </span>
                                {line.text || " "}
                              </div>
                            ))}
                            {compactDiff && compactEntries && compactEntries.length === 0 && (
                              <div className="ps-diff-empty hf-text-sm hf-text-muted">
                                No changes between these two prompts.
                              </div>
                            )}
                            {compactDiff && compactEntries && compactEntries.map((entry, i) =>
                              entry.kind === "separator" ? (
                                <div key={i} className="ps-diff-separator" aria-hidden>
                                  @@ around line {entry.lineNumber} @@
                                </div>
                              ) : (
                                <div
                                  key={i}
                                  className={`ps-diff-line ${entry.type === "added" ? "ps-diff-added" : "ps-diff-removed"}`}
                                >
                                  <span className="ps-diff-marker">
                                    {entry.type === "added" ? "+" : "−"}
                                  </span>
                                  {entry.text || " "}
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PROMPT ROW — head is a div+role=button so we can nest a real
                      <button> (eval) inside without invalid HTML. Click the head
                      anywhere except the eval button toggles the prompt body. */}
                  <div className={`ptr-row${isActive ? " ptr-row--active" : ""}`}>
                    <div
                      role="button"
                      tabIndex={0}
                      className="ptr-row-head"
                      onClick={() => toggle(expandedPrompt, setExpandedPrompt, p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(expandedPrompt, setExpandedPrompt, p.id);
                        }
                      }}
                      aria-expanded={isPromptOpen}
                      title={isPromptOpen ? "Hide prompt body" : "Show prompt body"}
                    >
                      <TriggerIcon p={p} />
                      <span className="ptr-row-marker" title={isActive ? "Active — drives the next call" : "Superseded"}>
                        {isActive ? <Star size={14} className="ptr-star" /> : <Circle size={10} className="ptr-circle" />}
                      </span>
                      <span className="ptr-row-num">#{idxN}</span>
                      <span className={`hf-micro-badge hf-uppercase ${triggerColourClass(p)}`}>
                        {triggerLabel(p)}
                      </span>
                      <span className="ptr-row-time">{formatDate(p.composedAt)}</span>
                      {!isPromptOpen && p.prompt && (
                        <span className="ptr-row-preview" title={p.prompt.slice(0, 200)}>
                          {p.prompt.slice(0, 80).replace(/\s+/g, " ")}
                          {p.prompt.length > 80 ? "…" : ""}
                        </span>
                      )}
                      <span className="ptr-row-actions">
                        <button
                          type="button"
                          className={`ptr-row-action${isEvalOpen ? " ptr-row-action--open" : ""}${ev ? " ptr-row-action--has-eval" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (ev) {
                              toggle(expandedEval, setExpandedEval, p.id);
                            } else if (!evLoading) {
                              runEval(p.id);
                            }
                          }}
                          disabled={evLoading}
                          title={ev ? "Show / hide eval" : "Run quality evaluation"}
                        >
                          {evLoading ? "evaluating…" : ev ? (isEvalOpen ? "▾ eval" : "▸ eval") : "eval"}
                        </button>
                      </span>
                      {isPromptOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>

                    {/* Expanded — prompt body */}
                    {isPromptOpen && (
                      <div className="ptr-row-body">
                        <div className="ptr-body-toolbar">
                          <div className="hf-toggle-group">
                            <button
                              onClick={() => setLlmMode((prev) => new Map(prev).set(p.id, "human"))}
                              className={`hf-toggle-btn hf-toggle-btn-sm ${mode === "human" ? "hf-toggle-btn-active" : ""}`}
                            >
                              Human
                            </button>
                            <button
                              onClick={() => setLlmMode((prev) => new Map(prev).set(p.id, "llm"))}
                              className={`hf-toggle-btn hf-toggle-btn-sm ${mode === "llm" ? "hf-toggle-btn-active" : ""}`}
                            >
                              LLM
                            </button>
                          </div>
                        </div>
                        {mode === "human" ? (
                          <pre className="ptr-prompt-text">{p.prompt}</pre>
                        ) : (
                          <pre className="ptr-prompt-text">{JSON.stringify(p.llmPrompt, null, 2)}</pre>
                        )}
                      </div>
                    )}

                    {/* Expanded — eval body */}
                    {isEvalOpen && ev && (
                      <div className="ptr-row-body">
                        <div className="ptr-eval-summary">
                          <span className="ptr-eval-score">{Math.round((ev.overall.score || 0) * 100)}%</span>
                          <span className={`hf-micro-badge hf-uppercase ${ev.overall.verdict === "strong" ? "ps-status-badge-active" : "ps-status-badge-default"}`}>
                            {ev.overall.verdict}
                          </span>
                          <span className="hf-text-sm hf-text-muted">{ev.overall.summary}</span>
                        </div>
                        <ul className="ptr-eval-dims">
                          {ev.dimensions.map((d) => (
                            <li key={d.name} className={`ptr-eval-dim ptr-eval-dim--${d.verdict}`}>
                              <span className="ptr-eval-dim-name">{d.name}</span>
                              <span className="ptr-eval-dim-score">{Math.round((d.score || 0) * 100)}%</span>
                              <span className="ptr-eval-dim-verdict">{d.verdict}</span>
                            </li>
                          ))}
                        </ul>
                        {ev.topImprovements && ev.topImprovements.length > 0 && (
                          <div className="ptr-eval-improvements">
                            <div className="hf-text-xs hf-text-muted">Top improvements</div>
                            <ul>
                              {ev.topImprovements.map((imp) => (
                                <li key={imp.priority}>
                                  <strong>{imp.title}</strong> — {imp.description}
                                  {imp.adminPath && (
                                    <>
                                      {" "}
                                      <a className="ptr-eval-link" href={imp.adminPath}>
                                        {imp.adminLabel || "Open"}
                                      </a>
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      });
      })()}
    </div>
  );
}

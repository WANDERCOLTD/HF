"use client";

/**
 * Pending Changes Tray (epic #854 / Story #856).
 *
 * Non-modal tray pinned to the bottom-right of the viewport. Renders the
 * list of accumulated settings edits + two explicit recompose CTAs:
 *
 *   - "Recompose this learner" — fires only the per-caller path
 *     (`toggleCaller: true, toggleAll: false`). Disabled when
 *     `callerInContext` is null.
 *
 *   - "Recompose entire cohort" — fires only the cohort fan-out path
 *     (`toggleCaller: false, toggleAll: true`). Disabled when any entry
 *     is `aiSuggested: true` (A5 — AI safety defence-in-depth; epic #854
 *     safety property). Also disabled when no cohort is affected
 *     (`preview.count === 0`).
 *
 * Both buttons POST to the same `/api/recompose/apply` endpoint. The
 * server-side guard at `apply/route.ts:125-126` rejects
 * `aiSuggested + toggleAll` regardless of button label, so the UI gate
 * is one of five layers (see `.claude/rules/ai-to-db-guard.md`).
 *
 * Why no "Save" / "Discard all"? The tray is Model A — writes already
 * committed at push time. Labels named for transactional semantics
 * misled educators into thinking "Discard all" would roll back DB
 * state. See `docs/decisions/2026-05-26-tray-model-a-semantics.md` and
 * issue #912 for the rename rationale.
 *
 * Preview fetch:
 *   - Fired on tray open + on entry set change (debounced 500ms)
 *   - Pulls `{count, sampleNames, etaSeconds, cacheHit, source}` from
 *     `GET /api/recompose/preview` (Story #855)
 *   - SYSTEM scope or no scopeId → no fetch, count remains 0
 *
 * beforeunload:
 *   - Browser-default warning when entries.length > 0
 *   - This is best-effort — modern browsers ignore custom messages
 */

import { useEffect, useMemo, useState } from "react";
import {
  usePendingChangesTray,
  type TrayEntry,
  type TrayEntryScope,
} from "@/hooks/use-pending-changes-tray";
import { useChatContext } from "@/contexts/ChatContext";
import "./pending-changes-tray.css";

/**
 * Tray position needs to avoid the chat panel. The chat panel's per-layout
 * footprint comes from `components/chat/chat-panel.css` — these constants
 * mirror it. If chat CSS changes, update here too.
 *
 * Layouts:
 *   vertical   — chat is a 400px right-edge sidebar; tray slides left of it
 *   horizontal — chat is a 320px bottom strip; tray rises above it
 *   popout     — chat is a 420×560 floating panel at bottom-right (24,24);
 *                tray slides to its left
 */
const CHAT_VERTICAL_WIDTH = 400;
const CHAT_HORIZONTAL_HEIGHT = 320;
const CHAT_POPOUT_WIDTH = 420;
const CHAT_POPOUT_RIGHT_GAP = 24;
const TRAY_GAP = 16;

function trayOffsets(
  chatOpen: boolean,
  chatLayout: "vertical" | "horizontal" | "popout",
): { right: number; bottom: number } {
  if (!chatOpen) return { right: TRAY_GAP, bottom: TRAY_GAP };
  switch (chatLayout) {
    case "vertical":
      return { right: CHAT_VERTICAL_WIDTH + TRAY_GAP, bottom: TRAY_GAP };
    case "horizontal":
      return { right: TRAY_GAP, bottom: CHAT_HORIZONTAL_HEIGHT + TRAY_GAP };
    case "popout":
      return {
        right: CHAT_POPOUT_RIGHT_GAP + CHAT_POPOUT_WIDTH + TRAY_GAP,
        bottom: TRAY_GAP,
      };
  }
}

interface PreviewState {
  count: number;
  sampleNames: string[];
  etaSeconds: number;
  cacheHit: boolean;
  source: "live" | "counter";
}

const ZERO_PREVIEW: PreviewState = {
  count: 0,
  sampleNames: [],
  etaSeconds: 0,
  cacheHit: false,
  source: "live",
};

const PREVIEW_DEBOUNCE_MS = 500;

const COHORT_AI_BLOCKED_TOOLTIP =
  "AI-suggested changes can't fan out — recompose this learner only";

/**
 * Pick the dominant scope across all entries for the preview fetch.
 * Priority: system > domain > playbook. SYSTEM wins because a single
 * SYSTEM-spec edit affects every active caller regardless of playbook.
 */
function dominantScope(entries: TrayEntry[]): {
  scope: TrayEntryScope;
  scopeId: string | null;
} | null {
  if (entries.length === 0) return null;
  const hasSystem = entries.some((e) => e.scope === "system");
  if (hasSystem) return { scope: "system", scopeId: null };
  const domainEntry = entries.find((e) => e.scope === "domain");
  if (domainEntry) {
    return { scope: "domain", scopeId: domainEntry.scopeId };
  }
  const playbookEntry = entries.find((e) => e.scope === "playbook");
  if (playbookEntry) {
    return { scope: "playbook", scopeId: playbookEntry.scopeId };
  }
  return null;
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return "instant";
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `~${minutes}m`;
}

export function PendingChangesTray(): React.ReactElement | null {
  const { entries, callerInContext, remove, clear } = usePendingChangesTray();
  const { isOpen: chatOpen, chatLayout } = useChatContext();
  const [collapsed, setCollapsed] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(ZERO_PREVIEW);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const { right: trayRight, bottom: trayBottom } = trayOffsets(chatOpen, chatLayout);

  const hasAiSuggested = useMemo(
    () => entries.some((e) => e.aiSuggested),
    [entries],
  );

  // Preview fetch — debounced. Cancels on entry change before debounce fires.
  useEffect(() => {
    if (entries.length === 0) {
      setPreview(ZERO_PREVIEW);
      return;
    }
    const target = dominantScope(entries);
    if (!target) {
      setPreview(ZERO_PREVIEW);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ scope: target.scope });
        if (target.scopeId) params.set("scopeId", target.scopeId);
        const res = await fetch(`/api/recompose/preview?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as PreviewState;
        if (!cancelled) setPreview(data);
      } catch {
        // Silent — preview is best-effort; tray still works without it.
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entries]);

  // beforeunload warning while entries exist.
  useEffect(() => {
    if (entries.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the returned string; setting returnValue
      // is what actually triggers the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [entries.length]);

  if (entries.length === 0) return null;

  const samplePreview = preview.sampleNames.slice(0, 3).join(", ");
  const moreAffected =
    preview.count > preview.sampleNames.length
      ? ` + ${preview.count - preview.sampleNames.length} more`
      : "";

  const learnerButtonDisabled = applying || !callerInContext;
  const cohortButtonDisabled =
    applying || hasAiSuggested || preview.count === 0;
  const cohortButtonTooltip = hasAiSuggested
    ? COHORT_AI_BLOCKED_TOOLTIP
    : preview.count === 0
      ? "No affected cohort detected for these changes"
      : undefined;

  async function applyRecompose(target: "caller" | "cohort"): Promise<void> {
    setApplying(true);
    setApplyError(null);
    const decisionToggleCaller = target === "caller" && Boolean(callerInContext);
    const decisionToggleAll = target === "cohort" && !hasAiSuggested;
    try {
      const res = await fetch("/api/recompose/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries,
          toggleCaller: decisionToggleCaller,
          toggleAll: decisionToggleAll,
          callerInContext,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Apply failed (${res.status})`);
      }
      // #873 follow-up — emit bidirectional reflection event BEFORE
      // clearing the tray so we still have entry data.
      const snapshot = entries.map((e) => ({
        label: e.label,
        scopeLabel: e.scopeLabel,
        beforeValue: e.beforeValue,
        afterValue: e.afterValue,
      }));
      window.dispatchEvent(
        new CustomEvent("hf:tray-applied", {
          detail: {
            entries: snapshot,
            toggleCaller: decisionToggleCaller,
            toggleAll: decisionToggleAll,
            callerInContext: callerInContext?.name ?? null,
            decidedAt: new Date().toISOString(),
          },
        }),
      );
      clear();
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className="hf-pending-tray"
      data-testid="pending-changes-tray"
      style={
        {
          // Position-aware offsets — avoid the chat panel when open.
          // Static `right`/`bottom` would collide with the chat sidebar.
          "--hf-tray-right": `${trayRight}px`,
          "--hf-tray-bottom": `${trayBottom}px`,
        } as React.CSSProperties
      }
    >
      <div className="hf-pending-tray-header">
        <span className="hf-pending-tray-count">
          {entries.length} pending change{entries.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className="hf-pending-tray-collapse"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand pending changes" : "Hide pending changes"}
        >
          {collapsed ? "show" : "hide"}
        </button>
      </div>

      {!collapsed && (
        <>
          <ul className="hf-pending-tray-list">
            {entries.map((e) => (
              <li key={e.id} className="hf-pending-tray-entry">
                <div className="hf-pending-tray-entry-main">
                  <span className="hf-pending-tray-scope">{e.scopeLabel}</span>
                  <span className="hf-pending-tray-label">{e.label}</span>
                  <span className="hf-pending-tray-diff">
                    {e.beforeValue} → {e.afterValue}
                  </span>
                  {e.aiSuggested && (
                    <span className="hf-pending-tray-ai-badge">AI</span>
                  )}
                </div>
                <button
                  type="button"
                  className="hf-pending-tray-remove"
                  onClick={() => remove(e.id)}
                  aria-label={`Dismiss ${e.label}`}
                  title="Dismiss"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          {preview.count > 0 && (
            <div className="hf-pending-tray-cohort-info">
              <span>
                Cohort affected: {preview.count} learner
                {preview.count === 1 ? "" : "s"} ({formatEta(preview.etaSeconds)})
                {samplePreview && (
                  <span className="hf-pending-tray-sample">
                    {" "}— {samplePreview}{moreAffected}
                  </span>
                )}
              </span>
            </div>
          )}

          {hasAiSuggested && (
            <p className="hf-pending-tray-ai-warning">
              ⚠ AI-suggested change present — cohort recompose is disabled.
            </p>
          )}

          {/* #1546 — DOMAIN-scope writes fan out across every course in
             the domain. This is the human gate (per Epic #1442 ADR §3.4
             — "ScopePicker copy" — and the cascade-honesty contract).
             Render once even when multiple DOMAIN entries are queued so
             the warning isn't drowned out. */}
          {entries.some((e) => e.scope === "domain") && (
            <p className="hf-pending-tray-ai-warning" data-testid="hf-pending-tray-domain-warning">
              ⚠ Affects every course in this domain. All enrolled learners across
              the domain will receive updated settings on their next call.
            </p>
          )}

          {/* Dead-end-state reassurance (#1442 Layer 4 follow-on).
             When both recompose buttons are disabled, the operator could
             think nothing applied. In fact the underlying config write
             already happened inline (e.g. apply_demo_preset called
             updatePlaybookConfig directly) — the tray's recompose buttons
             only proactively rebuild prompts for *existing* learners. The
             next call from any learner picks up the new config via the
             stale-check. Surface that explicitly. */}
          {hasAiSuggested && learnerButtonDisabled && cohortButtonDisabled && (
            <div
              className="hf-pending-tray-config-saved"
              data-testid="hf-pending-tray-config-saved"
            >
              <p>
                ✓ Course config is already saved. The next call from any
                learner will use the new settings.
              </p>
              {!callerInContext && (
                <p className="hf-pending-tray-config-saved-cta">
                  To rebuild a specific learner&apos;s prompt now, open them
                  in <code>/x/sim/&lt;callerId&gt;</code> or
                  <code>/x/callers/&lt;callerId&gt;</code> and click
                  &ldquo;Recompose this learner&rdquo;.
                </p>
              )}
              <button
                type="button"
                className="hf-pending-tray-config-saved-dismiss"
                onClick={() => clear()}
                disabled={applying}
              >
                Got it — dismiss
              </button>
            </div>
          )}

          {applyError && (
            <p className="hf-pending-tray-ai-warning" role="alert">
              ⚠ {applyError}
            </p>
          )}

          <div className="hf-pending-tray-actions">
            <button
              type="button"
              className="hf-pending-tray-recompose-learner"
              disabled={learnerButtonDisabled}
              title={
                !callerInContext
                  ? "Open a learner to recompose just their prompt"
                  : undefined
              }
              onClick={() => applyRecompose("caller")}
            >
              {applying ? "Applying…" : "Recompose this learner"}
            </button>
            <button
              type="button"
              className="hf-pending-tray-recompose-cohort"
              disabled={cohortButtonDisabled}
              title={cohortButtonTooltip}
              onClick={() => applyRecompose("cohort")}
            >
              {applying ? "Applying…" : "Recompose entire cohort"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

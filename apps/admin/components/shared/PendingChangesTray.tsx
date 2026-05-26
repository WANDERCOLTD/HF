"use client";

/**
 * Pending Changes Tray (epic #854 / Story #856).
 *
 * Non-modal tray pinned to the bottom-right of the viewport. Renders the
 * list of accumulated settings edits + the asymmetric-default toggles +
 * Save & apply / Discard all actions.
 *
 * Toggle 1 — "Also recompose <caller name>":
 *   - Visible only when `callerInContext !== null`
 *   - Default ON (asymmetric — single-caller recompose is cheap + expected)
 *
 * Toggle 2 — "Recompose all N affected learners":
 *   - Default OFF (the safety property of this epic)
 *   - Hidden when N = 0
 *   - **Disabled** when any entry is `aiSuggested: true` (A5 — AI safety
 *     defence-in-depth)
 *   - **Pre-checked ON** when any entry's `key` is in
 *     `FANOUT_CLASS_PLAYBOOK_KEYS` (A6 — preserves the historical
 *     `recompose: true` behaviour for mastery-threshold-class knobs).
 *     Still user-overridable to OFF.
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
import {
  shouldPreCheckFanout,
} from "@/lib/recompose/fanout-class-keys";
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
  const [toggleCaller, setToggleCaller] = useState(true);
  const [toggleAll, setToggleAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { right: trayRight, bottom: trayBottom } = trayOffsets(chatOpen, chatLayout);

  const hasAiSuggested = useMemo(
    () => entries.some((e) => e.aiSuggested),
    [entries],
  );
  const preCheckAll = useMemo(
    () => shouldPreCheckFanout(entries.map((e) => e.key)),
    [entries],
  );

  // Toggle defaults derive from the current state, not a one-time mount.
  // When entries flip from non-fanout-class → fanout-class, Toggle 2's
  // default flips ON. The user can still override with an explicit click.
  // Track whether the user has manually touched Toggle 2 — if so, respect
  // their choice over the derived default.
  const [toggleAllUserTouched, setToggleAllUserTouched] = useState(false);
  useEffect(() => {
    if (toggleAllUserTouched) return;
    setToggleAll(preCheckAll);
  }, [preCheckAll, toggleAllUserTouched]);

  // AI-mixed defence-in-depth: force OFF + lock regardless of pre-check.
  const toggle2Locked = hasAiSuggested;
  const effectiveToggleAll = toggle2Locked ? false : toggleAll;

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
                  aria-label={`Remove ${e.label} from pending changes`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div className="hf-pending-tray-toggles">
            {callerInContext && (
              <label className="hf-pending-tray-toggle">
                <input
                  type="checkbox"
                  checked={toggleCaller}
                  onChange={(e) => setToggleCaller(e.target.checked)}
                />
                <span>
                  Also recompose {callerInContext.name} now (~2s)
                </span>
              </label>
            )}

            {preview.count > 0 && (
              <label
                className={`hf-pending-tray-toggle ${toggle2Locked ? "is-locked" : ""}`}
                title={
                  toggle2Locked
                    ? "AI-suggested changes cannot trigger a full cohort recompose. Save without Toggle 2, then enable manually if needed."
                    : preCheckAll
                      ? "Pre-checked — this change historically fanned out to the full cohort automatically."
                      : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={effectiveToggleAll}
                  disabled={toggle2Locked}
                  onChange={(e) => {
                    setToggleAllUserTouched(true);
                    setToggleAll(e.target.checked);
                  }}
                />
                <span>
                  Recompose all {preview.count} affected learner
                  {preview.count === 1 ? "" : "s"} ({formatEta(preview.etaSeconds)})
                  {samplePreview && (
                    <span className="hf-pending-tray-sample">
                      {" "}— {samplePreview}{moreAffected}
                    </span>
                  )}
                </span>
              </label>
            )}

            {toggle2Locked && (
              <p className="hf-pending-tray-ai-warning">
                ⚠ AI-suggested change present — cohort fanout is disabled.
              </p>
            )}
          </div>

          {saveError && (
            <p className="hf-pending-tray-ai-warning" role="alert">
              ⚠ {saveError}
            </p>
          )}

          <div className="hf-pending-tray-actions">
            <button
              type="button"
              className="hf-pending-tray-discard"
              onClick={clear}
              disabled={saving}
            >
              Discard all
            </button>
            <button
              type="button"
              className="hf-pending-tray-save"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setSaveError(null);
                try {
                  const res = await fetch("/api/recompose/apply", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      entries,
                      toggleCaller: Boolean(callerInContext) && toggleCaller,
                      toggleAll: !toggle2Locked && effectiveToggleAll,
                      callerInContext,
                    }),
                  });
                  const json = (await res.json()) as { ok?: boolean; error?: string };
                  if (!res.ok || !json.ok) {
                    throw new Error(json.error || `Apply failed (${res.status})`);
                  }
                  clear();
                  // Reset toggle state for next batch
                  setToggleAllUserTouched(false);
                } catch (err: unknown) {
                  setSaveError(err instanceof Error ? err.message : String(err));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Applying…" : "Save & apply"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * #1744 (epic #1700 Theme 3) — sticky pinned-card slot above SimChat.
 *
 * Renders the cue card (Part 2) or topic-focus banner (Part 3 / Mock
 * sub-phases) the learner needs visible throughout prep + monologue +
 * discussion. Source of truth is `Session.metadata.pinnedCard` written
 * at session-start by `createSession` (#1733) under the same selection
 * policy the prompt-side composer uses.
 *
 * Fetch: one-shot `GET /api/calls/[callId]/pinned-card` when the
 * supplied `callId` becomes available (a sim `[Talk Here]` click). The
 * card never changes mid-session — no SSE / polling, and the expand
 * path after collapse reuses the in-memory `card` state (no refetch).
 *
 * Render variants by `kind`:
 *   - "cueCard":   topic + bullets + optional secondaryNote
 *   - "topicFocus": topic + optional focusArea (single-line)
 *
 * Collapse / restore (#2227, U8 of #2185): clicking ✕ (or pressing Esc)
 * collapses the card to a small persistent chip in the same slot region.
 * Clicking the chip expands the card back to full view. Esc toggles
 * between the two states. The pre-#2227 "hard dismiss" is gone — the
 * card can no longer become unrecoverable during a session.
 *
 * Collapse persistence (UX-C / Finding 3): the collapsed state is
 * persisted to `sessionStorage` keyed by `callId`. Reloads or
 * intra-session navigation within the same tab restore the learner's
 * last-chosen state instead of snapping back to expanded. A fresh
 * `callId` clears any stored state for the previous call (the per-key
 * design makes this implicit — the new key has no entry).
 *
 * Fetch-failure surfacing (UX-C / Finding 6): the fetch's catch block
 * emits a `[pinned_card.fetch_failed]` console warning so operators see
 * a signal even though the learner's UI stays subtle. When
 * `showErrorFallback` is enabled the slot renders a tiny "Card
 * temporarily unavailable" line instead of silently rendering null —
 * still subtle, but no longer invisible.
 *
 * Phase-scope (UX-C / Finding 10): when `phaseScope` is supplied (e.g.
 * `["p2_prep", "p2_monologue"]`), the slot auto-hides during phases NOT
 * in the list. When unset, the pin is visible until `phaseEnded` flips
 * true. Phase strings are course-agnostic — the SimChat host derives
 * them from `Session.metadata.phaseBoundaries` and the current cue
 * scheduler position.
 *
 * Auto-clear: when `phaseEnded` flips true (callPhase === "ended" /
 * "wrapping" at the consumer), neither the card nor the chip renders.
 */

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { PinnedCardContent } from "@/lib/types/json-fields";

const STORAGE_KEY_BASE = "hf:sim:pin-collapsed";

interface PinnedCardSlotProps {
  callId: string | null;
  /** When true, the slot renders null regardless of fetched state. */
  phaseEnded: boolean;
  /**
   * Current session phase (e.g. `"p2_prep"`, `"p2_monologue"`,
   * `"p3"`). Optional — when unset the slot ignores phase scoping and
   * relies solely on `phaseEnded`.
   */
  currentPhase?: string | null;
  /**
   * Optional list of phases during which the pin should be visible.
   * Unset → all phases (legacy default). Set + currentPhase NOT in
   * list → slot hides. Read from `AuthoredModuleSettings.pinnedCardPhaseScope`
   * by the SimChat host.
   */
  phaseScope?: string[];
  /**
   * UX-C / Finding 6 — when true, render a subtle "Card temporarily
   * unavailable" line on fetch failure instead of returning null. The
   * console warning fires regardless; this prop only controls the
   * learner-visible surface. Defaults to false to preserve pre-UX-C
   * silent-on-failure behaviour for callers that haven't opted in.
   */
  showErrorFallback?: boolean;
}

/**
 * Resolve the sessionStorage key for a given callId. Returns null when
 * no callId or sessionStorage is unavailable (SSR / sandboxed runtime).
 */
function readStoredCollapsed(callId: string | null): boolean | null {
  if (!callId) return null;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(
      `${STORAGE_KEY_BASE}:${callId}`,
    );
    if (stored === null) return null;
    return stored === "true";
  } catch {
    // sessionStorage may be disabled (Safari private browsing pre-15,
    // strict cookie blockers). Fall back to ephemeral state.
    return null;
  }
}

function writeStoredCollapsed(callId: string | null, value: boolean): void {
  if (!callId) return;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `${STORAGE_KEY_BASE}:${callId}`,
      String(value),
    );
  } catch {
    // Silent — sessionStorage write failures are non-fatal.
  }
}

export function PinnedCardSlot({
  callId,
  phaseEnded,
  currentPhase = null,
  phaseScope,
  showErrorFallback = false,
}: PinnedCardSlotProps): React.ReactElement | null {
  const [card, setCard] = useState<PinnedCardContent | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readStoredCollapsed(callId) ?? false,
  );
  const [fetchFailed, setFetchFailed] = useState(false);

  // On callId change, hydrate from sessionStorage (or default to
  // expanded). Reset card + failure state — a new call earns a fresh
  // fetch + a fresh card.
  useEffect(() => {
    setCard(null);
    setFetchFailed(false);
    setCollapsed(readStoredCollapsed(callId) ?? false);
  }, [callId]);

  // Persist collapse state across navigation within the same call.
  useEffect(() => {
    writeStoredCollapsed(callId, collapsed);
  }, [callId, collapsed]);

  useEffect(() => {
    if (!callId) return;
    const controller = new AbortController();
    fetch(`/api/calls/${encodeURIComponent(callId)}/pinned-card`, {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { card?: PinnedCardContent | null } | null) => {
        if (!body) return;
        setCard(body.card ?? null);
        setFetchFailed(false);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        // UX-C / Finding 6 — surface to operator telemetry. Console
        // warning is best-effort; if a future AppLog client wrapper
        // exists for the learner-UI tier, route through that instead.
        console.warn("[pinned_card.fetch_failed]", {
          callId,
          err: (err as Error)?.message ?? String(err),
        });
        setFetchFailed(true);
      });
    return () => controller.abort();
  }, [callId]);

  const handleToggle = useCallback(() => setCollapsed((prev) => !prev), []);

  useEffect(() => {
    if (!card || phaseEnded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, phaseEnded, handleToggle]);

  // UX-C / Finding 10 — phase-scope gate. When scope is set and the
  // current phase isn't in it, hide the slot. Out-of-scope is treated
  // as `phaseEnded` for purposes of rendering; we don't drop the
  // stored card so re-entering an in-scope phase restores naturally.
  const outOfPhaseScope = useMemo(() => {
    if (!phaseScope || phaseScope.length === 0) return false;
    if (!currentPhase) return false;
    return !phaseScope.includes(currentPhase);
  }, [phaseScope, currentPhase]);

  if (phaseEnded || outOfPhaseScope) return null;

  // Honest error surface — render only when explicitly opted in.
  if (fetchFailed && !card) {
    if (!showErrorFallback) return null;
    return (
      <div
        className="hf-pinned-card-fallback"
        role="status"
        data-testid="pinned-card-fetch-fallback"
      >
        Card temporarily unavailable
      </div>
    );
  }

  if (!card) return null;

  if (collapsed) {
    const restoreLabel =
      card.kind === "cueCard" ? "Show cue card" : "Show topic focus";
    return (
      <button
        type="button"
        className="hf-pinned-card-restore"
        aria-label={restoreLabel}
        data-testid="pinned-card-restore-chip"
        onClick={handleToggle}
      >
        <span className="hf-pinned-card-restore-icon" aria-hidden="true">
          📌
        </span>
        <span className="hf-pinned-card-restore-label">{card.topic}</span>
      </button>
    );
  }

  if (card.kind === "cueCard") {
    return (
      <div
        className="hf-pinned-card hf-pinned-card-cue"
        role="region"
        aria-label="Pinned cue card"
        data-testid="pinned-card-slot"
      >
        <button
          type="button"
          className="hf-pinned-card-dismiss"
          aria-label="Collapse pinned card"
          onClick={handleToggle}
        >
          ✕
        </button>
        <div className="hf-pinned-card-topic">{card.topic}</div>
        {card.bullets && card.bullets.length > 0 ? (
          <ul className="hf-pinned-card-bullets">
            {card.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
        {card.secondaryNote ? (
          <div className="hf-pinned-card-note">{card.secondaryNote}</div>
        ) : null}
      </div>
    );
  }

  // kind === "topicFocus"
  return (
    <div
      className="hf-pinned-card hf-pinned-card-focus"
      role="region"
      aria-label="Pinned topic focus"
      data-testid="pinned-card-slot"
    >
      <button
        type="button"
        className="hf-pinned-card-dismiss"
        aria-label="Collapse pinned card"
        onClick={handleToggle}
      >
        ✕
      </button>
      <span className="hf-pinned-card-topic">{card.topic}</span>
      {card.focusArea ? (
        <span className="hf-pinned-card-focus-area"> — {card.focusArea}</span>
      ) : null}
    </div>
  );
}

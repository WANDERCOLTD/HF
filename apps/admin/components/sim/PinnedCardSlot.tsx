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
 * Auto-clear: when `phaseEnded` flips true (callPhase === "ended" /
 * "wrapping" at the consumer), neither the card nor the chip renders.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { PinnedCardContent } from "@/lib/types/json-fields";

interface PinnedCardSlotProps {
  callId: string | null;
  /** When true, the slot renders null regardless of fetched state. */
  phaseEnded: boolean;
}

export function PinnedCardSlot({
  callId,
  phaseEnded,
}: PinnedCardSlotProps): React.ReactElement | null {
  const [card, setCard] = useState<PinnedCardContent | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Reset collapse when callId changes — a new call earns a fresh card.
  useEffect(() => {
    setCollapsed(false);
    setCard(null);
  }, [callId]);

  useEffect(() => {
    if (!callId) return;
    const controller = new AbortController();
    fetch(`/api/calls/${encodeURIComponent(callId)}/pinned-card`, {
      signal: controller.signal,
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { card?: PinnedCardContent | null } | null) => {
        if (!body) return;
        setCard(body.card ?? null);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        // Best-effort — silent on failure (the slot simply renders null).
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

  if (!card || phaseEnded) return null;

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

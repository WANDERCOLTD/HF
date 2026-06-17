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
 * card never changes mid-session — no SSE / polling.
 *
 * Render variants by `kind`:
 *   - "cueCard":   topic + bullets + optional secondaryNote
 *   - "topicFocus": topic + optional focusArea (single-line)
 *
 * Dismissibility: Esc key removes the card for the rest of the session
 * (does not refetch on the next render). The learner can also call this
 * a "soft" hide by clicking the ✕ button.
 *
 * Auto-clear: when `phaseEnded` flips true (callPhase === "ended" /
 * "wrapping" at the consumer), the card stops rendering.
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
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when callId changes — a new call earns a fresh card.
  useEffect(() => {
    setDismissed(false);
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

  const handleDismiss = useCallback(() => setDismissed(true), []);

  useEffect(() => {
    if (!card || dismissed || phaseEnded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, dismissed, phaseEnded, handleDismiss]);

  if (!card || dismissed || phaseEnded) return null;

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
          aria-label="Dismiss pinned card"
          onClick={handleDismiss}
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
        aria-label="Dismiss pinned card"
        onClick={handleDismiss}
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

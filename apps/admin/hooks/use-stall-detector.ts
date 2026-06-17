/**
 * #1743 (epic #1700 Theme 2b) — client-side stall detector.
 *
 * Watches `lastSpeechAt` (ms epoch — bumped on every `transcript-partial`
 * SSE event). When the gap from the last speech to "now" exceeds
 * `silenceMs`, picks the next scaffold line from `pool` and surfaces it
 * via the returned `chip` value. The chip clears on the next
 * `lastSpeechAt` bump.
 *
 * Cooldown: after a chip fires, subsequent fires are throttled by
 * `cooldownMs` so a long silence doesn't flood the surface.
 *
 * Scaffold selection is round-robin by fire count — deterministic so the
 * same conversation surface sees the same sequence on replay.
 *
 * Voice impact: ZERO. This is purely a visual chip. The cue scheduler
 * (#1742) is the only path that can drive `sayMessage()`; this hook does
 * not call into the cue scheduler.
 *
 * Polling primitive: a single `setTimeout` inside a `useEffect`, cleared
 * on every dependency change. Not a while/for retry loop — clears the
 * `no-bespoke-async-polling` rule (which fires only inside iteration
 * statements).
 */

import { useEffect, useRef, useState } from "react";

export interface UseStallDetectorArgs {
  /** When false (e.g. callPhase !== "active") the hook is inert. */
  enabled: boolean;
  /** ms epoch of the most recent learner/tutor speech. `null` = no speech yet. */
  lastSpeechAt: number | null;
  /** Scaffold lines for the current module. Empty array disables. */
  pool: string[];
  /** Silence window before the chip fires. Default 10 000 ms. */
  silenceMs?: number;
  /** Minimum gap between chip fires. Default 10 000 ms. */
  cooldownMs?: number;
  /** Override `Date.now` for tests. */
  now?: () => number;
}

export interface UseStallDetectorResult {
  /** Scaffold line to render, or `null` when no chip should be shown. */
  chip: string | null;
}

const DEFAULT_SILENCE_MS = 10_000;
const DEFAULT_COOLDOWN_MS = 10_000;

interface ActiveChip {
  text: string;
  shownAt: number;
}

export function useStallDetector(args: UseStallDetectorArgs): UseStallDetectorResult {
  const {
    enabled,
    lastSpeechAt,
    pool,
    silenceMs = DEFAULT_SILENCE_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    now = Date.now,
  } = args;

  // Single setState site (the timer callback). The "clear on speech"
  // semantic is expressed by deriving `chip` from `activeChip.shownAt`
  // vs `lastSpeechAt` at render time — no setState-in-effect cascade.
  const [activeChip, setActiveChip] = useState<ActiveChip | null>(null);
  const fireCountRef = useRef(0);
  const lastFiredAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || pool.length === 0) return;

    const anchor = lastSpeechAt ?? now();
    const elapsed = now() - anchor;
    const remaining = Math.max(0, silenceMs - elapsed);

    const handle = setTimeout(() => {
      const t = now();
      const lastFired = lastFiredAtRef.current;
      if (lastFired !== null && t - lastFired < cooldownMs) return;
      const index = fireCountRef.current % pool.length;
      const line = pool[index];
      if (typeof line === "string" && line.trim().length > 0) {
        setActiveChip({ text: line, shownAt: t });
        lastFiredAtRef.current = t;
        fireCountRef.current += 1;
      }
    }, remaining);

    return () => clearTimeout(handle);
  }, [enabled, lastSpeechAt, pool, silenceMs, cooldownMs, now]);

  // Strict `>` so a fresh speech bump at the same ms epoch as the
  // chip-fire (the test (4) shape — VAPI delivers the next partial in
  // the same tick) reads as "speech after chip" and hides the chip.
  const chipVisible =
    activeChip !== null &&
    enabled &&
    (lastSpeechAt === null || activeChip.shownAt > lastSpeechAt);
  return { chip: chipVisible ? activeChip.text : null };
}

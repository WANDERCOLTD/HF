"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { isFocusBlocked } from "@/lib/help/isFocusBlocked";
import type { ChordBinding } from "@/lib/help/page-help";

interface ChordOptions {
  /** Accepted bare prefix keys (case-insensitive). Default: ["h", "g"]. */
  prefixKeys?: string[];
  /** Timeout in ms before a partial chord resets. Default: 1500. */
  timeoutMs?: number;
}

interface ChordState {
  /** Active prefix while waiting for the second key, null otherwise. */
  activePrefix: string | null;
}

/**
 * Chord shortcut engine — listens for `<prefix> <key>` sequences, e.g.
 *   H + C  → navigate to the Content tab
 *   G + L  → navigate to Learners
 *
 * Bare keypresses only — `Cmd+H` / `Cmd+G` are not intercepted. The first key
 * "soft arms" the chord (no preventDefault), the second key consumes the
 * input only if it resolves to a binding. Unmatched second keys reset
 * silently.
 *
 * Pages mount this hook with the ChordBinding[] for their route from
 * lib/help/page-help.ts. Navigate-action chords push the href; callback-
 * action chords dispatch a custom event `hf:chord:{callbackId}` that the
 * page listens for (avoids prop-drilling setActiveTab through the tree).
 */
export function useChordShortcut(
  chords: ChordBinding[] | undefined,
  options: ChordOptions = {},
): ChordState {
  const router = useRouter();
  // Memoise so the effect's dep array doesn't see a fresh array every render
  // — without this, every state update tears down the listener AND clears
  // the in-flight chord timer.
  const prefixKeys = useMemo(
    () => (options.prefixKeys ?? ["h", "g"]).map((k) => k.toLowerCase()),
    [options.prefixKeys],
  );
  const timeoutMs = options.timeoutMs ?? 1500;

  // Mirror activePrefix into a ref so the keydown handler always sees the
  // current value — without a ref, two synchronous keypresses (e.g. test
  // act() blocks, or fast typists) read a stale closure and the second key
  // is mistakenly treated as a first key.
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const activePrefixRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armPrefix = useCallback((prefix: string | null) => {
    activePrefixRef.current = prefix;
    setActivePrefix(prefix);
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    armPrefix(null);
  }, [armPrefix]);

  useEffect(() => {
    if (!chords || chords.length === 0) return;

    const handle = (e: KeyboardEvent) => {
      // Skip when typing or when a dialog is open. Dialogs include the help
      // overlay, prereq modals, etc.
      if (isFocusBlocked(e)) return;
      if (document.querySelector('[role="dialog"]')) return;

      // Only bare keypresses — modifiers route to other handlers
      // (Cmd+G → /x/get-started-v5 via app/layout.tsx:148-160 etc.).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const current = activePrefixRef.current;

      // Escape resets any pending chord.
      if (e.key === "Escape" && current) {
        reset();
        return;
      }

      // First key: prefix-arm.
      if (current === null) {
        if (prefixKeys.includes(key)) {
          // Soft arm — do NOT preventDefault. Per the issue's coexistence
          // note, the prefix must remain a no-op for any other handler.
          armPrefix(key.toUpperCase());
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            armPrefix(null);
            timerRef.current = null;
          }, timeoutMs);
        }
        return;
      }

      // Second key: resolve against bindings.
      const upperKey = key.toUpperCase();
      const match = chords.find((c) => c.keys.toUpperCase() === upperKey);
      if (!match) {
        // Unmapped key — reset silently. The educator will see the chord
        // badge disappear; no error.
        reset();
        return;
      }

      // Consume the chord — both pre and stop now that we have a real action.
      e.preventDefault();
      e.stopPropagation();
      reset();

      if (match.action === "navigate" && match.href) {
        router.push(match.href);
      } else if (match.action === "callback" && match.callbackId) {
        // Pages listen for `hf:chord:tab:<id>` and call their setActiveTab.
        window.dispatchEvent(new CustomEvent(`hf:chord:${match.callbackId}`));
      }
    };

    window.addEventListener("keydown", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [chords, prefixKeys, timeoutMs, armPrefix, reset, router]);

  return { activePrefix };
}

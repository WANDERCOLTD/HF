"use client";

/**
 * CommandPalette — Phase 5 of epic #1675.
 *
 * Cmd+K / Ctrl+K opens a search-as-you-type palette over BOTH the
 * journey registry (45) AND the voice registry (11). 56 settings
 * indexed in a single pass; substring match on
 * `educatorLabel + group + storagePath`.
 *
 * Selecting a result calls `setSettingId` from `useJourneySelection`,
 * which mounts the contract's `JourneyField` in the Inspector pane.
 *
 * Slice A scope: palette is mounted by the Journey-tab shell only. A
 * Phase 5 Slice B follow-up will hoist activation to the page level so
 * the palette works from any tab.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

import "./command-palette.css";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (settingId: string) => void;
}

const ALL_SETTINGS: readonly JourneySettingContract[] = [
  ...JOURNEY_SETTINGS,
  ...VOICE_SETTINGS,
];

/** Exposed for the count-pin vitest. */
export const COMMAND_PALETTE_INDEX_SIZE = ALL_SETTINGS.length;

function pathString(c: JourneySettingContract): string {
  return typeof c.storagePath === "string" ? c.storagePath : c.storagePath.path;
}

function matchScore(c: JourneySettingContract, q: string): number {
  if (!q) return 0;
  const haystack = `${c.educatorLabel} ${c.group} ${pathString(c)}`.toLowerCase();
  const needle = q.toLowerCase();
  if (!haystack.includes(needle)) return -1;
  // Prefer label matches (lower index in label = better).
  const labelIdx = c.educatorLabel.toLowerCase().indexOf(needle);
  if (labelIdx >= 0) return labelIdx;
  // Otherwise rank by overall position in haystack.
  return 100 + haystack.indexOf(needle);
}

export function CommandPalette({
  open,
  onClose,
  onSelect,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) {
      // Default view: first 20 settings by group order.
      return ALL_SETTINGS.slice(0, 20);
    }
    const scored = ALL_SETTINGS.map((c) => ({ c, score: matchScore(c, query) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c);
    return scored.slice(0, 20);
  }, [query]);

  // Reset query + focus the input when the palette opens. We use a
  // key-based reset via `useMemo` to derive the input focus / scroll
  // side-effect from the `open` prop transition rather than calling
  // setState inside useEffect.
  useEffect(() => {
    if (!open) return;
    // Focus the input on mount; rAF so the dialog has time to render.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowUp") {
      setActiveIdx((i) => Math.max(i - 1, 0));
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      const r = results[activeIdx];
      if (r) {
        onSelect(r.id);
        onClose();
      }
      e.preventDefault();
    }
  };

  return (
    <div
      className="hf-cmdk-backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="hf-cmdk-backdrop"
    >
      <div
        className="hf-cmdk-panel"
        role="dialog"
        aria-label="Journey settings command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        data-testid="hf-cmdk-panel"
      >
        <input
          ref={inputRef}
          type="text"
          className="hf-cmdk-input"
          placeholder={`Search ${COMMAND_PALETTE_INDEX_SIZE} settings…`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset selection to top on every keystroke. Belongs here
            // (event handler), not in useEffect, per react-hooks lint.
            setActiveIdx(0);
          }}
          aria-label="Search settings"
          data-testid="hf-cmdk-input"
        />
        <ul className="hf-cmdk-results" role="listbox">
          {results.length === 0 ? (
            <li className="hf-cmdk-empty" data-testid="hf-cmdk-empty">
              No matches.
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.id}
                role="option"
                aria-selected={i === activeIdx}
                className={`hf-cmdk-result ${i === activeIdx ? "hf-cmdk-active" : ""}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => {
                  onSelect(r.id);
                  onClose();
                }}
                data-testid={`hf-cmdk-result-${r.id}`}
              >
                <span className="hf-cmdk-label">{r.educatorLabel}</span>
                <span className="hf-cmdk-meta">
                  {r.group} · {pathString(r)}
                </span>
              </li>
            ))
          )}
        </ul>
        <div className="hf-cmdk-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

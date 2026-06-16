"use client";

/**
 * CommandPalette — Phase 5 of epic #1675 + Slice C3 (#1738) bucket-
 * count surfacing.
 *
 * Cmd+K / Ctrl+K opens a search-as-you-type palette over BOTH the
 * journey registry AND the voice registry. Substring match on
 * `educatorLabel + group + storagePath`.
 *
 * Slice C3 surfaces the bucket count in the input placeholder so
 * educators learn the shape: "Search 56 settings across 13 buckets…".
 * Both counts are derived from the canonical registries
 * (`JOURNEY_SETTINGS` + `VOICE_SETTINGS`; `JOURNEY_MENU_BUCKET_IDS`) —
 * never hardcoded.
 *
 * Selecting a result calls `setBucketId` from `useJourneySelection` via
 * `CourseJourneyTab.handlePaletteSelect`, which looks up the setting's
 * owning bucket and mounts the bucket's settings in the Inspector pane.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { JOURNEY_MENU_BUCKET_IDS } from "@/lib/journey/menu-items";
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

/** Slice C3 (#1738) — derived bucket count surfaced in the input
 *  placeholder so educators understand the shape of the index. Pure
 *  derivation from `JOURNEY_MENU_BUCKET_IDS` — single source of truth
 *  at `lib/journey/menu-items.ts`. */
export const COMMAND_PALETTE_BUCKET_COUNT = JOURNEY_MENU_BUCKET_IDS.length;

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
          placeholder={`Search ${COMMAND_PALETTE_INDEX_SIZE} settings across ${COMMAND_PALETTE_BUCKET_COUNT} buckets…`}
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

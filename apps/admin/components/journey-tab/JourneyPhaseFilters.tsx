"use client";

/**
 * JourneyPhaseFilters — Phase 4 of epic #1675.
 *
 * Sticky chip row at the top of the LH menu. Slice 13 of the grey-out
 * epic added multi-select: each non-"All" chip toggles independently.
 * "All" is a special clear-all chip. Chips whose filter resolves to
 * zero buckets in the current tab render dimmed (still clickable so
 * the operator can see + understand what they'd land on).
 */

import {
  JOURNEY_PHASE_FILTERS,
  type JourneyPhaseFilter,
} from "@/lib/journey/setting-groups";

interface JourneyPhaseFiltersProps {
  active: readonly JourneyPhaseFilter[];
  onToggle: (next: JourneyPhaseFilter) => void;
  /** Slice 13 — chip ids whose filter resolves to 0 buckets in the
   *  CURRENT tab. Rendered dimmed; still clickable so the empty-state
   *  card explains the situation when clicked. */
  emptyFilters?: ReadonlySet<JourneyPhaseFilter>;
}

export function JourneyPhaseFilters({
  active,
  onToggle,
  emptyFilters,
}: JourneyPhaseFiltersProps) {
  const isAllActive = active.length === 0;
  return (
    <div
      className="hf-journey-lh-filters"
      role="group"
      aria-label="Journey phase filters (multi-select)"
      data-testid="hf-journey-phase-filters"
    >
      {JOURNEY_PHASE_FILTERS.map((f) => {
        const isSelected = f === "All" ? isAllActive : active.includes(f);
        const isEmpty = emptyFilters?.has(f) ?? false;
        const cls = [
          "hf-chip",
          isSelected ? "hf-chip-selected" : "",
          isEmpty && f !== "All" ? "hf-chip-empty" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={f}
            type="button"
            aria-pressed={isSelected}
            className={cls}
            onClick={() => onToggle(f)}
            title={
              isEmpty
                ? `${f} settings live on another tab`
                : undefined
            }
          >
            {f}
          </button>
        );
      })}
    </div>
  );
}

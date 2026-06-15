"use client";

/**
 * JourneyPhaseFilters — Phase 4 of epic #1675.
 *
 * Sticky chip row at the top of the LH menu. Selecting a chip narrows
 * which group accordions are visible. "All" is the default.
 */

import {
  JOURNEY_PHASE_FILTERS,
  type JourneyPhaseFilter,
} from "@/lib/journey/setting-groups";

interface JourneyPhaseFiltersProps {
  active: JourneyPhaseFilter;
  onChange: (next: JourneyPhaseFilter) => void;
}

export function JourneyPhaseFilters({
  active,
  onChange,
}: JourneyPhaseFiltersProps) {
  return (
    <div
      className="hf-journey-lh-filters"
      role="tablist"
      aria-label="Journey phase filters"
      data-testid="hf-journey-phase-filters"
    >
      {JOURNEY_PHASE_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          role="tab"
          aria-selected={active === f}
          className={`hf-chip ${active === f ? "hf-chip-selected" : ""}`}
          onClick={() => onChange(f)}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

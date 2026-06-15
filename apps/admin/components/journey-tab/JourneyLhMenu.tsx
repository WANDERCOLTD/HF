"use client";

/**
 * JourneyLhMenu — Phase 4 of epic #1675.
 *
 * Left-hand navigation for the Journey tab. Renders the 7 group
 * accordions (G1..G7) in chronological order. Each group is
 * individually collapsible (state persisted via sessionStorage).
 *
 * Phase filter chips at the top narrow visibility by educator phase.
 * Clicking a setting row selects it (mounts the corresponding
 * `<JourneyField>` in the Inspector panel via the parent's selection
 * state).
 */

import { useEffect, useState } from "react";


import {
  JOURNEY_GROUPS,
  type JourneyGroup,
  type JourneyPhaseFilter,
} from "@/lib/journey/setting-groups";
import {
  JOURNEY_SETTINGS_BY_GROUP,
} from "@/lib/journey/setting-contracts.entries";

import { JourneyPhaseFilters } from "./JourneyPhaseFilters";

interface JourneyLhMenuProps {
  selectedSettingId: string | null;
  onSelectSetting: (id: string) => void;
  filter: JourneyPhaseFilter;
  onFilterChange: (next: JourneyPhaseFilter) => void;
}

const GROUP_ORDER: JourneyGroup[] = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];

const SESSION_OPEN_KEY = "hf.journey.lh.openGroups";

export function JourneyLhMenu({
  selectedSettingId,
  onSelectSetting,
  filter,
  onFilterChange,
}: JourneyLhMenuProps) {
  const [openGroups, setOpenGroups] = useState<Set<JourneyGroup>>(() => {
    // Lazy init: restore last-open groups from sessionStorage (cap to 3
    // so the educator's last interaction is honoured but we don't dump
    // all 7 open). Falls back to G1+G2 expanded by default.
    if (typeof window === "undefined") return new Set(["G1", "G2"]);
    try {
      const raw = sessionStorage.getItem(SESSION_OPEN_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as JourneyGroup[];
        if (Array.isArray(arr)) return new Set(arr.slice(0, 3));
      }
    } catch {
      // fall through to default
    }
    return new Set(["G1", "G2"]);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(
      SESSION_OPEN_KEY,
      JSON.stringify(Array.from(openGroups)),
    );
  }, [openGroups]);

  const toggleGroup = (g: JourneyGroup) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const groupMatchesFilter = (g: JourneyGroup): boolean => {
    if (filter === "All") return true;
    return JOURNEY_GROUPS[g].phaseFilter === filter;
  };

  return (
    <div className="hf-journey-lh" data-testid="hf-journey-lh-menu">
      <JourneyPhaseFilters active={filter} onChange={onFilterChange} />
      <div className="hf-journey-lh-groups">
        {GROUP_ORDER.filter(groupMatchesFilter).map((g) => {
          const spec = JOURNEY_GROUPS[g];
          const settings = JOURNEY_SETTINGS_BY_GROUP[g] ?? [];
          const isOpen = openGroups.has(g);
          return (
            <div
              key={g}
              className="hf-journey-group"
              data-testid={`hf-journey-group-${g}`}
            >
              <button
                type="button"
                className="hf-journey-group-header"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(g)}
              >
                <span>
                  {spec.label}
                  <span className="hf-journey-group-caption">
                    {" · "}
                    {spec.caption}
                  </span>
                </span>
                <span className="hf-journey-group-count">
                  {settings.length}
                </span>
              </button>
              {isOpen ? (
                <div className="hf-journey-group-body">
                  {settings.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`hf-journey-setting-row ${
                        selectedSettingId === s.id ? "hf-selected" : ""
                      }`}
                      onClick={() => onSelectSetting(s.id)}
                      data-testid={`hf-journey-setting-row-${s.id}`}
                    >
                      <span>{s.educatorLabel}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

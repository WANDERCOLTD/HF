"use client";

/**
 * JourneyLhMenu — Phase 4 Slice C of epic #1675 (#1721).
 *
 * Left-hand navigation for the Journey tab. Renders 13 educator-intent
 * BUCKETS grouped under the original G1..G7 visual section headers.
 *
 * Pre-Slice-C, this menu was 45 individual setting rows (one click per
 * setting). Now: 13 buckets (one click → Inspector stacks all bucket
 * members). The IELTS pre-voice gap analysis (#1700) tells us this is
 * how power users actually think — by session moment, not by entity.
 *
 * Phase filter chips at the top narrow visibility by educator phase.
 * Clicking a bucket row selects it (mounts all bucket settings in the
 * Inspector via the parent's selection state).
 */

import { useEffect, useState } from "react";

import {
  JOURNEY_GROUPS,
  type JourneyGroup,
  type JourneyPhaseFilter,
} from "@/lib/journey/setting-groups";
import {
  JOURNEY_MENU_ITEMS,
  type JourneyMenuBucket,
} from "@/lib/journey/menu-items";
import { getSettingsForBucket } from "@/lib/journey/bucket-relations";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

import { JourneyPhaseFilters } from "./JourneyPhaseFilters";

interface JourneyLhMenuProps {
  selectedBucketId: JourneyMenuBucketId | null;
  onSelectBucket: (id: JourneyMenuBucketId) => void;
  filter: JourneyPhaseFilter;
  onFilterChange: (next: JourneyPhaseFilter) => void;
}

const GROUP_ORDER: JourneyGroup[] = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];

const SESSION_OPEN_KEY = "hf.journey.lh.openGroups";

export function JourneyLhMenu({
  selectedBucketId,
  onSelectBucket,
  filter,
  onFilterChange,
}: JourneyLhMenuProps) {
  const [openGroups, setOpenGroups] = useState<Set<JourneyGroup>>(() => {
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

  // Group buckets by their parentGroup so the visual section headers
  // (G1..G7) carry the chronology and the buckets are the leaves.
  const bucketsByGroup = new Map<JourneyGroup, JourneyMenuBucket[]>();
  for (const b of JOURNEY_MENU_ITEMS) {
    const arr = bucketsByGroup.get(b.parentGroup) ?? [];
    arr.push(b);
    bucketsByGroup.set(b.parentGroup, arr);
  }

  return (
    <div className="hf-journey-lh" data-testid="hf-journey-lh-menu">
      <JourneyPhaseFilters active={filter} onChange={onFilterChange} />
      <div className="hf-journey-lh-groups">
        {GROUP_ORDER.filter(groupMatchesFilter).map((g) => {
          const spec = JOURNEY_GROUPS[g];
          const buckets = bucketsByGroup.get(g) ?? [];
          if (buckets.length === 0) return null;
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
                  {buckets.length}
                </span>
              </button>
              {isOpen ? (
                <div className="hf-journey-group-body">
                  {buckets.map((b) => {
                    const settings = getSettingsForBucket(b.id);
                    const settingsCount = settings.length;
                    const isEmpty = settingsCount === 0;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        className={`hf-journey-setting-row ${
                          selectedBucketId === b.id ? "hf-selected" : ""
                        } ${isEmpty ? "hf-journey-bucket-empty" : ""}`}
                        onClick={() => onSelectBucket(b.id)}
                        data-testid={`hf-journey-bucket-row-${b.id}`}
                        title={
                          isEmpty && b.emptyReservation
                            ? b.emptyReservation.note
                            : undefined
                        }
                      >
                        <span className="hf-journey-bucket-label">
                          {b.label}
                          {isEmpty ? (
                            <span className="hf-journey-bucket-empty-tag">
                              {b.emptyReservation
                                ? `T${b.emptyReservation.ieltsTheme}`
                                : "soon"}
                            </span>
                          ) : null}
                        </span>
                        {!isEmpty ? (
                          <span className="hf-journey-bucket-count">
                            {settingsCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

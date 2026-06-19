"use client";

/**
 * JourneyLhMenu — Phase 4 Slice C of epic #1675 (#1721); pruned in P4
 * of epic #1850.
 *
 * Left-hand navigation for the Journey tab. Renders the educator-intent
 * BUCKETS that the Journey tab OWNS — filtered against
 * `BUCKETS_BY_TAB.journey` (7 buckets across G1..G3, G5, G6) — grouped
 * under the original G1..G7 visual section headers.
 *
 * Pre-Slice-C, this menu was 45 individual setting rows (one click per
 * setting). Slice C reshaped to 14 buckets. P4 (#1850) prunes the 7
 * non-Journey buckets — Teaching (C/E/F/J), Scoring (I/K), Voice (N) —
 * so the LH only shows what this tab edits. Out-of-tab clicks in the
 * Preview lens still work via the parent's `CrossTabHintCard` path
 * (#1893).
 *
 * Phase filter chips at the top narrow visibility by educator phase.
 * Clicking a bucket row selects it (mounts all bucket settings in the
 * Inspector via the parent's selection state).
 */

import { useEffect, useMemo, useState } from "react";

import { BUCKETS_BY_TAB } from "@/lib/journey/buckets-by-tab";
import {
  JOURNEY_GROUPS,
  type JourneyGroup,
  type JourneyPhaseFilter,
} from "@/lib/journey/setting-groups";
import {
  JOURNEY_MENU_ITEMS,
  JOURNEY_MENU_ITEMS_BY_ID,
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

  // Slice 8c grey-out epic — when the active bucket lives in a collapsed
  // group (e.g. operator clicked an off-screen bubble in the middle pane
  // that jumped to a group they hadn't opened), auto-expand that group
  // so the bucket is actually visible. One-shot per selection change.
  useEffect(() => {
    if (!selectedBucketId) return;
    const bucketSpec = JOURNEY_MENU_ITEMS_BY_ID[selectedBucketId];
    if (!bucketSpec?.parentGroup) return;
    const group = bucketSpec.parentGroup;
    setOpenGroups((prev) => {
      if (prev.has(group)) return prev;
      const next = new Set(prev);
      next.add(group);
      return next;
    });
  }, [selectedBucketId]);

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
  // P4 (#1850): filter to BUCKETS_BY_TAB.journey first — Teaching /
  // Scoring / Voice tabs own the rest. Groups with zero remaining
  // buckets (G4 after the teaching split, G7 after the scoring split)
  // collapse naturally — `buckets.length === 0` short-circuits below.
  const bucketsByGroup = useMemo(() => {
    const owned = new Set<JourneyMenuBucketId>(BUCKETS_BY_TAB.journey);
    const byGroup = new Map<JourneyGroup, JourneyMenuBucket[]>();
    for (const b of JOURNEY_MENU_ITEMS) {
      if (!owned.has(b.id)) continue;
      const arr = byGroup.get(b.parentGroup) ?? [];
      arr.push(b);
      byGroup.set(b.parentGroup, arr);
    }
    return byGroup;
  }, []);

  // Slice 12 grey-out epic — empty-state hint when the active phase
  // filter has zero matching buckets in the Journey tab. The most
  // common cause is `filter === "Module"`: G8 module-scoped settings
  // belong to the Modules tab, not the Journey tab. Without this hint
  // the LH just goes blank and the educator is left wondering where
  // the controls went.
  const visibleGroups = GROUP_ORDER.filter(groupMatchesFilter).filter(
    (g) => (bucketsByGroup.get(g) ?? []).length > 0,
  );
  const tabHintForEmptyFilter: Record<string, string> = {
    Module: "Module-scoped settings live on the Modules tab.",
  };

  return (
    <div className="hf-journey-lh" data-testid="hf-journey-lh-menu">
      <JourneyPhaseFilters active={filter} onChange={onFilterChange} />
      {visibleGroups.length === 0 && filter !== "All" ? (
        <div
          className="hf-journey-lh-empty"
          data-testid={`hf-journey-lh-empty-${filter}`}
        >
          <p>
            No <strong>{filter}</strong> settings live on the Journey tab.
          </p>
          {tabHintForEmptyFilter[filter] ? (
            <p className="hf-text-muted hf-text-xs">
              {tabHintForEmptyFilter[filter]}
            </p>
          ) : null}
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={() => onFilterChange("All")}
          >
            Show all
          </button>
        </div>
      ) : null}
      <div className="hf-journey-lh-groups">
        {GROUP_ORDER.filter(groupMatchesFilter).map((g) => {
          const spec = JOURNEY_GROUPS[g];
          const buckets = bucketsByGroup.get(g) ?? [];
          if (buckets.length === 0) return null;
          const isOpen = openGroups.has(g);
          // Slice 7 grey-out epic — flag the group containing the active
          // bucket so the CSS can render a "you are here" accent dot next
          // to the group header. Mirrors the per-bucket `.hf-selected`
          // treatment one layer up.
          const containsSelected =
            selectedBucketId !== null &&
            buckets.some((b) => b.id === selectedBucketId);
          // Slice 8 grey-out epic — group-header pill carries two numbers
          // now: bucket count (categories) and total knob count across
          // all of them. Educators wanted to see "how big is this group"
          // before drilling in.
          const totalKnobs = buckets.reduce(
            (n, b) => n + getSettingsForBucket(b.id).length,
            0,
          );
          return (
            <div
              key={g}
              className={`hf-journey-group ${
                containsSelected ? "hf-journey-group-has-selected" : ""
              }`}
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
                <span
                  className="hf-journey-group-count"
                  title={`${buckets.length} bucket${buckets.length === 1 ? "" : "s"} · ${totalKnobs} setting${totalKnobs === 1 ? "" : "s"}`}
                >
                  {buckets.length}{" "}
                  <span className="hf-journey-group-count-divider">/</span>{" "}
                  {totalKnobs}
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

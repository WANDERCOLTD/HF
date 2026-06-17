"use client";

/**
 * use-cross-tab-hint — Phase P3b of epic #1850.
 *
 * Shared per-tab logic for the cross-tab Inspector hint card. Returns:
 *
 *   - `selectedId`            — bucket id in scope of THIS tab, or null
 *   - `setSelectedId`         — direct setter for LH-menu clicks
 *   - `crossTabHint`          — non-null when the operator clicked a
 *                                Preview bubble owned by a different tab
 *   - `clearHint`             — dismiss the hint (called when the
 *                                operator selects an in-scope bucket)
 *   - `handlePreviewSelect`   — wire as PreviewLens `onSelectSection`
 *
 * The hook intentionally does NOT manage the tab switch — the calling
 * tab passes `onJump` from its parent via `onTabSwitch(owningTab,
 * { selectedBucket })`. Separation keeps each tab in charge of its
 * own LH state.
 */

import { useCallback, useMemo, useState } from "react";

import type { ComposeSectionKey } from "@/lib/compose";
import { BUCKETS_BY_TAB, type CourseDetailTabId, TAB_LABELS } from "@/lib/journey/buckets-by-tab";
import { bucketToTab } from "@/lib/journey/bucket-to-tab";
import { getBucketsForSection } from "@/lib/journey/bucket-relations";
import { JOURNEY_MENU_ITEMS_BY_ID } from "@/lib/journey/menu-items";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

export interface CrossTabHint {
  bucketId: JourneyMenuBucketId;
  bucketLabel: string;
  owningTab: CourseDetailTabId;
  owningTabLabel: string;
}

interface UseCrossTabHintArgs {
  /** The tab the hook is mounted on. */
  currentTab: CourseDetailTabId;
  /** URL param value of `?selectedBucket=` from `useSearchParams()`.
   *  When present + in scope of `currentTab`, seeds `selectedId`. */
  selectedBucketParam: string | null;
  /** Fires the parent's tab switch. The parent appends
   *  `?selectedBucket=<id>` so the destination tab's seed effect picks
   *  the right bucket. */
  onTabSwitch: (
    tabId: CourseDetailTabId,
    options: { selectedBucket: JourneyMenuBucketId },
  ) => void;
}

interface UseCrossTabHintReturn {
  selectedId: JourneyMenuBucketId | null;
  setSelectedId: (id: JourneyMenuBucketId | null) => void;
  crossTabHint: CrossTabHint | null;
  clearHint: () => void;
  handlePreviewSelect: (section: ComposeSectionKey | null) => void;
  jumpToOwningTab: () => void;
}

function isBucketInTab(
  tabId: CourseDetailTabId,
  bucketId: JourneyMenuBucketId,
): boolean {
  return BUCKETS_BY_TAB[tabId].includes(bucketId);
}

export function useCrossTabHint({
  currentTab,
  selectedBucketParam,
  onTabSwitch,
}: UseCrossTabHintArgs): UseCrossTabHintReturn {
  // Seed from URL param on mount (lazy initializer — no effect, no
  // setState-in-effect warning). Foreign bucket ids (out of this
  // tab's scope) collapse to null and the LH renders the empty state.
  // Subsequent URL changes (cross-tab nav landing on this tab while
  // already mounted) are caught by the parent — page.tsx changes
  // `activeTab` via `handleCrossTabSwitch` which re-mounts the tab
  // component (the parent renders different tabs by conditional), so
  // the lazy initializer fires fresh on every cross-tab landing.
  const [selectedId, setSelectedId] = useState<JourneyMenuBucketId | null>(
    () => {
      if (!selectedBucketParam) return null;
      const candidate = selectedBucketParam as JourneyMenuBucketId;
      if (!JOURNEY_MENU_ITEMS_BY_ID[candidate]) return null;
      return isBucketInTab(currentTab, candidate) ? candidate : null;
    },
  );
  const [crossTabHint, setCrossTabHint] = useState<CrossTabHint | null>(null);

  const clearHint = useCallback(() => {
    setCrossTabHint(null);
  }, []);

  const handlePreviewSelect = useCallback(
    (section: ComposeSectionKey | null) => {
      if (!section) {
        setCrossTabHint(null);
        return;
      }
      const buckets = getBucketsForSection(section);
      if (buckets.length === 0) {
        setCrossTabHint(null);
        return;
      }
      // Prefer a bucket that lives on THIS tab — keeps the in-scope
      // path identical to the pre-P3b behaviour.
      const inScope = buckets.find((b) => isBucketInTab(currentTab, b));
      if (inScope) {
        setSelectedId(inScope);
        setCrossTabHint(null);
        return;
      }
      // No in-scope bucket — surface the hint for the FIRST bucket
      // chronologically (matches Journey-tab pick-strip default-select).
      const owner = buckets[0];
      const owningTab = bucketToTab(owner);
      if (!owningTab) {
        setCrossTabHint(null);
        return;
      }
      const meta = JOURNEY_MENU_ITEMS_BY_ID[owner];
      setCrossTabHint({
        bucketId: owner,
        bucketLabel: meta?.label ?? owner,
        owningTab,
        owningTabLabel: TAB_LABELS[owningTab],
      });
    },
    [currentTab],
  );

  const jumpToOwningTab = useCallback(() => {
    if (!crossTabHint) return;
    onTabSwitch(crossTabHint.owningTab, {
      selectedBucket: crossTabHint.bucketId,
    });
    setCrossTabHint(null);
  }, [crossTabHint, onTabSwitch]);

  return useMemo(
    () => ({
      selectedId,
      setSelectedId,
      crossTabHint,
      clearHint,
      handlePreviewSelect,
      jumpToOwningTab,
    }),
    [selectedId, crossTabHint, clearHint, handlePreviewSelect, jumpToOwningTab],
  );
}

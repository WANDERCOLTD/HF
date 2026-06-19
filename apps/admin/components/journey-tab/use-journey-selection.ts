"use client";

/**
 * Journey-tab URL-state hook — Phase 4 of epic #1675, extended in Slice C.
 *
 * Slice A tracked `?j_setting=<id>`. Slice C migrates to
 * `?j_bucket=<id>` since LH selection is now bucket-grained. Back-compat:
 * `?j_setting=<id>` still resolves — we look up the setting's bucket and
 * redirect on first read.
 *
 * `?j_filter=` (phase filter chip) is unchanged.
 */

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  JOURNEY_PHASE_FILTERS,
  type JourneyPhaseFilter,
} from "@/lib/journey/setting-groups";
import { JOURNEY_MENU_BUCKET_IDS } from "@/lib/journey/menu-items";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";
import { JOURNEY_SETTINGS_BY_ID } from "@/lib/journey/setting-contracts.entries";

export interface JourneySelection {
  /** Currently-selected bucket id (null when nothing chosen). */
  bucketId: JourneyMenuBucketId | null;
  /** Slice 4 grey-out epic — when set, the Inspector scrolls + briefly
   *  highlights the row for this setting id. Used by Preview bubble
   *  clicks to land on the specific setting the bubble represents,
   *  instead of just the bucket. Cleared after the highlight animation
   *  by `setBucketId(b, null)`. */
  focusedSettingId: string | null;
  /** Active phase filter chip. Defaults to "All". Slice 13 added
   *  multi-select via `filters` below — `filter` is kept for back-compat
   *  with consumers that only care about a single value (returns the
   *  first selected or "All" when empty). */
  filter: JourneyPhaseFilter;
  /** Slice 13 grey-out epic — multi-select phase filters. Empty array
   *  means "All". Order is the user's last-clicked order (insertion
   *  order in the URL csv). */
  filters: readonly JourneyPhaseFilter[];
  /** Set bucket. Optional second arg writes a setting-focus param so
   *  the Inspector can scroll/highlight that specific row. */
  setBucketId: (next: JourneyMenuBucketId | null, focusedSettingId?: string | null) => void;
  setFilter: (next: JourneyPhaseFilter) => void;
  /** Slice 13 — toggle a single phase filter on/off. "All" clears.
   *  Multi-select: clicking a non-All filter toggles it independently
   *  of any other selected filters. */
  toggleFilter: (next: JourneyPhaseFilter) => void;
}

const BUCKET_PARAM = "j_bucket";
const FILTER_PARAM = "j_filter";
const SETTING_PARAM = "j_setting";

export function useJourneySelection(): JourneySelection {
  const router = useRouter();
  const params = useSearchParams();

  // Read bucket directly, or `?j_setting=…` alias → derive bucket.
  // Slice 4 grey-out epic: when the param resolves to a valid setting,
  // also expose `focusedSettingId` so the Inspector can scroll/highlight
  // its row. Bucket+setting can coexist in the URL (bucket as the LH
  // selection signal, setting as the in-bucket focus signal).
  let bucketId: JourneyMenuBucketId | null = null;
  const bucketRaw = params.get(BUCKET_PARAM);
  if (
    bucketRaw &&
    (JOURNEY_MENU_BUCKET_IDS as readonly string[]).includes(bucketRaw)
  ) {
    bucketId = bucketRaw as JourneyMenuBucketId;
  }
  const settingRaw = params.get(SETTING_PARAM);
  let focusedSettingId: string | null = null;
  if (settingRaw && JOURNEY_SETTINGS_BY_ID[settingRaw]) {
    focusedSettingId = settingRaw;
    if (!bucketId) {
      const owner = JOURNEY_SETTINGS_BY_ID[settingRaw];
      if (owner.menuGroupKey) bucketId = owner.menuGroupKey;
    }
  }

  // Slice 13 — `?j_filter=Intake,End` → multi-select. Single value still
  // accepted for back-compat. Empty / missing → "All".
  const filterRaw = params.get(FILTER_PARAM);
  const filters: readonly JourneyPhaseFilter[] = filterRaw
    ? (filterRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is JourneyPhaseFilter =>
          (JOURNEY_PHASE_FILTERS as readonly string[]).includes(s) && s !== "All",
        ))
    : [];
  const filter: JourneyPhaseFilter = filters[0] ?? "All";

  const pushQuery = useCallback(
    (entries: Array<[string, string | null]>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of entries) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const setBucketId = useCallback(
    (next: JourneyMenuBucketId | null, focused?: string | null) =>
      pushQuery([
        [BUCKET_PARAM, next],
        // `undefined` means "leave the existing setting alone"; explicit
        // `null` clears it. Bucket clicks from the LH menu pass nothing,
        // so the previously-focused setting drops naturally (next render
        // shows the full stack).
        ...(focused !== undefined
          ? ([[SETTING_PARAM, focused]] as Array<[string, string | null]>)
          : ([[SETTING_PARAM, null]] as Array<[string, string | null]>)),
      ]),
    [pushQuery],
  );
  const setFilter = useCallback(
    (next: JourneyPhaseFilter) =>
      pushQuery([[FILTER_PARAM, next === "All" ? null : next]]),
    [pushQuery],
  );

  // Slice 13 — multi-select toggle. "All" clears the entire selection
  // (back to "show everything"). Any other filter toggles itself in/out
  // of the current set independently of the others.
  const toggleFilter = useCallback(
    (next: JourneyPhaseFilter) => {
      if (next === "All") {
        pushQuery([[FILTER_PARAM, null]]);
        return;
      }
      const has = filters.includes(next);
      const nextArr = has ? filters.filter((f) => f !== next) : [...filters, next];
      pushQuery([[FILTER_PARAM, nextArr.length === 0 ? null : nextArr.join(",")]]);
    },
    [filters, pushQuery],
  );

  return useMemo(
    () => ({ bucketId, focusedSettingId, filter, filters, setBucketId, setFilter, toggleFilter }),
    [bucketId, focusedSettingId, filter, filters, setBucketId, setFilter, toggleFilter],
  );
}

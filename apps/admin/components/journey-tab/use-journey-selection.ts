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
  /** Active phase filter chip. Defaults to "All". */
  filter: JourneyPhaseFilter;
  setBucketId: (next: JourneyMenuBucketId | null) => void;
  setFilter: (next: JourneyPhaseFilter) => void;
}

const BUCKET_PARAM = "j_bucket";
const FILTER_PARAM = "j_filter";
const LEGACY_SETTING_PARAM = "j_setting";

export function useJourneySelection(): JourneySelection {
  const router = useRouter();
  const params = useSearchParams();

  // Read bucket directly, or legacy setting alias → derive bucket.
  let bucketId: JourneyMenuBucketId | null = null;
  const bucketRaw = params.get(BUCKET_PARAM);
  if (
    bucketRaw &&
    (JOURNEY_MENU_BUCKET_IDS as readonly string[]).includes(bucketRaw)
  ) {
    bucketId = bucketRaw as JourneyMenuBucketId;
  } else {
    const legacySetting = params.get(LEGACY_SETTING_PARAM);
    if (legacySetting && JOURNEY_SETTINGS_BY_ID[legacySetting]) {
      const owner = JOURNEY_SETTINGS_BY_ID[legacySetting];
      if (owner.menuGroupKey) bucketId = owner.menuGroupKey;
    }
  }

  const filterRaw = params.get(FILTER_PARAM) as JourneyPhaseFilter | null;
  const filter: JourneyPhaseFilter =
    filterRaw && (JOURNEY_PHASE_FILTERS as readonly string[]).includes(filterRaw)
      ? filterRaw
      : "All";

  const pushQuery = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      // Drop the legacy setting param on any new write — once the bucket
      // resolves, the canonical URL is `?j_bucket=…`.
      next.delete(LEGACY_SETTING_PARAM);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const setBucketId = useCallback(
    (next: JourneyMenuBucketId | null) => pushQuery(BUCKET_PARAM, next),
    [pushQuery],
  );
  const setFilter = useCallback(
    (next: JourneyPhaseFilter) =>
      pushQuery(FILTER_PARAM, next === "All" ? null : next),
    [pushQuery],
  );

  return useMemo(
    () => ({ bucketId, filter, setBucketId, setFilter }),
    [bucketId, filter, setBucketId, setFilter],
  );
}

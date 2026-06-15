"use client";

/**
 * Journey-tab URL-state hook — Phase 4 of epic #1675.
 *
 * Tracks the selected settingId + phase filter via `?j_setting=` and
 * `?j_filter=` query params so the state survives browser back/forward
 * and is shareable.
 */

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  JOURNEY_PHASE_FILTERS,
  type JourneyPhaseFilter,
} from "@/lib/journey/setting-groups";

export interface JourneySelection {
  /** Currently-selected setting id (null when nothing chosen). */
  settingId: string | null;
  /** Active phase filter chip. Defaults to "All". */
  filter: JourneyPhaseFilter;
  setSettingId: (next: string | null) => void;
  setFilter: (next: JourneyPhaseFilter) => void;
}

const SETTING_PARAM = "j_setting";
const FILTER_PARAM = "j_filter";

export function useJourneySelection(): JourneySelection {
  const router = useRouter();
  const params = useSearchParams();

  const settingId = params.get(SETTING_PARAM);
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
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const setSettingId = useCallback(
    (next: string | null) => pushQuery(SETTING_PARAM, next),
    [pushQuery],
  );
  const setFilter = useCallback(
    (next: JourneyPhaseFilter) =>
      pushQuery(FILTER_PARAM, next === "All" ? null : next),
    [pushQuery],
  );

  return useMemo(
    () => ({ settingId, filter, setSettingId, setFilter }),
    [settingId, filter, setSettingId, setFilter],
  );
}

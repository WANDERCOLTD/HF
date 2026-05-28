/**
 * Plain-English definitions for jargon labels shown on the three caller tabs
 * (Overview, Uplift v2, Progress v2).
 *
 * Hybrid source:
 *  - Parameter definitions come from the DB via `/api/parameters/display-config`
 *    (the `params` map). Use the `useGlossary` hook to fetch + merge.
 *  - Non-parameter terms (metric names like "Momentum", "Mastery"; goal-type
 *    labels) are in the hardcoded `STATIC_GLOSSARY` below.
 *
 * Why hybrid: hardcoded parameter strings drift from DB; pure DB sourcing
 * leaves no home for UI-only concepts. Hybrid keeps each source authoritative.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

export type GlossaryEntry = {
  /** Display label (usually the same as the key, but Title Cased). */
  label: string;
  /** One-sentence plain-English definition. */
  definition: string;
  /** Optional: how this metric is computed. */
  howMeasured?: string;
};

export type GlossaryMap = Record<string, GlossaryEntry>;

/**
 * Non-parameter glossary entries.
 *
 * Convention: keys are normalised — lowercase with hyphens. Lookup is
 * case-insensitive via `lookupGlossary`.
 *
 * These are dev placeholders; final copy comes from the educator team
 * (per the plan's Open Question 6).
 */
export const STATIC_GLOSSARY: GlossaryMap = {
  mastery: {
    label: "Mastery",
    definition:
      "Average mastery across all modules in the course, weighted by recent calls.",
    howMeasured: "0–1, aggregated from per-LO mastery EMA.",
  },
  confidence: {
    label: "Confidence",
    definition:
      "Self-reported confidence on a 1–5 survey scale, taken before and after the course.",
  },
  knowledge: {
    label: "Knowledge",
    definition:
      "Test score from the pre / post knowledge check, scaled 0–1.",
  },
  momentum: {
    label: "Momentum",
    definition:
      "Whether this learner's pace is accelerating, holding steady, or slowing — last 7 days of calls vs the prior 7.",
  },
  streak: {
    label: "Day streak",
    definition: "Consecutive days with at least one call.",
  },
  "calls-per-week": {
    label: "Calls per week",
    definition: "Rolling 7-day call count.",
  },
  memories: {
    label: "Memories",
    definition:
      "Facts, preferences, and topics the agent has remembered about this learner across calls.",
  },
  // Goal types
  "goal-mastery": {
    label: "Mastery goal",
    definition: "Target proficiency level on a module or skill.",
  },
  "goal-recency": {
    label: "Recency goal",
    definition: "Maintain practice within a defined window (e.g. last 7 days).",
  },
  "goal-frequency": {
    label: "Frequency goal",
    definition: "A target rate of calls or sessions (e.g. 3 / week).",
  },
};

/** Pure lookup. Returns `undefined` if the key is unknown. */
export function lookupGlossary(
  map: GlossaryMap,
  key: string | null | undefined,
): GlossaryEntry | undefined {
  if (!key) return undefined;
  return map[key] ?? map[key.toLowerCase()] ?? map[key.toLowerCase().replace(/\s+/g, "-")];
}

/**
 * React hook that returns the merged glossary (static + DB parameters).
 * Falls back to the static-only map if the DB fetch fails.
 */
export function useGlossary(): GlossaryMap {
  const [dbMap, setDbMap] = useState<GlossaryMap>({});

  useEffect(() => {
    let cancelled = false;
    async function fetchParams(): Promise<void> {
      try {
        const res = await fetch("/api/parameters/display-config");
        const json = await res.json();
        if (!cancelled && json?.ok && json.params) {
          const merged: GlossaryMap = {};
          for (const [pid, info] of Object.entries(json.params as Record<string, { label?: string; description?: string }>)) {
            merged[pid] = {
              label: info.label ?? pid,
              definition: info.description ?? "",
            };
            // Also key by lowercased label so "Mastery" → DB entry resolves.
            if (info.label) {
              merged[info.label.toLowerCase()] = merged[pid];
            }
          }
          setDbMap(merged);
        }
      } catch {
        // Silent — fallback to static only.
      }
    }
    fetchParams();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => ({ ...STATIC_GLOSSARY, ...dbMap }), [dbMap]);
}

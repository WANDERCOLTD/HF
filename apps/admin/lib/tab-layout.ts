/**
 * Tab-layout feature flag — Wave E of the legacy-tab retirement plan.
 *
 * Single env-var-driven knob controlling whether legacy caller-detail
 * tabs (Overview-v2, Progress-v2, Uplift-v2, Profile) ship alongside
 * the new v3 surfaces (Snapshot, Attainment, Adaptations) or are
 * hidden + redirected.
 *
 * Two states:
 *
 *   - **`both`** (default everywhere) — v3 tabs primary (leftmost).
 *     Legacy tabs visible to the right with an amber "Retiring" pill
 *     so educators know they're going away and can drift into the v3
 *     equivalents at their own pace.
 *
 *   - **`retire`** (set per-env when ready) — legacy tabs hidden from
 *     the tab bar. Their render branches stay reachable via direct
 *     URL so deep-links don't 404 during transition, but the tab bar
 *     no longer surfaces them and `localStorage`-saved-tab pointers
 *     redirect to the v3 replacement.
 *
 * Why env-var (not DB SystemSetting): all-or-nothing per env, no
 * per-user override needed, trivial rollback (flip the var). Why no
 * "off" state: post-Wave-B the v3 tabs are production-ready; there's
 * no reason to hide them once shipped. Keeps the state machine tiny.
 */

import type { SectionId } from "@/components/callers/caller-detail/types";

export type TabLayout = "both" | "retire";

/** Resolves the FF from `NEXT_PUBLIC_HF_TAB_LAYOUT`. Defaults to `both`. */
export function getTabLayout(): TabLayout {
  if (typeof process === "undefined") return "both";
  return process.env.NEXT_PUBLIC_HF_TAB_LAYOUT === "retire" ? "retire" : "both";
}

/**
 * The 3 v3 tabs that get promoted to primary visible position by Wave E.
 * Order matters — first entry sits leftmost in the bar.
 */
export const V3_PRIMARY_TABS: readonly SectionId[] = [
  "snapshot-v3",
  "attainment",
  "adaptations",
] as const;

/**
 * Legacy tabs that:
 *   - in `both` mode: still visible but marked with the amber "Retiring" pill
 *   - in `retire` mode: hidden from the tab bar; URL hits redirect to v3
 *
 * Each entry maps to its v3 replacement so the retire-mode redirect can
 * route correctly + the amber pill's tooltip can name the destination.
 */
export const RETIRING_TABS: Record<
  SectionId,
  { replacedBy: SectionId; tooltip: string }
> = {
  "overview-v2": {
    replacedBy: "snapshot-v3",
    tooltip: "Moving to Snapshot — try the new tab",
  },
  "progress-v2": {
    replacedBy: "attainment",
    tooltip: "Moving to Attainment — try the new tab",
  },
  "uplift-v2": {
    replacedBy: "snapshot-v3",
    tooltip: "Moving to Snapshot — try the new tab",
  },
  how: {
    replacedBy: "snapshot-v3",
    tooltip: "Folded into Snapshot — try the new tab",
  },
} as Record<SectionId, { replacedBy: SectionId; tooltip: string }>;

/**
 * The tabs that survive retirement (educator tools that have no v3
 * equivalent). Visible in both states.
 */
export const KEEP_TABS: readonly SectionId[] = [
  "calls-prompts",
  "tune",
  "session-flow",
  "ai-call",
] as const;

/**
 * Compute the visible-tab set + ordered render list for the current FF state.
 *
 *   - `both`: V3_PRIMARY first, then KEEP, then RETIRING (with amber pill)
 *   - `retire`: V3_PRIMARY first, then KEEP. RETIRING tabs are hidden from
 *     the bar but their render branches stay reachable via URL.
 *
 * Returns the set + a redirect map for retired tabs (used by the URL +
 * localStorage redirect path).
 */
export function computeVisibleTabs(layout: TabLayout): {
  visible: Set<SectionId>;
  isRetiring: (id: SectionId) => boolean;
  retirementRedirect: (id: SectionId) => SectionId | null;
} {
  const visible = new Set<SectionId>([...V3_PRIMARY_TABS, ...KEEP_TABS]);
  if (layout === "both") {
    for (const id of Object.keys(RETIRING_TABS) as SectionId[]) {
      visible.add(id);
    }
  }
  return {
    visible,
    isRetiring: (id) => id in RETIRING_TABS,
    retirementRedirect: (id) => {
      const entry = RETIRING_TABS[id];
      if (!entry) return null;
      return layout === "retire" ? entry.replacedBy : null;
    },
  };
}

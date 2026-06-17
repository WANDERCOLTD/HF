/**
 * BUCKETS_BY_TAB — Course Detail tab → JOURNEY_MENU_ITEMS bucket mapping.
 *
 * Track C of the Journey-Design tab refactor (P0 shells).
 *
 * Each of the 14 `JourneyMenuBucketId` values lives on EXACTLY one
 * Course Detail tab. The Journey tab continues to expose its 7
 * chronological buckets (sign-up → call 1 → mid → end). The Teaching
 * and Scoring tabs slice the remaining always-on knobs by educator
 * intent. The Voice tab keeps its existing single-bucket home. The
 * Modules tab is intentionally bucket-empty — modules-tab uses
 * per-AuthoredModule scope (a module picker on the LH), not the
 * bucket-filtered menu the other tabs use.
 *
 * The mapping is pinned by
 * `tests/lib/journey/buckets-by-tab.test.ts` — every JourneyMenuBucketId
 * must appear in exactly one tab (no duplicates, no omissions).
 */

import type { JourneyMenuBucketId } from "./setting-contracts";

export type CourseDetailTabId =
  | "journey"
  | "teaching"
  | "scoring"
  | "voice"
  | "modules";

/** Which buckets surface on which Course Detail tab.
 *  - `journey`: chronological arc — sign-up → call 1 → mid → end
 *  - `teaching`: how the tutor behaves on every call uniformly
 *  - `scoring`: math + sequencing (banding, EMA, cadence)
 *  - `voice`: already shipped, lives in Settings tab today
 *  - `modules`: G8 module-scoped (per AuthoredModule, not per Playbook) */
export const BUCKETS_BY_TAB: Record<
  CourseDetailTabId,
  readonly JourneyMenuBucketId[]
> = {
  journey: [
    "A_intake",
    "B_call1_opening",
    "D_question_flow",
    "G_session_length",
    "L_mid_journey",
    "H_closing",
    "M_end_of_course",
  ],
  teaching: ["C_teaching_style", "E_learner_visual", "F_stall_recovery", "J_feedback"],
  scoring: ["I_scoring", "K_between_calls"],
  voice: ["N_voice"],
  modules: [], // G8 entries cross-tagged into other buckets; module tab uses per-AuthoredModule scope, not bucket scope
};

export const TAB_LABELS: Record<CourseDetailTabId, string> = {
  journey: "Journey",
  teaching: "Teaching",
  scoring: "Scoring",
  voice: "Voice",
  modules: "Modules",
};

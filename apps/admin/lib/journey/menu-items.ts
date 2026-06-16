/**
 * Journey menu buckets — Phase 4 Slice C of epic #1675 (#1721).
 *
 * 13 educator-intent buckets organised by *session moment* (the
 * mental model power users actually use, per
 * `docs/draft-issues/ielts-pre-voice-gap-analysis.md`). The buckets
 * are the leaves of the LH menu; the G1..G7 enum acts as visual
 * section-headers above them (Slice D may collapse the headers).
 *
 * Settings are assigned to a bucket via `menuGroupKey` on the
 * `JourneySettingContract`. The bucket model is a curated VIEW on top
 * of the canonical 45-entry registry — Cmd+K continues to target
 * individual settings; Enter expands the owning bucket + scrolls.
 *
 * IELTS coordination (#1700): new themes ship with `menuGroupKey`
 * already populated. The completeness vitest fails CI if any new
 * setting lands without a bucket. Cross-references the bucket model
 * to the corresponding IELTS theme number.
 */

import type { JourneyMenuBucketId } from "./setting-contracts";
import type { JourneyGroup } from "./setting-groups";

export interface JourneyMenuBucket {
  id: JourneyMenuBucketId;
  /** Educator-facing label in LH menu. */
  label: string;
  /** One-line caption under the label. */
  caption: string;
  /** Visual section header — settings are still grouped under G1..G7
   *  in the LH menu so the chronology stays explicit. */
  parentGroup: JourneyGroup;
  /** When true, the bucket is currently empty (no settings reference
   *  it yet) but reserved for future themes. The LH renders it with a
   *  "Land when IELTS Theme N ships" placeholder linking to #1700. */
  emptyReservation?: {
    /** IELTS theme number this bucket is reserved for. */
    ieltsTheme: number;
    /** Short note for the placeholder. */
    note: string;
  };
}

/** The 13 buckets in LH order. Authored 2026-06-16. */
export const JOURNEY_MENU_ITEMS: readonly JourneyMenuBucket[] = [
  {
    id: "A_intake",
    label: "Sign-up & pre-call profile",
    caption: "What we learn about the learner before they call",
    parentGroup: "G1",
  },
  {
    id: "B_call1_opening",
    label: "Call 1 — opening & assessment shape",
    caption: "How Call 1 starts + whether it's an assessment",
    parentGroup: "G2",
  },
  {
    id: "C_teaching_style",
    label: "How the tutor teaches every call",
    caption: "Tone, mode, and scoring tolerances across every call",
    parentGroup: "G4",
  },
  {
    id: "D_question_flow",
    label: "Questions & module flow",
    caption: "What gets asked and in what order",
    parentGroup: "G3",
  },
  {
    id: "E_learner_visual",
    label: "What the learner sees during sessions",
    caption: "Pinned cards, waveform, timer visibility",
    parentGroup: "G4",
    emptyReservation: {
      ieltsTheme: 3,
      note: "Lands with IELTS Theme 3 (PinnedCardSlot) + Theme 4 (ExamModeShell).",
    },
  },
  {
    id: "F_stall_recovery",
    label: "How the tutor handles silence & struggles",
    caption: "Stall scaffolds, time-keyed cues, talk-time discipline",
    parentGroup: "G4",
    emptyReservation: {
      ieltsTheme: 2,
      note: "Lands with IELTS Theme 2 (stall + cue scheduler) + Theme 7 (talk-time budgets).",
    },
  },
  {
    id: "G_session_length",
    label: "How long sessions must be",
    caption: "Phases, minimum speaking time, retry policy",
    parentGroup: "G2",
  },
  {
    id: "H_closing",
    label: "How the tutor closes",
    caption: "Closing line, tone, structured close",
    parentGroup: "G6",
  },
  {
    id: "I_scoring",
    label: "How learners are scored",
    caption: "Banding, per-part scoring, visibility",
    parentGroup: "G7",
  },
  {
    id: "J_feedback",
    label: "Progress feedback to the learner",
    caption: "Recap, prior-call feedback, progress signals",
    parentGroup: "G4",
  },
  {
    id: "K_between_calls",
    label: "Between calls — recap, recommendations, frequency",
    caption: "Cadence, recommendations, prereqs",
    parentGroup: "G7",
  },
  {
    id: "L_mid_journey",
    label: "Mid-journey stops",
    caption: "Mid-test / NPS / post-test gates",
    parentGroup: "G5",
  },
  {
    id: "M_end_of_course",
    label: "End-of-course delivery",
    caption: "Wrap-up, results delivery, completion",
    parentGroup: "G6",
  },
];

export const JOURNEY_MENU_ITEMS_BY_ID: Readonly<
  Record<JourneyMenuBucketId, JourneyMenuBucket>
> = Object.fromEntries(JOURNEY_MENU_ITEMS.map((b) => [b.id, b])) as Record<
  JourneyMenuBucketId,
  JourneyMenuBucket
>;

/** The 13 IDs as an ordered tuple — useful for stable URL state +
 *  registry-completeness assertions. */
export const JOURNEY_MENU_BUCKET_IDS: readonly JourneyMenuBucketId[] =
  JOURNEY_MENU_ITEMS.map((b) => b.id);

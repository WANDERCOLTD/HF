/**
 * Journey-tab group taxonomy — Phase 0 of the Journey Editor epic
 * (story #1676 / epic #1675).
 *
 * Groups are ordered by JOURNEY TIME (when in the learner's flow each
 * setting fires), not by config category. Scrolling the Inspector LH
 * menu ≈ walking the learner's journey. Cross-cutting groups (G7) sit
 * at the bottom of the LH menu.
 *
 * Voice (was an 8th group in earlier drafts) moves to the Settings tab —
 * see `lib/settings/voice-setting-contracts.ts`.
 *
 * `JOURNEY_PHASE_FILTERS` powers the Inspector filter chips; "All" is
 * the default ("All" + 7 group filters = 8 chips total — but per AC the
 * array length is 7 INCLUDING "All", giving 6 group filters; one group
 * is implicit per BA spec — see ADR §3 for the resolution).
 */

export const JOURNEY_GROUPS = {
  G1: {
    label: "Sign-up & Intake",
    caption: "Before they call",
    phaseFilter: "Intake",
  },
  G2: {
    label: "Call 1 — opening & assessment",
    caption: "First 60 seconds of Call 1",
    phaseFilter: "Call 1",
  },
  G3: {
    label: "Call 1 — teaching",
    caption: "Call 1 teaching shape",
    phaseFilter: "Call 1",
  },
  G4: {
    label: "Every call — teaching style",
    caption: "How the AI teaches, calls 2+",
    phaseFilter: "Calls 2+",
  },
  G5: {
    label: "Mid-journey stops",
    caption: "Between teaching calls",
    phaseFilter: "Mid-journey",
  },
  G6: {
    label: "End of course / offboarding",
    caption: "Offboarding & wrap-up",
    phaseFilter: "End",
  },
  G7: {
    label: "Scoring & sequencing",
    caption: "What gets taught next",
    phaseFilter: "Scoring",
  },
} as const;

export type JourneyGroup = keyof typeof JOURNEY_GROUPS;

/** Phase filter chips — "All" + 6 distinct phase labels (G2 and G3 share
 *  "Call 1" so the chip array deduplicates). 7 entries total. */
export const JOURNEY_PHASE_FILTERS = [
  "All",
  "Intake",
  "Call 1",
  "Calls 2+",
  "Mid-journey",
  "End",
  "Scoring",
] as const;

export type JourneyPhaseFilter = (typeof JOURNEY_PHASE_FILTERS)[number];

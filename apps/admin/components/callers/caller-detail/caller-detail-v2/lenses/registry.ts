/**
 * Lens registry for Progress v2.
 *
 * Each lens declares an id, label, icon, and render component. Adding a
 * new lens = one entry. The shell handles URL state (?view=<id>) and
 * sidebar rendering for everything in this map.
 *
 * PR 5 ships an empty registry — every lens renders the shared
 * "Coming soon" placeholder. PRs 6-8 fill them in.
 */

import type { ComponentType, ReactNode } from "react";

export type LensId =
  | "overview"
  | "parameters"
  | "adaptation"
  | "modules"
  | "goals"
  | "topics"
  | "exam"
  | "plan"
  | "trajectory";

export type LensProps = {
  callerId: string;
};

export type LensDef = {
  label: string;
  /** Lucide icon name resolved by the shell so the registry stays a pure data file. */
  iconKey: string;
  /** Optional render component. When absent the shell renders the "Coming soon" body. */
  Component?: ComponentType<LensProps>;
  /** Optional short blurb describing what the lens shows — surfaces in Coming Soon body. */
  blurb?: string;
};

export const LENS_ORDER: LensId[] = [
  "overview",
  "parameters",
  "adaptation",
  "modules",
  "goals",
  "topics",
  "exam",
  "plan",
  "trajectory",
];

export const LENSES: Record<LensId, LensDef> = {
  overview: {
    label: "Overview",
    iconKey: "Gauge",
    blurb: "30-second read across this learner's whole progress picture.",
  },
  parameters: {
    label: "Parameters",
    iconKey: "BarChart3",
    blurb: "Per-parameter EQ mixer — scores + behaviour, course-default vs current.",
  },
  adaptation: {
    label: "Adaptation",
    iconKey: "Sliders",
    blurb: "How the system has personalised the experience, with reasons and tray-routed tuning chips.",
  },
  modules: {
    label: "Modules",
    iconKey: "BookOpen",
    blurb: "Module-mastery heatmap with drilldown to LO-level details.",
  },
  goals: {
    label: "Goals",
    iconKey: "Target",
    blurb: "Active + completed goals with confirm / dismiss action chips routed through the pending-changes tray.",
  },
  topics: {
    label: "Topics",
    iconKey: "MessageSquare",
    blurb: "Topic cloud sourced from memory summaries.",
  },
  exam: {
    label: "Exam readiness",
    iconKey: "ClipboardCheck",
    blurb: "Readiness donut + radar of weak modules + per-module heatmap.",
  },
  plan: {
    label: "Plan",
    iconKey: "CheckSquare",
    blurb: "Session timeline ribbon with status + what's-next inline reason.",
  },
  trajectory: {
    label: "Trajectory",
    iconKey: "Compass",
    blurb: "Learning trajectory — single canonical home post-cutover.",
  },
};

export function isLensId(value: string | null | undefined): value is LensId {
  if (!value) return false;
  return (LENS_ORDER as string[]).includes(value);
}

export type LensRenderInput = {
  id: LensId;
  iconNode: ReactNode;
};

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
import { ParametersLens } from "./ParametersLens";
import { AdaptationLens } from "./AdaptationLens";
import { ModulesLens } from "./ModulesLens";
import { GoalsLens } from "./GoalsLens";
import { TopicsLens } from "./TopicsLens";
import { ExamLens } from "./ExamLens";
import { OverviewLens } from "./OverviewLens";
import { PlanLens } from "./PlanLens";
import { TrajectoryLens } from "./TrajectoryLens";
import { QualificationLens } from "./QualificationLens";

export type LensId =
  | "overview"
  | "qualification"
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
  /** PR 7 — memory summary forwarded from CallerDetailPage for the TopicsLens. */
  memorySummary?: {
    topTopics?: { topic: string; lastMentioned?: string }[];
    topicCount?: number;
    factCount?: number;
    preferenceCount?: number;
    eventCount?: number;
  } | null;
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
  "qualification",
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
    Component: OverviewLens,
  },
  qualification: {
    label: "Qualification",
    iconKey: "Award",
    blurb: "Unit-by-unit + LO readiness across the whole regulated qualification family — Foundation, Developing, Practitioner, Distinction.",
    Component: QualificationLens,
  },
  parameters: {
    label: "Parameters",
    iconKey: "BarChart3",
    blurb: "Per-parameter EQ mixer — scores + behaviour, course-default vs current.",
    Component: ParametersLens,
  },
  adaptation: {
    label: "Adaptation",
    iconKey: "Sliders",
    blurb: "How the system has personalised the experience, with reasons and tray-routed tuning chips.",
    Component: AdaptationLens,
  },
  modules: {
    label: "Modules",
    iconKey: "BookOpen",
    blurb: "Module-mastery heatmap with drilldown to LO-level details.",
    Component: ModulesLens,
  },
  goals: {
    label: "Goals",
    iconKey: "Target",
    blurb: "Active + completed goals (action chips via the pending-changes tray ship in a follow-up).",
    Component: GoalsLens,
  },
  topics: {
    label: "Topics",
    iconKey: "MessageSquare",
    blurb: "Topic cloud sourced from memory summaries.",
    Component: TopicsLens,
  },
  exam: {
    label: "Exam readiness",
    iconKey: "ClipboardCheck",
    blurb: "Readiness donut + radar of weak modules + per-module heatmap.",
    Component: ExamLens,
  },
  plan: {
    label: "Plan",
    iconKey: "CheckSquare",
    blurb: "Session timeline ribbon — last 20 calls.",
    Component: PlanLens,
  },
  trajectory: {
    label: "Trajectory",
    iconKey: "Compass",
    blurb: "Learning trajectory — single canonical home post-cutover.",
    Component: TrajectoryLens,
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

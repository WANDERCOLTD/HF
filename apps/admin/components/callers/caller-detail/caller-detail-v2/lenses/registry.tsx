/**
 * Lens registry for Progress v2.
 *
 * Each lens declares an id, label, icon, and render component. Adding a
 * new lens = one entry. The shared `<ConsoleShell>` handles URL state
 * (?view=<id>) and sidebar rendering for everything in this map.
 *
 * Slice 0 of epic #1263 — extracted to consume `<ConsoleShell>` from
 * `components/shared/console-shell`. Behaviour unchanged.
 */

import React, { type ComponentType } from "react";
import {
  Gauge,
  BarChart3,
  Sliders,
  BookOpen,
  Target,
  MessageSquare,
  ClipboardCheck,
  CheckSquare,
  Compass,
  Award,
} from "lucide-react";
import type { ConsoleLensDef } from "@/components/shared/console-shell";
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

/** Local alias so this file's call sites stay readable. */
export type LensDef = ConsoleLensDef<LensProps>;

function withId<TId extends string>(
  id: TId,
  rest: Omit<ConsoleLensDef<LensProps>, "id">,
): ConsoleLensDef<LensProps> {
  return { id, ...rest };
}

const ICON_SIZE = 14;
const lensEntry = (
  id: LensId,
  label: string,
  Icon: ComponentType<{ size?: number }>,
  blurb: string,
  Component?: ComponentType<LensProps>,
): LensDef => withId(id, { label, iconNode: <Icon size={ICON_SIZE} />, blurb, Component });

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
  overview: lensEntry(
    "overview",
    "Overview",
    Gauge,
    "30-second read across this learner's whole progress picture.",
    OverviewLens,
  ),
  qualification: lensEntry(
    "qualification",
    "Qualification",
    Award,
    "Unit-by-unit + LO readiness across the whole regulated qualification family — Foundation, Developing, Practitioner, Distinction.",
    QualificationLens,
  ),
  parameters: lensEntry(
    "parameters",
    "Parameters",
    BarChart3,
    "Per-parameter EQ mixer — scores + behaviour, course-default vs current.",
    ParametersLens,
  ),
  adaptation: lensEntry(
    "adaptation",
    "Adaptation",
    Sliders,
    "How the system has personalised the experience, with reasons and tray-routed tuning chips.",
    AdaptationLens,
  ),
  modules: lensEntry(
    "modules",
    "Modules",
    BookOpen,
    "Module-mastery heatmap with drilldown to LO-level details.",
    ModulesLens,
  ),
  goals: lensEntry(
    "goals",
    "Goals",
    Target,
    "Active + completed goals (action chips via the pending-changes tray ship in a follow-up).",
    GoalsLens,
  ),
  topics: lensEntry(
    "topics",
    "Topics",
    MessageSquare,
    "Topic cloud sourced from memory summaries.",
    TopicsLens,
  ),
  exam: lensEntry(
    "exam",
    "Exam readiness",
    ClipboardCheck,
    "Readiness donut + radar of weak modules + per-module heatmap.",
    ExamLens,
  ),
  plan: lensEntry(
    "plan",
    "Plan",
    CheckSquare,
    "Session timeline ribbon — last 20 calls.",
    PlanLens,
  ),
  trajectory: lensEntry(
    "trajectory",
    "Trajectory",
    Compass,
    "Learning trajectory — single canonical home post-cutover.",
    TrajectoryLens,
  ),
};

export function isLensId(value: string | null | undefined): value is LensId {
  if (!value) return false;
  return (LENS_ORDER as string[]).includes(value);
}

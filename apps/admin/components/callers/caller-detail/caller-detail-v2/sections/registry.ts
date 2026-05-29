/**
 * Section registry for Uplift v2 (and a parallel registry for Progress v2 in PR 5).
 *
 * Sections slot into the page grid by id. Each section declares its render
 * component and a `span` (1–12 columns in the page grid). Adding a new section
 * is a single object append — no boilerplate.
 */

import type { ComponentType } from "react";
import { HeroSection } from "./HeroSection";
import { ModulesSection } from "./ModulesSection";
import { AdaptationSection } from "./AdaptationSection";
import { ScoreTrendsSection } from "./ScoreTrendsSection";
import { GoalsSection } from "./GoalsSection";
import { EngagementSection } from "./EngagementSection";
import { SkillChartSection } from "./SkillChartSection";
import { TopicsSection } from "./TopicsSection";

export type UpliftSectionId =
  | "hero"
  | "skill-chart"
  | "modules"
  | "goals"
  | "score-trends"
  | "adaptation"
  | "topics"
  | "engagement";

export type UpliftSectionProps = {
  callerId: string;
  /** Raw per-call CallScore rows — needed by SkillChartSection (PR 4). */
  scores?: unknown[];
  /** CallerTarget rows including currentScore — also for SkillChartSection. */
  callerTargets?: unknown[];
  /** MemorySummary.topTopics + counts — feeds TopicsSection (PR 4). */
  memorySummary?: {
    topTopics?: { topic: string; lastMentioned?: string }[];
    topicCount?: number;
    factCount?: number;
    preferenceCount?: number;
    eventCount?: number;
  } | null;
};

export type SectionDef = {
  /** Display order; lower renders first. */
  order: number;
  /** Column span in the 12-col page grid. Defaults to full (12). */
  span?: 12 | 6 | 4 | 8;
  /** Render component for the section. Receives `callerId`. */
  Component: ComponentType<UpliftSectionProps>;
  /** Short label for "Coming soon" placeholder until Component lands. */
  comingSoonLabel?: string;
};

/**
 * Active sections render in `order`. Sections without a `Component` are
 * shown as "Coming soon" placeholders so the layout is visible end-to-end
 * even while individual sections are still being built.
 *
 * PR 1a shipped with an empty registry. PR 1b adds Hero and Modules.
 * PRs 2–4 fill in the rest.
 */
export const UPLIFT_SECTIONS: Partial<Record<UpliftSectionId, SectionDef>> = {
  hero: {
    order: 10,
    span: 12,
    Component: HeroSection,
  },
  adaptation: {
    // Promoted to order 15 — sits between Hero and Skill Chart so the
    // personalisation signature surfaces immediately after the headline
    // ring.
    order: 15,
    span: 12,
    Component: AdaptationSection,
  },
  "skill-chart": {
    order: 20,
    span: 12,
    Component: SkillChartSection,
  },
  modules: {
    order: 30,
    span: 12,
    Component: ModulesSection,
  },
  goals: {
    order: 40,
    span: 12,
    Component: GoalsSection,
  },
  "score-trends": {
    order: 50,
    span: 6,
    Component: ScoreTrendsSection,
  },
  topics: {
    order: 70,
    span: 6,
    Component: TopicsSection,
  },
  engagement: {
    order: 80,
    span: 6,
    Component: EngagementSection,
  },
};

/**
 * Placeholder catalogue — used to render "Coming soon" tiles for sections
 * not yet implemented. Same order as the final registry so the layout matches.
 */
export const UPLIFT_PLACEHOLDERS: Record<
  UpliftSectionId,
  { order: number; label: string; span?: SectionDef["span"] }
> = {
  hero: { order: 10, label: "Hero — Mastery / Confidence / Knowledge", span: 12 },
  adaptation: { order: 15, label: "How we adapted for you", span: 12 },
  "skill-chart": { order: 20, label: "Skill chart + radar", span: 12 },
  modules: { order: 30, label: "Module mastery (heatmap)", span: 12 },
  goals: { order: 40, label: "Goals achieved", span: 12 },
  "score-trends": { order: 50, label: "Score trends", span: 6 },
  topics: { order: 70, label: "Topics covered", span: 6 },
  engagement: { order: 80, label: "Engagement", span: 6 },
};

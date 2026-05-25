/**
 * Activities Transform
 *
 * Reads ACTIVITY-001 spec from systemSpecs, cross-references with caller
 * personality, mastery level, session phase, and time gaps to produce
 * a context-aware activity toolkit for the voice prompt.
 *
 * The AI uses this toolkit to decide WHEN and HOW to deploy interactive
 * activities during a call (pop quizzes, MCQs, scenarios, etc.).
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue } from "../types";
import type { AssembledContext, SystemSpecData } from "../types";
import type { PlaybookConfig, SpecConfig } from "@/lib/types/json-fields";

// ─── Types ───────────────────────────────────────────────────────

interface ActivityDef {
  id: string;
  name: string;
  channel: "voice" | "text";
  category: string;
  description: string;
  format: {
    steps: string[];
    duration: string;
    text_template?: string;
    difficulty_range?: string;
  };
  triggers: {
    when: string[];
    avoid_when: string[];
  };
  personality_adaptations: Record<string, string>;
}

interface SelectionStrategy {
  principles: string[];
  session_phase_recommendations: Record<string, string[]>;
  mastery_level_recommendations: Record<string, string[]>;
  max_activities_per_session: number;
  max_text_messages_per_week: number;
  min_minutes_between_activities: number;
}

interface RecommendedActivity {
  id: string;
  name: string;
  channel: "voice" | "text";
  reason: string;
  format_steps: string[];
  adaptations: string[];
  text_template?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Find the ACTIVITY spec in system specs.
 * Looks for slug containing "ACTIVITY" or specRole ORCHESTRATE + domain "pedagogy".
 */
function findActivitySpec(systemSpecs: SystemSpecData[]): SystemSpecData | null {
  return systemSpecs.find(
    (s) => s.slug?.toUpperCase().includes("ACTIVITY"),
  ) || null;
}

/**
 * Determine caller's mastery level based on shared state.
 */
function getMasteryLevel(context: AssembledContext): string {
  const { completedModules, modules, estimatedProgress } = context.sharedState;
  if (modules.length === 0) return "novice";
  const ratio = completedModules.size / Math.max(modules.length, 1);
  if (ratio >= 0.8) return "mastered";
  if (ratio >= 0.5) return "proficient";
  if (ratio >= 0.2) return "developing";
  return "novice";
}

/**
 * Determine current session phase based on pedagogy output.
 */
function getCurrentPhase(context: AssembledContext): string | null {
  const pedagogy = context.sections.instructions_pedagogy;
  if (!pedagogy) return null;

  if (pedagogy.sessionType === "FIRST_CALL") return "new_material";

  // For returning callers, infer phase from review type
  const { reviewType } = context.sharedState;
  if (reviewType === "quick_recall" || reviewType === "application") return "spaced_retrieval";
  if (reviewType === "deep_review" || reviewType === "reintroduce") return "reconnect";
  return "integrate";
}

/**
 * Get personality trait levels from the personality section.
 */
function getTraitLevels(context: AssembledContext): Record<string, string> {
  const traits = context.sections.personality?.traits;
  if (!traits) return {};

  const levels: Record<string, string> = {};
  for (const [name, trait] of Object.entries(traits) as [string, any][]) {
    if (trait.level) {
      levels[name.toLowerCase()] = trait.level.toLowerCase();
    }
  }
  return levels;
}

/**
 * Score an activity for relevance given current context.
 *
 * `suppressAssessment` is the gate for the historical "first call =
 * no assessment activities" penalty. Caller computes it from
 * `isFirstCall && firstCallMode === 'onboarding'` so the penalty only
 * fires when the playbook is in the default onboarding mode (#797).
 * `teach_immediately` and `baseline_assessment` modes pass `false`
 * here — `baseline_assessment` actively WANTS assessment activities
 * on call 1; `teach_immediately` treats call 1 like a normal teaching
 * call where assessment is allowed.
 */
function scoreActivity(
  activity: ActivityDef,
  phase: string | null,
  masteryLevel: string,
  traitLevels: Record<string, string>,
  suppressAssessment: boolean,
  strategy: SelectionStrategy,
): { score: number; reason: string } {
  let score = 0;
  let reason = "";

  // Phase match
  if (phase && strategy.session_phase_recommendations[phase]?.includes(activity.id)) {
    score += 3;
    reason = `Fits ${phase} phase`;
  }

  // Mastery level match
  if (strategy.mastery_level_recommendations[masteryLevel]?.includes(activity.id)) {
    score += 2;
    if (!reason) reason = `Matches ${masteryLevel} mastery level`;
  }

  // First-call assessment suppression — gated on firstCallMode (#797).
  // Penalty magnitude unchanged from the prior unconditional `isFirstCall`
  // version; only the trigger condition is now mode-aware.
  if (suppressAssessment && activity.category === "assessment") {
    score -= 2;
  }

  // Text channel gets slight penalty (requires infrastructure, caller attention)
  if (activity.channel === "text") {
    score -= 1;
  }

  // Personality boost: if activity has an adaptation matching a non-moderate trait
  for (const [traitKey, adaptation] of Object.entries(activity.personality_adaptations)) {
    // traitKey format: "high_openness" or "low_extraversion"
    const [level, ...nameParts] = traitKey.split("_");
    const traitName = nameParts.join("_");
    if (traitLevels[traitName] === level) {
      score += 1;
    }
  }

  if (!reason && score > 0) reason = "General fit";
  return { score, reason };
}

// ─── Transform ───────────────────────────────────────────────────

registerTransform("computeActivityToolkit", (
  _rawData: any,
  context: AssembledContext,
) => {
  const activitySpec = findActivitySpec(context.loadedData.systemSpecs);

  if (!activitySpec?.config) {
    return {
      hasActivities: false,
      recommended: [],
      principles: [],
    };
  }

  const specConfig = activitySpec.config as SpecConfig;

  // Extract catalog and strategy from spec config.
  // The seed script for ORCHESTRATE specs flattens parameter configs onto the root,
  // so we handle both nested shapes (direct from JSON) and flat shapes (from DB).
  const catalogParam = specConfig.activity_catalog || specConfig.activities;
  const strategyParam = specConfig.selection_strategy || specConfig.strategy;

  // Activities: either nested { activities: [...] } or flat array
  const activities: ActivityDef[] = catalogParam?.activities || catalogParam || [];

  // Strategy: either nested object or properties flattened onto root config
  const strategy: SelectionStrategy = strategyParam || {
    principles: specConfig.principles || [],
    session_phase_recommendations: specConfig.session_phase_recommendations || {},
    mastery_level_recommendations: specConfig.mastery_level_recommendations || {},
    max_activities_per_session: specConfig.max_activities_per_session || 2,
    max_text_messages_per_week: specConfig.max_text_messages_per_week || 2,
    min_minutes_between_activities: specConfig.min_minutes_between_activities || 5,
  };

  if (activities.length === 0) {
    return {
      hasActivities: false,
      recommended: [],
      principles: strategy.principles || [],
    };
  }

  // Gather context signals
  const phase = getCurrentPhase(context);
  const masteryLevel = getMasteryLevel(context);
  const traitLevels = getTraitLevels(context);
  const { isFirstCall } = context.sharedState;

  // #797 — first-call assessment suppression is now keyed on firstCallMode
  // (#790). Only the default 'onboarding' mode keeps the historical
  // "no assessment on call 1" penalty. 'teach_immediately' treats call 1
  // like a normal teaching call; 'baseline_assessment' actively wants
  // assessment activities (diagnostic-only first call). Same access
  // pattern as transforms/pedagogy.ts.
  const firstCallMode =
    (context.loadedData.playbooks?.[0]?.config as PlaybookConfig | undefined)
      ?.firstCallMode ?? "onboarding";
  const suppressAssessment = isFirstCall && firstCallMode === "onboarding";

  // Score and rank activities
  const scored = activities.map((activity) => {
    const { score, reason } = scoreActivity(
      activity, phase, masteryLevel, traitLevels, suppressAssessment, strategy,
    );
    return { activity, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);

  // Take top activities (max from strategy, default 2)
  const maxActivities = strategy.max_activities_per_session || 2;
  const topActivities = scored
    .filter((s) => s.score > 0)
    .slice(0, maxActivities);

  // Build recommended activities with personality adaptations
  const recommended: RecommendedActivity[] = topActivities.map(({ activity, reason }) => {
    // Collect applicable personality adaptations
    const adaptations: string[] = [];
    for (const [traitKey, adaptation] of Object.entries(activity.personality_adaptations)) {
      const [level, ...nameParts] = traitKey.split("_");
      const traitName = nameParts.join("_");
      if (traitLevels[traitName] === level) {
        adaptations.push(adaptation);
      }
    }

    return {
      id: activity.id,
      name: activity.name,
      channel: activity.channel,
      reason,
      format_steps: activity.format.steps,
      adaptations,
      ...(activity.format.text_template ? { text_template: activity.format.text_template } : {}),
    };
  });

  return {
    hasActivities: true,
    recommended,
    all_available: activities.map((a) => ({
      id: a.id,
      name: a.name,
      channel: a.channel,
      category: a.category,
    })),
    context_signals: {
      session_phase: phase,
      mastery_level: masteryLevel,
      is_first_call: isFirstCall,
      days_since_last_call: context.sharedState.daysSinceLastCall,
    },
    principles: strategy.principles || [],
    limits: {
      max_per_session: maxActivities,
      min_minutes_apart: strategy.min_minutes_between_activities || 5,
    },
  };
});

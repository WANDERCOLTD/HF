/**
 * Instructions Transform
 * Assembled from multiple sub-sections.
 * Extracted from route.ts lines 1929-2334
 *
 * This is the meta-transform that references prior section outputs
 * (memories, personality, targets, curriculum, goals, identity, content)
 * and assembles the `instructions` object.
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue, getAttributeValue } from "../types";
import { computePersonalityAdaptation } from "./personality";
import type { AssembledContext, CallerAttributeData, GoalData, SubjectSourcesData } from "../types";
import type { SpecConfig } from "@/lib/types/json-fields";
import { resolveTeachingProfile } from "@/lib/content-trust/teaching-profiles";

// Goal-type × progress-bracket adaptation guidance.
// Tells the AI HOW to adapt teaching based on goal type and progress level.
const GOAL_ADAPTATION: Record<string, [low: string, mid: string, high: string]> = {
  LEARN:   ["Introduce concepts gently, check understanding frequently", "Build on prior foundations, connect to what they already know", "Challenge with application, prepare for mastery"],
  ACHIEVE: ["Clarify what success looks like, break into steps", "Track milestones, celebrate progress", "Focus on final steps, anticipate obstacles"],
  CHANGE:  ["Explore motivation, validate feelings", "Practice new behaviours, reflect on changes", "Reinforce new habits, plan sustainability"],
  CONNECT: ["Build trust, find common ground", "Deepen relationship, share openly", "Maintain connection, mutual exchange"],
  SUPPORT: ["Listen actively, understand needs", "Provide targeted support, check coping", "Evaluate effectiveness, plan independence"],
  CREATE:  ["Brainstorm freely, no judgment", "Iterate and refine, give constructive feedback", "Polish and finish, celebrate creation"],
};

/** Build a compact, type-aware adaptation instruction string for the AI. */
export function goalAdaptationGuidance(goals: GoalData[]): string {
  const top = goals.slice(0, 3);
  if (top.length === 0) {
    return "No specific session goals set — explore learner interests and set goals collaboratively.";
  }

  const lines = top.map((g, i) => {
    const bracket = g.progress < 0.3 ? 0 : g.progress < 0.7 ? 1 : 2;
    const guidance = (GOAL_ADAPTATION[g.type] || GOAL_ADAPTATION.LEARN)[bracket];
    const pct = Math.round(g.progress * 100);
    const assessmentTag = g.isAssessmentTarget ? ", assessment target" : "";
    const threshold = g.isAssessmentTarget && g.assessmentConfig?.threshold
      ? `, target: ${Math.round(g.assessmentConfig.threshold * 100)}%`
      : "";
    return `${i + 1}. "${g.name}" (${g.type}, ${pct}%${assessmentTag}${threshold}) — ${guidance}.`;
  });

  return `Session goals:\n${lines.join("\n")}`;
}

// Structural defaults for common memory keys — used when COMP-001 doesn't provide narrativeTemplates
const DEFAULT_NARRATIVE_TEMPLATES: Record<string, string> = {
  location: "They live in {value}",
  occupation: "They work as {value}",
  job: "They work as {value}",
  name: "They go by {value}",
  preferred_name: "They prefer to be called {value}",
  learning_style: "They learn best with {value} approaches",
  family: "Family: {value}",
  children: "They have {value}",
  goal: "They're working toward {value}",
  exam_date: "Their exam is {value}",
  diet: "Diet note: {value}",
};

/**
 * Build narrative sentences from memories using spec-driven templates.
 *
 * Templates come from COMP-001 memory_section.config.narrativeTemplates.
 * Unknown keys fall back to genericNarrativeTemplate (also from spec).
 * If no spec config is provided, uses structural defaults for common keys.
 *
 * @param memories - Array of { key, value, category? } objects
 * @param specConfig - narrativeTemplates and genericNarrativeTemplate from COMP-001
 * @returns A single narrative string, or empty string if no memories
 */
export function narrativeFrame(
  memories: Array<{ key: string; value: string; category?: string }>,
  specConfig: {
    narrativeTemplates?: Record<string, string>;
    genericNarrativeTemplate?: string;
  },
): string {
  if (!memories || memories.length === 0) return "";

  const templates = specConfig.narrativeTemplates || DEFAULT_NARRATIVE_TEMPLATES;
  const genericTemplate = specConfig.genericNarrativeTemplate || "They mentioned their {key} is {value}";

  const sentences = memories.map((m) => {
    const normalizedKey = m.key.toLowerCase().replace(/\s+/g, "_");
    const template = templates[normalizedKey];

    if (template) {
      return template.replace(/\{value\}/g, m.value);
    }

    // Humanize the key: underscores → spaces
    const humanKey = normalizedKey.replace(/_/g, " ");
    return genericTemplate
      .replace(/\{key\}/g, humanKey)
      .replace(/\{value\}/g, m.value);
  });

  return sentences.join(". ") + ".";
}

registerTransform("computeInstructions", (
  _rawData: any,
  context: AssembledContext,
) => {
  const { sections, loadedData, sharedState, resolvedSpecs } = context;
  const { thresholds, modules, isFirstCall, moduleToReview, nextModule, completedModules, lockedModule, workingSet } = sharedState;
  const personality = loadedData.personality;
  const callerAttributes = loadedData.callerAttributes;
  const learnerGoals = loadedData.goals;
  const curriculumName = (sharedState as Record<string, any>).curriculumName as string | null;

  // Get memory groups from the memories section output
  const memoryGroups = sections.memories?.byCategory || {};

  // Get merged targets from behavior_targets section
  const mergedTargets = sections.behaviorTargets?._merged || sections.behaviorTargets?.all || [];

  // Memory instruction config from COMP-001 spec (zero hardcoding)
  const memSectionConfig = (context.specConfig?.parameters as Array<{ id: string; config?: SpecConfig }>)?.find(
    (p) => p.id === "memory_section"
  )?.config || context.specConfig;

  // Category selection for instructions — from spec config or structural defaults
  const instructionCategories: Record<string, number> = memSectionConfig.instructionCategoryLimits || {
    FACT: 3, RELATIONSHIP: 2, CONTEXT: 2,
  };
  const preferencesLimit: number = memSectionConfig.preferencesLimit || 4;
  const topicsLimit: number = memSectionConfig.topicsLimit || 3;

  return {
    // Use memories — narrative framing from COMP-001 spec templates
    use_memories: (() => {
      // Build relevant memories from spec-configured categories
      const relevantMemories: Array<{ key: string; value: string; category?: string }> = [];
      for (const [cat, limit] of Object.entries(instructionCategories)) {
        const mems = memoryGroups[cat]?.slice(0, limit) || [];
        relevantMemories.push(...mems);
      }

      if (relevantMemories.length > 0) {
        const narrative = narrativeFrame(relevantMemories, memSectionConfig);
        return `What you know about this caller: ${narrative} Reference these details naturally in conversation.`;
      }

      // Check if any other categories have data
      const otherCategories = Object.keys(memoryGroups).filter(
        (cat) => !instructionCategories[cat] && (memoryGroups[cat]?.length || 0) > 0
      );

      if (otherCategories.length > 0) {
        return `No biographical facts recorded yet. See ${otherCategories.join(" and ").toLowerCase()} below. Build rapport naturally.`;
      }

      return "No specific memories recorded yet. Build rapport and learn about them.";
    })(),

    // Use preferences — narrative framing from COMP-001 spec templates
    use_preferences: (() => {
      // Pull preferences from all categories that exist (dynamic)
      const prefs = (memoryGroups["PREFERENCE"] || []).slice(0, preferencesLimit);
      if (prefs.length === 0) {
        return "No preferences recorded yet. Observe their communication style.";
      }
      const narrative = narrativeFrame(prefs, memSectionConfig);
      return `Respect caller preferences: ${narrative}`;
    })(),

    // Use topics
    use_topics: (() => {
      const topics = (memoryGroups["TOPIC"] || []).slice(0, topicsLimit);
      const interestPrefs = (memoryGroups["PREFERENCE"] || [])
        .filter((m: any) => m.key.toLowerCase().includes("interest"))
        .slice(0, 2);
      const allTopics = [...topics.map((m: any) => m.value), ...interestPrefs.map((m: any) => m.value)];
      if (allTopics.length === 0) {
        return "No specific topics of interest recorded yet.";
      }
      return `Topics of interest to explore: ${allTopics.join(", ")}`;
    })(),

    // Interest handling
    interest_handling: (() => {
      const interestPrefs = (memoryGroups["PREFERENCE"] || [])
        .filter((m: any) => m.key.toLowerCase().includes("interest"));

      if (interestPrefs.length === 0 || modules.length === 0) return null;

      const currentModuleIndex = moduleToReview ? modules.findIndex((m: any) => m.slug === moduleToReview.slug) : 0;
      const futureModules = modules.slice(currentModuleIndex + 1);

      const futureInterests: string[] = [];
      for (const pref of interestPrefs) {
        const interestValue = pref.value.toLowerCase();
        const interestKey = pref.key.toLowerCase();
        for (const mod of futureModules) {
          const modName = mod.name.toLowerCase();
          const modDesc = (mod.description || "").toLowerCase();
          if (modName.includes(interestValue) || modDesc.includes(interestValue) ||
              interestValue.includes(modName) || interestKey.includes(mod.slug)) {
            futureInterests.push(`"${pref.value}" relates to module "${mod.name}" (coming later)`);
          }
        }
      }

      if (futureInterests.length === 0) return null;

      return {
        tension: futureInterests,
        guidance: "When caller asks about these future topics: acknowledge their interest, note it connects to upcoming material, then gently redirect: 'Great question - we'll dig into that when we get to [module]. For now, let's build the foundation with [current topic].'",
        avoid: "Don't ignore their interest or dismiss it. Don't skip ahead. Don't give a detailed answer that requires context they don't have yet.",
      };
    })(),

    // Personality adaptation (route.ts lines 2017-2075)
    personality_adaptation: computePersonalityAdaptation(personality, thresholds),

    // Behavior targets summary (route.ts lines 2076-2087)
    behavior_targets_summary: mergedTargets.slice(0, 5).map((t: any) => ({
      what: t.parameter?.name || t.name || t.parameterId,
      target: classifyValue(t.targetValue, thresholds),
      meaning: t.targetValue >= thresholds.high
        ? (t.parameter?.interpretationHigh || t.when_high)
        : t.targetValue <= thresholds.low
          ? (t.parameter?.interpretationLow || t.when_low)
          : (t.parameter?.interpretationHigh || t.when_high) && (t.parameter?.interpretationLow || t.when_low)
            ? (() => {
                const high = String(t.parameter?.interpretationHigh || t.when_high || "").split(",")[0].trim();
                const low = String(t.parameter?.interpretationLow || t.when_low || "").split(",")[0].toLowerCase().trim();
                return `Balance: ${high} while also ${low}`;
              })()
            : (t.parameter?.interpretationHigh || t.when_high) || (t.parameter?.interpretationLow || t.when_low) || "balanced approach",
    })),

    // Curriculum guidance (route.ts lines 2091-2145)
    curriculum_guidance: (() => {
      const parts: string[] = [];

      if (modules.length > 0) {
        parts.push(`Curriculum: ${curriculumName || "Learning"} (${modules.length} modules)`);
        parts.push(`Progress: ${completedModules.size}/${modules.length} completed`);

        if (lockedModule) {
          // Module Picker override — scheduler frontier is bypassed
          parts.push(`LEARNER SELECTED MODULE: "${lockedModule.name}" — focus this session entirely on it.`);
        } else if (isFirstCall && modules[0]) {
          parts.push(`THIS SESSION: First call - introduce "${modules[0].name}"`);
        } else if (moduleToReview && nextModule && moduleToReview.slug !== nextModule.slug) {
          parts.push(`THIS SESSION: Review "${moduleToReview.name}" → Introduce "${nextModule.name}"`);
        } else if (nextModule) {
          parts.push(`THIS SESSION: Continue with "${nextModule.name}"`);
        } else if (moduleToReview) {
          parts.push(`THIS SESSION: Deepen mastery of "${moduleToReview.name}"`);
        }

        // Today's selected learning outcomes (#306) — surfaced from scheduler
        // working set. Skipped silently when working set is empty (e.g. courses
        // without curriculum structure produce no selectedLOs).
        const selectedLOs = workingSet?.selectedLOs ?? [];
        if (selectedLOs.length > 0) {
          const loLines = selectedLOs.map((lo) => {
            const desc = lo.description?.trim();
            return desc ? `${lo.ref} — ${desc}` : lo.ref;
          });
          parts.push(`Today's learning outcomes: ${loLines.join("; ")}`);
        }
      }

      const nextContent = callerAttributes.filter((a: CallerAttributeData) =>
        a.key.includes("next_") || a.key.includes("ready_for")
      );
      const currentModule = callerAttributes.find((a: CallerAttributeData) =>
        a.key.includes("current_module") || a.key.includes("active_module")
      );
      const mastery = callerAttributes.find((a: CallerAttributeData) =>
        a.key.includes("mastery") && !a.key.includes("mastery_")
      );

      if (currentModule) parts.push(`Current module: ${getAttributeValue(currentModule)}`);
      if (mastery) {
        const masteryVal = getAttributeValue(mastery);
        parts.push(`Mastery level: ${typeof masteryVal === "number" ? (masteryVal * 100).toFixed(0) + "%" : masteryVal}`);
      }
      if (nextContent.length > 0) {
        parts.push(`Next content to cover: ${nextContent.map((a: CallerAttributeData) => getAttributeValue(a)).join(", ")}`);
      }

      if (parts.length === 0) return "No curriculum progress tracked yet - start with first module.";
      return parts.join(". ");
    })(),

    // Session guidance — goal-type-aware adaptation instructions
    session_guidance: goalAdaptationGuidance(learnerGoals),

    // Teaching content — approved teaching points from verified sources
    teaching_content: (() => {
      const tc = sections.teachingContent;
      if (!tc?.hasTeachingContent) return null;
      return tc.teachingPoints;
    })(),

    // Course instructions — tutor rules from COURSE_REFERENCE documents
    course_instructions: (() => {
      const ci = sections.courseInstructions;
      if (!ci?.hasCourseInstructions) return null;
      return ci.courseRules;
    })(),

    // Subject methodology — delivery hints from the subject's teaching profile
    subject_methodology: (() => {
      const subjectSources = loadedData.subjectSources as SubjectSourcesData | null;
      const firstSubject = subjectSources?.subjects?.[0];
      if (!firstSubject) return null;

      const resolved = resolveTeachingProfile(firstSubject);
      if (!resolved || resolved.deliveryHints.length === 0) return null;

      return {
        profile: resolved.key,
        rules: resolved.deliveryHints.map((hint) => `- ${hint}`).join("\n"),
      };
    })(),

    // Session pedagogy — delegates to separate transform (already computed)
    session_pedagogy: sections.instructions_pedagogy || null,

    // Voice — delegates to separate transform (already computed)
    voice: sections.instructions_voice || null,
  };
});

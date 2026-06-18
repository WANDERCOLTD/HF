/**
 * Instructions Transform
 * Assembled from multiple sub-sections.
 * Extracted from route.ts lines 1929-2334
 *
 * This is the meta-transform that references prior section outputs
 * (memories, personality, targets, curriculum, goals, identity, content)
 * and assembles the `instructions` object.
 *
 * @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
 * Producer↔consumer pairing sentinel — `composition-directive-needs-renderer`
 * ESLint rule + `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`
 * vitest enforce that every `directive: "…"` field below has a paired
 * push in renderPromptSummary.ts. Born of PR #1768 silently dropping
 * 5 consumer pushes; see `.claude/rules/lattice-survey.md`.
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue } from "../types";
import { computePersonalityAdaptation } from "./personality";
import type { AssembledContext, GoalData, SubjectSourcesData } from "../types";
import type { AuthoredModule, PlaybookConfig, SpecConfig } from "@/lib/types/json-fields";
import { resolveTeachingProfile } from "@/lib/content-trust/teaching-profiles";
import { isIeltsModuleSettingsEnabled } from "@/lib/journey/module-settings-flag";

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
  const { thresholds, modules, isFirstCall, moduleToReview, nextModule, completedModules } = sharedState;
  const personality = loadedData.personality;
  // callerAttributes used to drive the legacy "next_module / mastery" string-
  // match filter — removed per composition-transforms audit. If a richer
  // per-attribute hint surface returns it should hydrate from
  // CallerModuleProgress (relational) instead.
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

        if (isFirstCall && modules[0]) {
          parts.push(`THIS SESSION: First call - introduce "${modules[0].name}"`);
        } else if (moduleToReview && nextModule && moduleToReview.slug !== nextModule.slug) {
          parts.push(`THIS SESSION: Review "${moduleToReview.name}" → Introduce "${nextModule.name}"`);
        } else if (nextModule) {
          parts.push(`THIS SESSION: Continue with "${nextModule.name}"`);
        } else if (moduleToReview) {
          parts.push(`THIS SESSION: Deepen mastery of "${moduleToReview.name}"`);
        }
      }

      // Composition transforms audit follow-up: the original code here
      // string-matched callerAttributes for `next_*`, `current_module`,
      // `mastery` keys — that was the pre-projection extraction scheme.
      // Projection-era courses store this data in CallerModuleProgress
      // (relational), so the legacy filter returned empty for every new
      // course. The sharedState.modules / completedModules / nextModule
      // block above already renders the primary curriculum guidance from
      // the canonical (DB-first) modules pipeline — so removing the legacy
      // filter only loses decorative duplication, not real signal.
      //
      // TODO(follow-up): if richer per-attribute hints are desired, hydrate
      // from CallerModuleProgress rows instead of CallerAttribute keys.

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

    // #1732 (epic #1730 G8 consumer A) — module-scoped question count
    // directive. Resolves `Playbook.config.modules[].settings.questionTarget`
    // against `sharedState.lockedModule`. Gated by
    // `HF_FLAG_IELTS_MODULE_SETTINGS` per epic #1700 decision 5. Returns
    // null (renders nothing) when any condition fails.
    module_question_target: resolveModuleQuestionTarget(
      (loadedData.playbooks?.[0]?.config ?? {}) as PlaybookConfig,
      sharedState,
    ),

    // #1733 (epic #1730 G8 consumer B) — module-scoped cue card. Picks
    // one card from `Playbook.config.modules[].settings.cueCardPool`
    // deterministically by `sharedState.callNumber` so the same call
    // always sees the same card (idempotent reads). Gated by
    // `HF_FLAG_IELTS_MODULE_SETTINGS` per epic #1700 decision 5.
    // Theme 3 (`<PinnedCardSlot>`) will cache the pick to
    // `Session.metadata.pinnedCard` later for cross-process consistency.
    module_cue_card: resolveModuleCueCard(
      (loadedData.playbooks?.[0]?.config ?? {}) as PlaybookConfig,
      sharedState,
    ),

    // #1735 (epic #1730 G8 consumer D) — module-scoped first-time
    // orientation line. Renders ONLY when the learner has never seen
    // this module's orientation yet (`CallerModuleProgress.orientationShown
    // === false`). After the line renders, `endSession` writes
    // orientationShown=true so subsequent calls skip it. Gated by
    // `HF_FLAG_IELTS_MODULE_SETTINGS` per epic #1700 decision 5.
    //
    // RESTORED 2026-06-17 after the producer was silently dropped by
    // PR #1768 (Theme 10 profile capture) along with its renderer
    // consumer. The composition-coverage test at
    // `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`
    // now structurally guards against this regression class.
    module_orientation_line: resolveModuleOrientationLine(
      (loadedData.playbooks?.[0]?.config ?? {}) as PlaybookConfig,
      sharedState,
      loadedData,
    ),

    // #1932 (epic #1931 Template Authority) — module-scoped topic pool.
    // Reads `Playbook.config.modules[].settings.topicPool` for the locked
    // module and picks ONE topic deterministically by
    // `sharedState.callNumber % pool.length`. Same call sees the same
    // topic across re-renders (idempotent). Drives student-led practice
    // modules (Part 1 frames, Part 3 themes) — the tutor anchors on the
    // picked topic and asks the listed questions.
    //
    // Gated by `HF_FLAG_IELTS_MODULE_SETTINGS` per epic #1700 decision 5.
    module_topic_pool: resolveModuleTopicPool(
      (loadedData.playbooks?.[0]?.config ?? {}) as PlaybookConfig,
      sharedState,
    ),
  };
});

/**
 * #1732 (epic #1730 G8 consumer A) — module-scoped question count directive.
 *
 * Returns a directive string when ALL conditions hold:
 *   - `HF_FLAG_IELTS_MODULE_SETTINGS=true` (epic #1700 decision 5)
 *   - `sharedState.lockedModule` is set (learner picked a specific module
 *     via the Module Picker)
 *   - An `AuthoredModule` in `Playbook.config.modules[]` matches the
 *     locked module by `id` (and falls back to `slug` if id is absent)
 *   - That module's `settings.questionTarget` has both `min` and `target`
 *     as positive integers with `min <= target`
 *
 * Returns `null` otherwise — the instructions section renders without
 * the question-count directive and the existing teaching cadence owns
 * pacing.
 *
 * Returned shape: `{ min, target, directive }` so renderers can either
 * use the structured fields or the pre-formatted directive sentence.
 */
function resolveModuleQuestionTarget(
  config: PlaybookConfig,
  sharedState: AssembledContext["sharedState"],
): { min: number; target: number; directive: string } | null {
  if (!isIeltsModuleSettingsEnabled()) return null;
  const lockedModule = sharedState.lockedModule;
  if (!lockedModule) return null;

  const authoredModules: AuthoredModule[] = config.modules ?? [];
  const matched = authoredModules.find(
    (m) => m.id === lockedModule.id || m.id === lockedModule.slug,
  );
  if (!matched) return null;

  const qt = matched.settings?.questionTarget;
  if (!qt) return null;
  const { min, target } = qt;
  if (
    typeof min !== "number" ||
    typeof target !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(target) ||
    min < 1 ||
    target < min
  ) {
    return null;
  }
  return {
    min,
    target,
    directive: `Aim for ${min} to ${target} questions in this module — track silently as you go.`,
  };
}

/**
 * #1733 (epic #1730 G8 consumer B) — module-scoped cue card pick.
 *
 * Reads `Playbook.config.modules[].settings.cueCardPool` for the locked
 * module and picks ONE card deterministically by
 * `sharedState.callNumber % pool.length`. Same call sees the same card
 * across re-renders — idempotent for prompt-side reads.
 *
 * Returns `{ kind, topic, bullets, secondaryNote?, directive }` when:
 *   - `HF_FLAG_IELTS_MODULE_SETTINGS=true` (epic #1700 decision 5)
 *   - `sharedState.lockedModule` is set
 *   - A matching `AuthoredModule` in `Playbook.config.modules[]` carries
 *     a non-empty `settings.cueCardPool`
 *   - The picked card has both a `topic` string and a non-empty
 *     `bullets` array
 *
 * Returns `null` otherwise — no cue-card directive renders.
 *
 * Selection policy is deliberately deterministic (callNumber-modulo)
 * rather than random so Preview-lens previews + actual call composition
 * agree byte-for-byte. Theme 3 (`<PinnedCardSlot>`) will cache the
 * pick to `Session.metadata.pinnedCard` so the UI shows the same card
 * the prompt was composed with.
 */
function resolveModuleCueCard(
  config: PlaybookConfig,
  sharedState: AssembledContext["sharedState"],
): {
  kind: "cueCard";
  topic: string;
  bullets: string[];
  secondaryNote?: string;
  directive: string;
} | null {
  if (!isIeltsModuleSettingsEnabled()) return null;
  const lockedModule = sharedState.lockedModule;
  if (!lockedModule) return null;

  const authoredModules: AuthoredModule[] = config.modules ?? [];
  const matched = authoredModules.find(
    (m) => m.id === lockedModule.id || m.id === lockedModule.slug,
  );
  if (!matched) return null;

  const pool = matched.settings?.cueCardPool;
  if (!Array.isArray(pool) || pool.length === 0) return null;

  // Deterministic pick — callNumber starts at 1 for first call.
  const callIndex = Math.max(0, (sharedState.callNumber ?? 1) - 1);
  const picked = pool[callIndex % pool.length];
  if (!picked || typeof picked.topic !== "string" || picked.topic.trim().length === 0) {
    return null;
  }
  const bullets = Array.isArray(picked.bullets)
    ? picked.bullets.filter((b) => typeof b === "string" && b.trim().length > 0)
    : [];
  if (bullets.length === 0) return null;

  const bulletsList = bullets.map((b) => `  - ${b}`).join("\n");
  const directive = `CUE CARD for this module — keep this topic central:\nTopic: ${picked.topic}\nBullets:\n${bulletsList}`;
  return {
    kind: "cueCard",
    topic: picked.topic,
    bullets,
    directive,
  };
}

/**
 * #1735 (epic #1730 G8 consumer D) — first-time-only orientation line.
 *
 * Returns the verbatim string when ALL hold:
 *   - `HF_FLAG_IELTS_MODULE_SETTINGS=true` (epic #1700 decision 5)
 *   - `sharedState.lockedModule` is set
 *   - Matching `AuthoredModule` in `Playbook.config.modules[]` has a
 *     non-empty `settings.firstTimeOrientationLine` string
 *   - The corresponding `CallerModuleProgress.orientationShown` for
 *     `(callerId, moduleId)` is `false` (or row absent — first attempt)
 *
 * Returns `null` otherwise — the orientation line was already shown
 * (gate hit) OR the operator hasn't set one.
 *
 * The "has it been shown" lookup uses `loadedData.callerModuleProgress`
 * (loaded by the modules section).
 *
 * After this line renders for the first time, `endSession`'s
 * `markOrientationShownIfApplicable` writes `orientationShown = true`
 * so the next composition for this caller skips the line.
 *
 * RESTORED 2026-06-17 after PR #1768 silently deleted it.
 */
function resolveModuleOrientationLine(
  config: PlaybookConfig,
  sharedState: AssembledContext["sharedState"],
  loadedData: AssembledContext["loadedData"],
): { line: string; directive: string } | null {
  if (!isIeltsModuleSettingsEnabled()) return null;
  const lockedModule = sharedState.lockedModule;
  if (!lockedModule) return null;

  const authoredModules: AuthoredModule[] = config.modules ?? [];
  const matched = authoredModules.find(
    (m) => m.id === lockedModule.id || m.id === lockedModule.slug,
  );
  if (!matched) return null;

  const line = matched.settings?.firstTimeOrientationLine;
  if (typeof line !== "string" || line.trim().length === 0) return null;

  // Has the learner seen this module's orientation already? The
  // `callerModuleProgress` rows live on `loadedData` when the modules
  // loader has run; treat an absent row as "not yet seen" so the line
  // fires on first attempt.
  const progressRows = (
    loadedData as {
      callerModuleProgress?: Array<{ moduleId: string; orientationShown?: boolean }>;
    }
  ).callerModuleProgress ?? [];
  const progressRow = progressRows.find(
    (r) => r.moduleId === matched.id || r.moduleId === lockedModule.id,
  );
  if (progressRow?.orientationShown === true) return null;

  return {
    line,
    directive: `FIRST-TIME ORIENTATION (one-shot — speak these exact words once before starting the module): "${line}"`,
  };
}

/**
 * #1932 (epic #1931 Template Authority) — module-scoped topic pool consumer.
 *
 * Reads `Playbook.config.modules[].settings.topicPool` for the locked
 * module and picks ONE topic deterministically by
 * `sharedState.callNumber % pool.length`. Same call sees the same topic
 * across re-renders — idempotent for prompt-side reads, byte-identical
 * Preview-lens previews + actual call composition.
 *
 * Parallel to `resolveModuleCueCard` (Part 2 monologue) but emits a
 * "Topic library / Practice questions" directive — the tutor asks the
 * listed questions one at a time, not a cue-card monologue. Used by
 * student-led practice modules (IELTS Part 1, IELTS Part 3, any
 * conversational drill with a pre-authored topic-question library).
 *
 * Returns `{ kind, topic, questions, directive }` when:
 *   - `HF_FLAG_IELTS_MODULE_SETTINGS=true` (epic #1700 decision 5)
 *   - `sharedState.lockedModule` is set
 *   - A matching `AuthoredModule` in `Playbook.config.modules[]` carries
 *     a non-empty `settings.topicPool`
 *   - The picked entry has both a `topic` string and a non-empty
 *     `questions` array
 *
 * Returns `null` otherwise — no topic-pool directive renders.
 *
 * Selection policy: `pool[(callNumber - 1) % pool.length]` — same shape
 * as the cue-card pick so byte-identical Preview and call composition
 * remain a property of the system.
 */
function resolveModuleTopicPool(
  config: PlaybookConfig,
  sharedState: AssembledContext["sharedState"],
): {
  kind: "topicPool";
  topic: string;
  questions: string[];
  directive: string;
} | null {
  if (!isIeltsModuleSettingsEnabled()) return null;
  const lockedModule = sharedState.lockedModule;
  if (!lockedModule) return null;

  const authoredModules: AuthoredModule[] = config.modules ?? [];
  const matched = authoredModules.find(
    (m) => m.id === lockedModule.id || m.id === lockedModule.slug,
  );
  if (!matched) return null;

  const pool = matched.settings?.topicPool;
  if (!Array.isArray(pool) || pool.length === 0) return null;

  // Deterministic pick — callNumber starts at 1 for first call.
  const callIndex = Math.max(0, (sharedState.callNumber ?? 1) - 1);
  const picked = pool[callIndex % pool.length];
  if (
    !picked ||
    typeof picked.topic !== "string" ||
    picked.topic.trim().length === 0
  ) {
    return null;
  }
  const questions = Array.isArray(picked.questions)
    ? picked.questions.filter(
        (q) => typeof q === "string" && q.trim().length > 0,
      )
    : [];
  if (questions.length === 0) return null;

  const questionsList = questions.map((q) => `  - ${q}`).join("\n");
  const directive = `TOPIC LIBRARY for this module — anchor on this topic and ask these questions:\nTopic: ${picked.topic}\nPractice questions:\n${questionsList}`;
  return {
    kind: "topicPool",
    topic: picked.topic,
    questions,
    directive,
  };
}

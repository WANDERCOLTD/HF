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
import { computePersonalityAdaptation, computePersonalityAdaptationDirectives } from "./personality";
import type { AssembledContext, GoalData, SubjectSourcesData } from "../types";
import type { AuthoredModule, PlaybookConfig, SpecConfig } from "@/lib/types/json-fields";
import { resolveTeachingProfile } from "@/lib/content-trust/teaching-profiles";
import { isIeltsModuleSettingsEnabled } from "@/lib/journey/module-settings-flag";
import {
  resolveScoringConfig,
  buildAssessmentReadinessDirective,
  buildProgressSignalDirective,
} from "@/lib/prompt/composition/scoring-config";
import { buildLoMasteryMap } from "@/lib/prompt/composition/lo-mastery-map";

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

// #1951 (epic #1946 S4) — Budget cap for the new `behavior_targets_semantics`
// directive (full per-parameter interpretation list). Above this serialised
// size we drop back to the legacy `behavior_targets_summary` top-5 shape and
// log a console.warn so operators see the fallback fire. Same convention as
// `PROMPT_MODULE_BUNDLE_BUDGET_CHARS` in transforms/modules.ts.
const PROMPT_SEMANTICS_BUDGET_CHARS = 30_000;

/**
 * #1951 — Derive the human-readable meaning of a tuned behaviour target. The
 * derivation prefers the parameter's HF-canonical `interpretationHigh` /
 * `interpretationLow` text, falling back to the section-level `when_high` /
 * `when_low` strings (legacy data path) and finally a "balanced approach"
 * placeholder for params whose interpretations are not yet backfilled. The
 * placeholder will disappear when the S4 pedagogy fill lands.
 */
function deriveBehaviorTargetMeaning(
  t: {
    targetValue: number;
    parameter?: { interpretationHigh?: string | null; interpretationLow?: string | null };
    when_high?: string;
    when_low?: string;
  },
  thresholds: { high: number; low: number },
): string {
  const high = t.parameter?.interpretationHigh || t.when_high;
  const low = t.parameter?.interpretationLow || t.when_low;
  if (t.targetValue >= thresholds.high) return high || "balanced approach";
  if (t.targetValue <= thresholds.low) return low || "balanced approach";
  if (high && low) {
    const h = String(high).split(",")[0].trim();
    const l = String(low).split(",")[0].toLowerCase().trim();
    return `Balance: ${h} while also ${l}`;
  }
  return high || low || "balanced approach";
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

    // Personality adaptation (route.ts lines 2017-2075).
    //
    // #2083 (epic #2078 S1) — appended block: the 5 ADAPTATION-target
    // parameters (BEH-OPENNESS-ADAPTATION, BEH-CONSCIENTIOUSNESS-ADAPTATION,
    // BEH-EXTRAVERSION-ADAPTATION, BEH-AGREEABLENESS-ADAPTATION,
    // BEH-NEUROTICISM-ADAPTATION) read the caller's matching B5-* score from
    // `CallerPersonalityProfile.parameterValues` and emit a directive citing
    // the parameter's `interpretationHigh` / `interpretationLow`. Closes the
    // producer-only gap pinned by `parameter-coverage.test.ts`.
    personality_adaptation: [
      ...computePersonalityAdaptation(personality, thresholds),
      ...computePersonalityAdaptationDirectives(personality, mergedTargets, thresholds),
    ],

    // Behavior targets summary (route.ts lines 2076-2087)
    // #1951 — kept at top-5 as the safety-fallback path for when the new
    // `behavior_targets_semantics` block (below) blows the budget and is
    // dropped. Under normal conditions the LLM reads semantics, not summary.
    behavior_targets_summary: mergedTargets.slice(0, 5).map((t: any) => ({
      what: t.parameter?.name || t.name || t.parameterId,
      target: classifyValue(t.targetValue, thresholds),
      meaning: deriveBehaviorTargetMeaning(t, thresholds),
    })),

    // #1951 (epic #1946 S4) — Behavior targets SEMANTICS: the full list of
    // active behaviour parameters with their resolved targets +
    // `interpretationHigh`/`interpretationLow` rationale. Replaces the
    // pre-#1951 top-5 cap as the LLM's primary signal for HOW to behave;
    // the renderer drops back to `behavior_targets_summary` (the top-5
    // shape above) when this field is null.
    //
    // Budget guard: `PROMPT_SEMANTICS_BUDGET_CHARS` is the maximum
    // serialised size of the array. Beyond it we set the field to null and
    // log `[transforms/instructions] semantics budget exceeded`. Default
    // 30K covers ~150 params at ~200 chars each — comfortably above the
    // current 139-param registry. Operator can see the fallback fire in
    // dev-server stderr.
    //
    // Producer↔consumer pairing per `.claude/rules/lattice-survey.md`
    // §"deeper layer". The renderer push lives at
    // `renderPromptSummary.ts` under "## Behavior Targets Semantics" and
    // is pinned by `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`.
    behavior_targets_semantics: (() => {
      const fullSemantics = mergedTargets.map((t: any) => ({
        parameterId: t.parameterId ?? t.parameter?.parameterId ?? "",
        what: t.parameter?.name || t.name || t.parameterId,
        targetLevel: classifyValue(t.targetValue, thresholds),
        targetValue: t.targetValue,
        meaning: deriveBehaviorTargetMeaning(t, thresholds),
      }));
      const serialised = JSON.stringify(fullSemantics);
      if (serialised.length > PROMPT_SEMANTICS_BUDGET_CHARS) {
        console.warn(
          `[transforms/instructions] semantics budget exceeded: ${serialised.length} chars across ${fullSemantics.length} targets (budget ${PROMPT_SEMANTICS_BUDGET_CHARS}); falling back to behavior_targets_summary (top-5)`,
        );
        return null;
      }
      return fullSemantics;
    })(),

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

    // #2052 sub-epic C — assessment_readiness_directive.
    //
    // Reads `Playbook.config.assessmentReadinessThreshold`. When set,
    // gates pre/mid/post-test stop firing on the learner's aggregated
    // `behavior_profile:learning:*` rollup (produced by BEH-AGG-001 —
    // see `lib/measurement/...` AGGREGATE spec). Falls back to
    // averaged per-LO mastery when the rollup is absent. Returns null
    // when the operator hasn't set the threshold (byte-identical
    // previous behaviour).
    //
    // @see lib/prompt/composition/scoring-config.ts
    assessment_readiness_directive: buildAssessmentReadinessDirective(
      resolveScoringConfig(
        (loadedData.playbooks?.[0]?.config ?? null) as PlaybookConfig | null,
      ),
      loadedData.callerAttributes,
      buildLoMasteryMap(
        loadedData.callerAttributes,
        sharedState.curriculumSpecSlug,
      ),
    ),

    // #2052 sub-epic C — progress_signal_directive.
    //
    // Reads `Playbook.config.progressSignals.lowWater` / `.highWater`.
    // When set, compares the learner's aggregated
    // `behavior_profile:engagement:*` rollup against the band:
    //   - below lowWater  → "encouragement"
    //   - above highWater → "stretch"
    //   - in between      → "in_band"
    // Returns null when neither water mark is set (byte-identical
    // previous behaviour).
    //
    // @see lib/prompt/composition/scoring-config.ts
    progress_signal_directive: buildProgressSignalDirective(
      resolveScoringConfig(
        (loadedData.playbooks?.[0]?.config ?? null) as PlaybookConfig | null,
      ),
      loadedData.callerAttributes,
      buildLoMasteryMap(
        loadedData.callerAttributes,
        sharedState.curriculumSpecSlug,
      ),
    ),

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

    // #2011 (epic #2009 S2) — quiz-mode directive.
    //
    // Fires when the learner's locked module has `mode === "quiz"` in
    // `Playbook.config.modules[].mode`. Reframes the session as a timed
    // MCQ drill drawn from the per-Unit ContentQuestion bank rather than
    // a teaching conversation. The MCQ infrastructure already exists
    // (`lib/assessment/generate-mcqs.ts` + `app/api/vapi/tools/route.ts`
    // serves ContentQuestion at runtime); this directive tells the LLM
    // to use it that way.
    //
    // Returns null on any non-quiz mode — existing behaviour byte-
    // identical for tutor / mixed / examiner / mock-exam modules.
    //
    // Producer↔consumer pairing per `.claude/rules/lattice-survey.md`
    // §"deeper layer". The renderer push lives at
    // `renderPromptSummary.ts` under "[QUIZ MODE]".
    module_quiz_directive: resolveModuleQuizDirective(
      (loadedData.playbooks?.[0]?.config ?? {}) as PlaybookConfig,
      sharedState,
    ),

    // #2013 (epic #2009 S4) — mock-exam mode directive.
    //
    // Fires when the learner's locked module has `mode === "mock-exam"`.
    // Reframes the session as a board-chair scenario exam (4–6 probes
    // anchored in the Unit's case study, no MCQs, no teaching mid-
    // session, per-LO per-dimension close). When the playbook also
    // sets `useFreshMastery: true` (the Exam Assessment isolation
    // contract — `lib/curriculum/readiness-rollups.ts:25`), the
    // directive appends a "prior mastery doesn't count" note so the
    // AI scores fresh from THIS session alone.
    //
    // Returns null on any non-mock-exam mode — existing behaviour
    // byte-identical for tutor / mixed / examiner / quiz modules.
    //
    // Lattice survey confirmed `build-per-segment-measure-prompt.ts`
    // is IELTS-pipeline-gated (not a generic compose path), so the
    // board-chair branch does NOT need to abstract that file.
    //
    // Producer↔consumer pairing per `.claude/rules/lattice-survey.md`
    // §"deeper layer". The renderer push lives at
    // `renderPromptSummary.ts` under "[EXAM ASSESSMENT MODE]".
    module_mock_exam_directive: resolveModuleMockExamDirective(
      (loadedData.playbooks?.[0]?.config ?? {}) as PlaybookConfig,
      sharedState,
    ),

    // #2051 (epic #2049 sub-epic B) — baseline-assessment depth directive.
    // Emits a per-depth `{ depth, directive }` ONLY when the playbook's
    // `firstCallMode === "baseline_assessment"` AND the session is the
    // learner's first call (`isFirstCall || isFirstCallInDomain`). When
    // the depth field is ABSENT but baseline mode is on, the resolver
    // defaults to `"standard"` — preserves byte-identical output for
    // existing baseline playbooks that pre-date the field.
    //
    // The directive lands AFTER the existing `BASELINE_ASSESSMENT_RULE`
    // critical rule emitted by `transforms/preamble.ts` — it does NOT
    // replace or merge into that rule. The renderer (renderPromptSummary)
    // appends `directive` as a fresh paragraph so the LLM sees both:
    // the universal baseline contract + the depth-specific calibration.
    //
    // Producer↔consumer pairing per `.claude/rules/lattice-survey.md`
    // §"deeper layer". The renderer push lives at
    // `renderPromptSummary.ts` under "[BASELINE DEPTH]".
    baseline_assessment_depth: resolveBaselineAssessmentDepth(
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
 * #2051 (epic #2049 sub-epic B / Contract 1) — baseline-assessment depth.
 *
 * Returns a `{ depth, directive }` object ONLY when ALL hold:
 *   - `Playbook.config.firstCallMode === "baseline_assessment"`
 *   - `sharedState.isFirstCall || sharedState.isFirstCallInDomain` (the
 *     learner's first session in this course)
 *
 * Depth defaults to `"standard"` when the playbook is in baseline mode but
 * `Playbook.config.baselineAssessmentDepth` is undefined — preserves the
 * existing 5-question implicit shape for playbooks that pre-date the
 * field. An explicit `"light"` / `"standard"` / `"deep"` is honoured.
 *
 * Returns `null` when:
 *   - Playbook is not in baseline mode (any other firstCallMode), OR
 *   - The call is not the first call (Call 2+), OR
 *   - The depth value is unrecognised (defensive — type guard catches
 *     stale JSON from manual DB edits).
 *
 * The directive is APPENDED after the existing `BASELINE_ASSESSMENT_RULE`
 * critical rule (emitted by `transforms/preamble.ts`) — it does NOT replace
 * or merge into that rule. The renderer pushes both into the prompt body.
 *
 * The depth-specific directives are kept inline here (not in
 * `defaults/critical-rules.ts`) because they are the per-depth calibration
 * shape — adding light/standard/deep variants in the defaults file would
 * either over-specify the canonical rule (forcing every consumer to handle
 * the depth shape) or drift to a sibling file. Inline keeps the surface
 * minimal until a future story moves depth-variant rules to spec config.
 *
 * @see docs/groomed/2051-call1-shape-consumers.md §Contract 1
 */
type BaselineDepth = "light" | "standard" | "deep";
const BASELINE_DEPTH_DIRECTIVES: Record<BaselineDepth, string> = {
  light:
    "Assessment depth: LIGHT. Ask up to 3 diagnostic questions only — one per learning objective starting from the first objective in the sequence. Do not exceed 3 questions total. Manage time so the session closes within 3 minutes of the assessment opening.",
  standard:
    "Assessment depth: STANDARD. Ask up to 5 diagnostic questions — one per learning objective working through the sequence. Do not exceed 5 questions total. Target 5 minutes for the assessment.",
  deep:
    "Assessment depth: DEEP. Ask up to 8 diagnostic questions — work through all learning objectives in sequence, then select the 2 LOs where the learner showed the least confidence and ask one follow-up probe each. Target 8 minutes. Do not correct or teach during the follow-ups — they are additional diagnostic evidence.",
};

function isBaselineDepth(value: unknown): value is BaselineDepth {
  return value === "light" || value === "standard" || value === "deep";
}

function resolveBaselineAssessmentDepth(
  config: PlaybookConfig,
  sharedState: AssembledContext["sharedState"],
): { depth: BaselineDepth; directive: string } | null {
  // Gate 1 — baseline mode only.
  if (config.firstCallMode !== "baseline_assessment") return null;
  // Gate 2 — first call only. Use the union of both first-call signals so
  // domain-switch re-onboarding also fires the baseline calibration on the
  // first call within the new domain (same shape as `pedagogy.ts`).
  const isFirstCallAny =
    sharedState.isFirstCall || sharedState.isFirstCallInDomain === true;
  if (!isFirstCallAny) return null;

  // Defensive: an unknown stored value falls through to null rather than
  // crashing the composer. The depth-variant directive simply isn't emitted
  // — the existing BASELINE_ASSESSMENT_RULE still fires.
  const raw = config.baselineAssessmentDepth;
  const depth: BaselineDepth = raw === undefined
    ? "standard" // default when baseline-mode is on but the field is absent
    : isBaselineDepth(raw)
      ? raw
      : "standard"; // unknown stored value → silent fall-through to standard

  return {
    depth,
    directive: BASELINE_DEPTH_DIRECTIVES[depth],
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

/**
 * #2011 (epic #2009 S2) — quiz-mode directive.
 *
 * Returns a directive when the locked module's `mode === "quiz"`.
 * Otherwise returns null. The directive reframes the session as a
 * timed MCQ drill — the LLM still uses the same VAPI ContentQuestion
 * search tool at runtime; the prompt tells it WHEN to use MCQs as
 * the conversation shape rather than as in-line retrieval prompts.
 *
 * No feature flag — the gate is the mode literal itself. Out of
 * scope: per-module `questionTarget` count override (today the
 * directive carries the canonical 8–12 range; a future story can
 * wire `Playbook.config.modules[].settings.questionTarget` if the
 * trio variants need per-Unit budgets).
 */
function resolveModuleQuizDirective(
  config: PlaybookConfig,
  sharedState: AssembledContext["sharedState"],
): { directive: string } | null {
  const lockedModule = sharedState.lockedModule;
  if (!lockedModule) return null;

  const authoredModules: AuthoredModule[] = config.modules ?? [];
  const matched = authoredModules.find(
    (m) => m.id === lockedModule.id || m.id === lockedModule.slug,
  );
  if (!matched) return null;
  if (matched.mode !== "quiz") return null;

  const directive = [
    "QUIZ MODE — this session is a timed MCQ drill, not a teaching conversation.",
    "- Deliver 8–12 questions drawn from the ContentQuestion bank for this Unit.",
    "- Present each question with 4 options in randomised order (conversational tone, NOT \"A: / B: / C: / D:\").",
    "- Give exactly TWO sentences of feedback per question: (1) correct/incorrect; (2) the underlying principle.",
    "- NO follow-up questions, NO extended teaching. Move on immediately after feedback.",
    "- After all questions: state the score, name the weakest LO, offer forward-pointer to Revision Aid.",
    "- Time budget: ~30–60 seconds per question; total 10 minutes.",
  ].join("\n");

  return { directive };
}

/**
 * #2013 (epic #2009 S4) — mock-exam mode directive.
 *
 * Returns a directive when the locked module's `mode === "mock-exam"`.
 * Otherwise returns null. The directive reframes the session as a
 * board-chair scenario exam: 4–6 probes anchored in the Unit's case
 * study, no MCQs, no teaching mid-session, per-LO per-dimension
 * close. Stays in board-chair frame throughout.
 *
 * When `config.useFreshMastery === true` (the Exam Assessment
 * isolation contract — see `lib/curriculum/readiness-rollups.ts:25`),
 * appends a "prior mastery doesn't count" note so the AI scores
 * fresh from THIS session alone. The actual data isolation (writing
 * to `Call.scratchMastery` rather than long-term `lo_mastery:*`) is
 * already enforced at `lib/curriculum/track-progress.ts` and
 * `lib/curriculum/scratch-mastery.ts`; this note tells the AI to
 * align its narration with the data behaviour.
 *
 * No feature flag — the gate is the mode literal itself. Out of
 * scope: per-LO per-dimension SCORING RUBRIC infra (Story E,
 * deferred). This directive only frames the conversation; the
 * scoring side stays on existing CallScore/CallerAttribute paths.
 */
function resolveModuleMockExamDirective(
  config: PlaybookConfig,
  sharedState: AssembledContext["sharedState"],
): { directive: string } | null {
  const lockedModule = sharedState.lockedModule;
  if (!lockedModule) return null;

  const authoredModules: AuthoredModule[] = config.modules ?? [];
  const matched = authoredModules.find(
    (m) => m.id === lockedModule.id || m.id === lockedModule.slug,
  );
  if (!matched) return null;
  if (matched.mode !== "mock-exam") return null;

  const lines = [
    "EXAM ASSESSMENT MODE — board-chair framing. You are NOT the senior mentor today.",
    "You are the Chair of the learner's board.",
    "- Open: introduce yourself as the Chair. Frame the session as a mock Exam Assessment. Tell the learner each prompt should show judgement, not just knowledge.",
    "- Run 4–6 scenario probes anchored in the Unit's case study with a NEW twist per probe.",
    "- Push back on weak answers: name where the answer fell short and ask the learner to lift it.",
    "- Per-dimension scoring: internal only during the session. Surface at close.",
    "- Close: per-LO per-dimension breakdown (Foundation / Developing / Practitioner / Distinction), two Revision Aid pointers.",
    "- NO MCQs in this mode. NO teaching mid-session (max 30-second framework reminders only).",
    "- Stay in board-chair frame throughout. Break frame only at the close.",
    "- Time: 40 minutes. 4–6 probes. One Unit per session.",
  ];
  // `useFreshMastery` lives on PlaybookConfig as an untyped extension
  // field (see `lib/curriculum/playbook-mastery-config.ts:59` for the
  // canonical read pattern). Mirror that here.
  const useFreshMastery =
    config && "useFreshMastery" in config
      ? (config as { useFreshMastery?: unknown }).useFreshMastery === true
      : false;
  if (useFreshMastery) {
    lines.push(
      "- Prior mastery DOES NOT carry in. Score this Unit fresh from THIS session's evidence alone. Do not surface prior LO scores in feedback.",
    );
  }
  const directive = lines.join("\n");

  return { directive };
}

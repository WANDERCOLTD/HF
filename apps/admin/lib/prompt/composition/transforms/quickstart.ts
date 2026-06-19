/**
 * Quick Start Transform
 * Extracted from route.ts lines 1477-1573
 *
 * Builds the _quickStart section — instant context for voice AI.
 * References sharedState for modules, and sections for targets/goals.
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue, getAttributeValue } from "../types";
import type { SpecConfig, PlaybookConfig } from "@/lib/types/json-fields";
import type { AssembledContext, CallerAttributeData } from "../types";
import { PARAMS } from "@/lib/registry";
import { NEUTRAL_PARAMETER_TARGET } from "@/lib/measurement/neutral-target";
import { getAudienceOption } from "./audience";
import { SURVEY_SCOPES, PRE_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import { config } from "@/lib/config";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import {
  classifyFirstPhaseIntent,
  hasReturningUserPhrasing,
  renderFirstCallOpening,
  rewriteReturningUserPhrasing,
} from "@/lib/prompt/composition/defaults/first-call-openings";
import { substituteGreetingTokens } from "@/lib/prompt/composition/defaults/substitute-greeting-tokens";
import {
  shouldSuppressModuleNames,
  SUPPRESSED_THIS_SESSION_COPY,
} from "./module-visibility-gate";

/** Keys whose presence (scope PRE) signals the learner already submitted onboarding data */
const PRE_LOADED_KEYS: readonly string[] = [
  PRE_SURVEY_KEYS.GOAL_TEXT,
  PRE_SURVEY_KEYS.SUBMITTED_AT,
];

/**
 * #1967 M2 — turn a stored CallerAttribute dimension key into a human-
 * readable label. Handles both snake_case (`depth_engagement`) and
 * camelCase (`depthEngagement`) since runtime aggregate-runner.ts:495
 * camelCases the `targetProfileKey` from the spec.
 *
 * Examples:
 *   "depth_engagement"      → "Depth engagement"
 *   "depthEngagement"        → "Depth engagement"
 *   "energy_level"           → "Energy level"
 *   "b5_average_strength"    → "B5 average strength"
 */
export function humanizeDimension(key: string): string {
  // camelCase → snake_case
  const snake = key.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
  // snake → "Foo bar"
  const words = snake.split("_").filter((w) => w.length > 0);
  if (words.length === 0) return key;
  return words
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export type PersonalisationMode = "PRE_LOADED" | "COLD_START" | "OPT_OUT";

/**
 * Welcome-flow toggles read from `playbook.config.welcome.*.enabled`.
 * Each flag mirrors a phase the educator can switch off in the Course Design tab:
 * - `askGoals`     ← `welcome.goals.enabled`         (learning goals)
 * - `askAboutYou`  ← `welcome.aboutYou.enabled`      (motivation / confidence)
 * - `askKnowledge` ← `welcome.knowledgeCheck.enabled` (prior knowledge probe)
 *
 * `welcome.aiIntroCall.enabled` is a separate concern (intro call) and is NOT included.
 */
export interface WelcomeToggles {
  askGoals: boolean;
  askAboutYou: boolean;
  askKnowledge: boolean;
}

const DEFAULT_TOGGLES: WelcomeToggles = {
  askGoals: true,
  askAboutYou: true,
  askKnowledge: true,
};

/**
 * Determine whether the caller already has pre-survey data.
 * PRE_LOADED → name/goals known, skip discovery questions.
 * COLD_START → no prior data, use discovery phase (per-toggle guidance refines what to ask).
 * OPT_OUT    → educator turned off ALL three welcome phases AND no answers exist; skip discovery entirely.
 *
 * Pre-loaded answers always win — if they exist (e.g. a learner submitted before the
 * educator disabled the welcome phases) we still personalise from them.
 *
 * Partial opt-outs return COLD_START — the per-phase guidance in `discovery_guidance`
 * tells the AI which specific questions to skip.
 */
export function detectPersonalisationMode(
  callerAttributes: CallerAttributeData[],
  toggles: WelcomeToggles = DEFAULT_TOGGLES,
): PersonalisationMode {
  const hasPreData = callerAttributes.some(
    (a) =>
      a.scope === SURVEY_SCOPES.PRE &&
      PRE_LOADED_KEYS.includes(a.key),
  );
  const hasPersonality = callerAttributes.some(
    (a) => a.scope === SURVEY_SCOPES.PERSONALITY,
  );
  if (hasPreData || hasPersonality) return "PRE_LOADED";
  const allOff = !toggles.askGoals && !toggles.askAboutYou && !toggles.askKnowledge;
  if (allOff) return "OPT_OUT";
  return "COLD_START";
}

registerTransform("computeQuickStart", (
  _rawData: any,
  context: AssembledContext,
) => {
  const { sharedState, loadedData, resolvedSpecs, sections } = context;
  const { modules, isFirstCall, completedModules, moduleToReview, nextModule, thresholds, callNumber, schedulerDecision, schedulerPolicy, moduleAttemptCounts, lockedModule } = sharedState;
  const caller = loadedData.caller;
  const learnerGoals = loadedData.goals;
  const identitySpec = resolvedSpecs.identitySpec;
  const callerDomain = caller?.domain;

  // Use merged targets from the behavior_targets section (already computed)
  const mergedTargets = sections.behaviorTargets?._merged || sections.behaviorTargets?.all || [];

  // Get role statement
  const getRoleStatement = (): string => {
    // Renamed from `config` to avoid shadowing the imported config (TDZ rule).
    const specConfig = identitySpec?.config as SpecConfig;
    if (!specConfig) return "A helpful voice assistant";
    if (specConfig.tutor_role?.roleStatement) return specConfig.tutor_role.roleStatement;
    if (specConfig.roleStatement) return specConfig.roleStatement;
    return identitySpec?.description || "A helpful voice assistant";
  };

  // Get deduplicated memories from the memories section
  const deduplicated = sections.memories?._deduplicated || sections.memories?.all || [];

  // Subject/course context for greeting and session orientation
  const playbook = loadedData.playbooks?.[0];
  const pbConfig = (playbook?.config || {}) as PlaybookConfig;
  const subjectDiscipline = pbConfig.subjectDiscipline;
  const courseContext = pbConfig.courseContext;
  // subjectDiscipline is the single source of truth for AI-facing subject identity.
  // Do NOT fall back to subject.name — it may be a course-slug, not a discipline.
  const subjectRef = subjectDiscipline || null;
  const audienceId = pbConfig.audience;
  const constraints = pbConfig.constraints;
  // #598 Slice 1 — call-1 may override duration via firstCall.durationMinsOverride.
  // Calls 2+ unaffected.
  const firstCallDurationOverride =
    isFirstCall && typeof pbConfig.firstCall?.durationMinsOverride === "number"
      ? pbConfig.firstCall.durationMinsOverride
      : null;
  const durationMins = firstCallDurationOverride ?? pbConfig.durationMins;
  const courseLearningOutcomes = pbConfig.courseLearningOutcomes;
  const emphasis = pbConfig.emphasis;
  const assessments = pbConfig.assessments;

  return {
    you_are: (() => {
      let role = getRoleStatement();
      const discipline = pbConfig.subjectDiscipline || subjectRef;
      if (role === "A helpful voice assistant" || role.toLowerCase().includes("generic")) {
        // Fully replace generic roles with subject-specific identity
        role = `A ${discipline || callerDomain?.name || ""} tutor and voice assistant`.replace(/\s+/g, " ").trim();
      } else if (discipline && !role.toLowerCase().includes(discipline.toLowerCase())) {
        // Inject subject discipline into existing role (e.g. "a friendly tutor" → "a friendly English Language tutor")
        // Insert before "tutor" if present, otherwise prepend as context
        const tutorMatch = role.match(/\b(tutor|instructor|teacher|mentor|coach)\b/i);
        if (tutorMatch) {
          role = role.replace(tutorMatch[0], `${discipline} ${tutorMatch[0]}`);
        } else {
          role = `${role} — specialising in ${discipline}`;
        }
      }
      // Append audience context (e.g. "for secondary school students (age 11-16)")
      if (audienceId && audienceId !== "mixed") {
        const audienceOpt = getAudienceOption(audienceId);
        if (audienceOpt?.youAreFragment) {
          role = `${role} for ${audienceOpt.youAreFragment}`;
        }
      }
      if (role.length <= 200) return role;
      const truncated = role.substring(0, 200);
      const lastPeriod = truncated.lastIndexOf(".");
      const lastQuestion = truncated.lastIndexOf("?");
      const lastExclaim = truncated.lastIndexOf("!");
      const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclaim);
      if (lastSentenceEnd > 100) return role.substring(0, lastSentenceEnd + 1);
      const lastSpace = truncated.lastIndexOf(" ");
      return lastSpace > 100 ? role.substring(0, lastSpace) + "..." : truncated + "...";
    })(),

    course_context: courseContext || null,

    session_pacing: durationMins ? `${durationMins} min per session` : null,

    scheduler_preset: schedulerPolicy?.name || null,

    channel_note: sharedState.channel === 'text'
      ? "This is a TEXT chat — the learner types, not speaks. Typing is much slower than talking. Cover less material per session, keep messages concise, and don't rush through phases. A 20-min voice session is roughly equivalent to 5-7 min of text chat in content coverage."
      : null,

    learning_guidance: (() => {
      // Surface aggregated learning competency from CallerAttributes (set by COMP/DISC/COACH/BEH-AGG specs)
      const aggComp = config.specs.aggComprehension;
      const aggDisc = config.specs.aggDiscussion;
      const aggCoach = config.specs.aggCoaching;
      const aggBeh = config.specs.aggBehavior;
      const learningAttrs = loadedData.callerAttributes.filter(
        (a: CallerAttributeData) => a.scope === aggComp || a.scope === aggDisc || a.scope === aggCoach,
      );
      // #1967 M2 — BEH-AGG-001 outputs read by scope, not by per-key
      // hardcoding. Generic so future AGG specs that follow the same
      // single-spec-multi-section pattern surface here automatically.
      const behaviorAttrs = loadedData.callerAttributes.filter(
        (a: CallerAttributeData) => a.scope === aggBeh && (a.confidence ?? 0) >= 0.6,
      );
      if (learningAttrs.length === 0 && behaviorAttrs.length === 0) return null;

      const get = (key: string): string | null => {
        const attr = learningAttrs.find((a: CallerAttributeData) => a.key === key);
        return attr?.stringValue ?? null;
      };

      const level = get("competency_level");
      const parts: string[] = [];

      if (level) parts.push(`Overall competency: ${level}`);

      // Comprehension-specific (PIRLS/KS2-aligned)
      const retrieval = get("retrieval_skill");
      const inference = get("inference_skill");
      const vocabulary = get("vocabulary_in_context");
      const language = get("language_appreciation");
      const evaluation = get("evaluation_skill");
      const recall = get("recall_accuracy");
      if (retrieval) parts.push(`Retrieval: ${retrieval}`);
      if (inference) parts.push(`Inference: ${inference}`);
      if (vocabulary) parts.push(`Vocabulary: ${vocabulary}`);
      if (language) parts.push(`Language appreciation: ${language}`);
      if (evaluation) parts.push(`Evaluation: ${evaluation}`);
      if (recall) parts.push(`Recall: ${recall}`);

      // Discussion-specific
      const perspective = get("perspective_diversity");
      const argument = get("argument_quality");
      const shift = get("position_shift");
      const reflection = get("reflection_quality");
      if (perspective) parts.push(`Perspective diversity: ${perspective}`);
      if (argument) parts.push(`Argument quality: ${argument}`);
      if (shift) parts.push(`Position shift: ${shift}`);
      if (reflection) parts.push(`Reflection: ${reflection}`);

      // Coaching-specific
      const clarity = get("goal_clarity");
      const action = get("action_commitment");
      const awareness = get("self_awareness");
      const followup = get("follow_through");
      if (clarity) parts.push(`Goal clarity: ${clarity}`);
      if (action) parts.push(`Action commitment: ${action}`);
      if (awareness) parts.push(`Self-awareness: ${awareness}`);
      if (followup) parts.push(`Follow-through: ${followup}`);

      // #1967 M2 — BEH-AGG-001 behavior_profile signals. Emitted by
      // scope filter so it's blind to runtime snake/camel key casing
      // (aggregate-runner.ts:495 toCamelCase converts spec snake_case
      // to runtime camelCase — we just read whatever's there).
      if (behaviorAttrs.length > 0) {
        // Group by namespace prefix (everything before the last segment)
        const byNamespace = new Map<string, Array<{ key: string; value: string; conf: number }>>();
        for (const a of behaviorAttrs) {
          const parts2 = a.key.split(":");
          const namespace = parts2.length > 1 ? parts2.slice(0, -1).join(":") : "(root)";
          const dimension = parts2.length > 1 ? parts2[parts2.length - 1] : a.key;
          if (!byNamespace.has(namespace)) byNamespace.set(namespace, []);
          byNamespace.get(namespace)!.push({
            key: dimension,
            value: String(a.stringValue ?? a.numberValue ?? ""),
            conf: a.confidence ?? 0,
          });
        }
        for (const [namespace, rows] of byNamespace) {
          // behavior_profile:companion → "Companion profile signals"
          const friendly = namespace
            .replace(/^behavior[_]?[Pp]rofile:?/, "")
            .replace(/[_:]/g, " ")
            .trim();
          const label = friendly.length > 0
            ? `${friendly[0].toUpperCase()}${friendly.slice(1)} profile signals`
            : "Profile signals";
          const lines = rows
            .sort((a, b) => a.key.localeCompare(b.key))
            .map(r => `  - ${humanizeDimension(r.key)}: ${r.value}`);
          parts.push(`${label}:\n${lines.join("\n")}`);
        }
      }

      return parts.length > 0 ? parts.join("\n") : null;
    })(),

    learning_checkpoints: (() => {
      const cpAttrs = loadedData.callerAttributes.filter(
        (a: CallerAttributeData) => a.scope === "CHECKPOINT",
      );
      if (cpAttrs.length === 0) return null;
      return cpAttrs
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(a => `${a.key}: ${a.stringValue}${a.numberValue != null ? ` (${(a.numberValue * 100).toFixed(0)}%)` : ""}`)
        .join(", ");
    })(),

    lesson_model: null, // removed — scheduler preset replaces pedagogical model

    course_goals: courseLearningOutcomes?.length
      ? courseLearningOutcomes.join("; ")
      : null,

    teaching_emphasis: emphasis && emphasis !== "balanced"
      ? emphasis === "breadth"
        ? "Breadth-first: cover more topics at a lighter level rather than going deep on fewer"
        : "Depth-first: go deep on fewer topics rather than covering many superficially"
      : null,

    assessment_style: assessments
      ? assessments === "formal"
        ? "Use structured assessment: quiz questions, scored exercises, and explicit progress checks"
        : assessments === "none"
          ? "No formal assessment: keep it conversational, gauge understanding through discussion"
          : "Light assessment: occasional check-in questions and gentle comprehension checks"
      : null,

    // #1008 (I-C2) — Call-counter coherence. Pre-fix used `loadedData.callCount || 1`,
    // which (a) read the count of ENDED prior calls (so the prompt-used-in-call-N
    // labelled itself "(call #N-1)" — Maya's #1006 had "(call #2)" inside her call 3),
    // and (b) used `|| 1` so callCount=0 collapsed into "(call #1)" indistinguishable
    // from a genuine first call. `sharedState.callNumber` is the canonical value
    // (= data.callCount + 1) and is used everywhere else in the prompt — this line
    // now matches, eliminating the same-prompt drift between this_caller and the
    // offboarding_guidance "This is call N" string.
    this_caller: `${caller?.name ?? caller?.id ?? "anonymous"} (call #${callNumber ?? 1})`,

    cohort_context: (() => {
      // Prefer multi-cohort memberships, fall back to legacy single cohort
      const memberships = caller?.cohortMemberships;
      if (memberships && memberships.length > 0) {
        return memberships.map(m => {
          let ctx = m.cohortGroup.name;
          if (m.cohortGroup.owner?.name) ctx += ` (teacher: ${m.cohortGroup.owner.name})`;
          return ctx;
        }).join("; ");
      }
      if (caller?.cohortGroup) {
        return `Part of ${caller.cohortGroup.name}` +
          (caller.cohortGroup.owner?.name ? ` (teacher: ${caller.cohortGroup.owner.name})` : "");
      }
      return null;
    })(),

    learner_survey: (() => {
      const surveyAttrs = loadedData.callerAttributes.filter(
        (a: CallerAttributeData) => a.scope === SURVEY_SCOPES.PRE,
      );

      const getFromScope = (scope: string, key: string): string | null => {
        const attr = loadedData.callerAttributes.find(
          (a: CallerAttributeData) => a.scope === scope && a.key === key,
        );
        if (!attr) return null;
        const val = getAttributeValue(attr);
        return val != null ? String(val) : null;
      };

      const get = (key: string): string | null => {
        const attr = surveyAttrs.find((a: CallerAttributeData) => a.key === key);
        if (!attr) return null;
        const val = getAttributeValue(attr);
        return val != null ? String(val) : null;
      };

      const goal = get(PRE_SURVEY_KEYS.GOAL_TEXT);
      const priorKnowledge = get(PRE_SURVEY_KEYS.PRIOR_KNOWLEDGE);
      const concern = get(PRE_SURVEY_KEYS.CONCERN_TEXT);
      const confidence = get(PRE_SURVEY_KEYS.CONFIDENCE);
      const motivation = get(PRE_SURVEY_KEYS.MOTIVATION);

      // Pre-test baseline score (0-1 scale)
      const preTestScore = getFromScope(SURVEY_SCOPES.PRE_TEST, "score");

      const parts: string[] = [];
      if (goal) parts.push(`Goal: "${goal}"`);
      if (priorKnowledge) parts.push(`Prior knowledge: ${priorKnowledge}`);
      if (confidence) parts.push(`Self-rated confidence: ${confidence}/5`);
      if (preTestScore) {
        const pct = Math.round(parseFloat(preTestScore) * 100);
        parts.push(`Baseline knowledge test: ${pct}%${pct >= 80 ? " (strong — can skip basics)" : pct <= 30 ? " (low — needs foundational support)" : ""}`);
      }
      if (concern) parts.push(`Concern: "${concern}"`);
      if (motivation) parts.push(`Motivation: "${motivation}"`);

      return parts.length > 0 ? parts.join("\n") : null;
    })(),

    this_session: (() => {
      // #274 Slice B: when the learner picked a specific module via the
      // Module Picker, the session is locked to that module — overrides
      // scheduler/review derivation so this_session reflects the choice.
      if (lockedModule) {
        return `Locked focus — ${lockedModule.name}${lockedModule.description ? ` (${lockedModule.description})` : ""}`;
      }
      // #1405 — module-visibility gate. When the educator chose to hide
      // module names on call 1, suppress the "introduce <module name>"
      // framing in favour of a subject-level placeholder. TEACHING
      // CONTENT still loads — this only touches the orientation copy.
      // Note: this branch only runs when lockedModule is null (the
      // locked-focus return above already short-circuited otherwise).
      const suppressModuleNames = shouldSuppressModuleNames({
        firstCallModuleVisibility: pbConfig.firstCall?.firstCallModuleVisibility,
        isFirstCall,
        callNumber,
        lastSelectedModuleId: null,
      });
      let session: string;
      if (isFirstCall && modules[0]) {
        session = suppressModuleNames
          ? SUPPRESSED_THIS_SESSION_COPY
          : `First session - introduce ${modules[0].name}`;
      } else if (moduleToReview && nextModule && moduleToReview.slug !== nextModule.slug) {
        session = `Review ${moduleToReview.name} → Introduce ${nextModule.name}`;
      } else if (nextModule) {
        session = `Continue with ${nextModule.name}`;
      } else if (moduleToReview) {
        session = `Deepen mastery of ${moduleToReview.name}`;
      } else if (subjectRef) {
        session = `${isFirstCall ? "First session" : "Continue"} — explore ${subjectRef} based on the caller's interests`;
      } else {
        session = "Open conversation - follow the caller's interests. Do not assume or invent specific academic topics.";
      }
      // Assessment target awareness — when near readiness, focus the session
      const nearTargets = learnerGoals.filter((g: any) => g.isAssessmentTarget && g.progress >= 0.7);
      if (nearTargets.length > 0) {
        session += ` | Assessment focus: ${nearTargets[0].name}`;
      }
      return session;
    })(),

    learner_goals: (() => {
      const regular = learnerGoals.filter((g: any) => !g.isAssessmentTarget);
      if (regular.length === 0) {
        return "No specific goals yet - discover what they want to learn in this session";
      }
      return regular.slice(0, 3).map((g: any) => {
        const progressStr = g.progress > 0 ? ` (${Math.round(g.progress * 100)}% complete)` : "";
        return `${g.name}${progressStr}`;
      }).join("; ");
    })(),

    working_toward: (() => {
      const targets = learnerGoals.filter((g: any) => g.isAssessmentTarget);
      if (targets.length === 0) return null;
      return targets.map((g: any) => {
        const threshold = (g.assessmentConfig as any)?.threshold;
        const progressStr = g.progress > 0
          ? ` (${Math.round(g.progress * 100)}% ready${threshold ? `, target: ${Math.round(threshold * 100)}%` : ""})`
          : "";
        return `• ${g.name}${progressStr}`;
      }).join("\n");
    })(),

    constraints: constraints?.length
      ? constraints.map(c => `NEVER: ${c}`).join("\n")
      : null,

    curriculum_progress: modules.length > 0 ? (() => {
      // #266 Slice 1: when the playbook has authored modules AND we have
      // per-learner attempt data, render a multi-line block the tutor can
      // narrate (e.g. "Baseline — 2 sessions, done"). Falls back to the
      // single-line summary for non-authored or never-attempted courses.
      const isAuthoredWithData =
        pbConfig.modulesAuthored === true && !!moduleAttemptCounts;
      if (isAuthoredWithData) {
        const STATUS_LABEL: Record<"NOT_STARTED" | "IN_PROGRESS" | "COMPLETED", string> = {
          NOT_STARTED: "not started",
          IN_PROGRESS: "in progress",
          COMPLETED: "done",
        };
        const lines = modules.map((m) => {
          const id = m.id || m.slug || "";
          const progress = id ? moduleAttemptCounts?.[id] : undefined;
          const status = (progress?.status ?? "NOT_STARTED") as "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
          const count = progress?.callCount ?? 0;
          const sessions =
            count === 0 ? "not started" : `${count} ${count === 1 ? "session" : "sessions"}, ${STATUS_LABEL[status]}`;
          return `  - ${m.name || m.slug || id}: ${sessions}`;
        });
        return [`Module progress (${modules.length} authored modules):`, ...lines].join("\n");
      }
      const completed = completedModules.size;
      const total = modules.length;
      const currentModuleName = moduleToReview?.name || nextModule?.name;
      if (completed === 0 && total > 0) {
        return `Starting curriculum (0/${total} modules) - begin with ${modules[0]?.name || "first module"}`;
      }
      if (completed === total) {
        return `Curriculum complete (${total}/${total}) - review and reinforce`;
      }
      return `Progress: ${completed}/${total} modules mastered${currentModuleName ? ` | Current: ${currentModuleName}` : ""}`;
    })() : null,

    key_memories: (() => {
      // Identity-critical keys must always surface so the tutor knows what
      // to call the learner. Promote them ahead of the slice cap; fill the
      // remaining slots with the most-recent / highest-ranked memories.
      // (Bug: a learner stated their name in call 1 and the call-2 tutor
      // asked again — name was in CallerMemory but never made it into the
      // composed prompt's Key Memories line.)
      if (deduplicated.length === 0) return null;
      const IDENTITY_KEYS = new Set([
        "name",
        "first_name",
        "firstName",
        "surname",
        "last_name",
        "lastName",
        "nickname",
        "preferred_name",
        "preferredName",
      ]);
      const identity = deduplicated.filter((m: any) => IDENTITY_KEYS.has(m.key));
      const others = deduplicated.filter((m: any) => !IDENTITY_KEYS.has(m.key));
      // Cap at 4 (was 3) so an identity hit doesn't push out a relevant
      // non-identity fact.
      return [...identity, ...others]
        .slice(0, 4)
        .map((m: any) => `${m.key}: ${m.value}`);
    })(),

    voice_style: (() => {
      const warmth = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_WARMTH);
      const questions = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_QUESTION_RATE);
      const responseLength = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_RESPONSE_LEN);
      const warmthLevel = classifyValue(warmth?.targetValue ?? NEUTRAL_PARAMETER_TARGET, thresholds) || "MODERATE";
      const questionLevel = classifyValue(questions?.targetValue ?? NEUTRAL_PARAMETER_TARGET, thresholds) || "MODERATE";
      const responseLengthLevel = classifyValue(responseLength?.targetValue ?? NEUTRAL_PARAMETER_TARGET, thresholds) || "MODERATE";
      return `${warmthLevel} warmth, ${questionLevel} questions, ${responseLengthLevel} response length`;
    })(),

    critical_voice: (() => {
      const responseLength = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_RESPONSE_LEN);
      const turnLength = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_TURN_LENGTH);
      const pauseTolerance = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_PAUSE_TOLERANCE);
      const rl = classifyValue(responseLength?.targetValue ?? NEUTRAL_PARAMETER_TARGET, thresholds);
      const tl = classifyValue(turnLength?.targetValue ?? NEUTRAL_PARAMETER_TARGET, thresholds);
      const pt = classifyValue(pauseTolerance?.targetValue ?? NEUTRAL_PARAMETER_TARGET, thresholds);
      return {
        sentences_per_turn: rl === "LOW" ? "1-2" : rl === "HIGH" ? "3-4" : "2-3",
        max_seconds: tl === "LOW" ? 10 : tl === "HIGH" ? 20 : 15,
        silence_wait: pt === "HIGH" ? "4-5s, don't fill" : pt === "LOW" ? "2s then prompt" : "3s then prompt",
      };
    })(),

    first_line: (() => {
      // Helper: sanitise an educator-authored welcome message so the tutor
      // doesn't ask for things the system already knows. Two passes:
      //   1. Strip name questions when caller.name is known (#268)
      //   2. Replace generic subject questions when subjectRef is known
      // Patterns are anchored to interrogative phrasing (terminal `?`) to
      // avoid stripping declarative prose like "I'll learn your name as we go".
      const sanitiseWelcome = (msg: string): string => {
        let out = msg;

        // ── #268: strip name questions when name is known ──
        // Educator-edited welcome templates often contain literal "could you
        // tell me your name?" — redundant when caller.name is in the prompt
        // header (and surfaced via key_memories per #263). Match the question
        // sentence + optional " And " connector so multi-question welcomes
        // ("...your name? And what brings you here?") preserve the tail.
        if (caller?.name) {
          const namePatterns: RegExp[] = [
            /(?:[Aa]nd\s+)?[Cc]ould you tell me your name\?\s*(?:[Aa]nd\s+)?/g,
            /(?:[Aa]nd\s+)?[Ww]hat(?:'s| is) your name\?\s*(?:[Aa]nd\s+)?/g,
            /(?:[Aa]nd\s+)?[Tt]ell me your name\?\s*(?:[Aa]nd\s+)?/g,
            /(?:[Aa]nd\s+)?[Ll]et me know your name\?\s*(?:[Aa]nd\s+)?/g,
            /(?:[Aa]nd\s+)?[Ss]hare your name\?\s*(?:[Aa]nd\s+)?/g,
            /(?:[Aa]nd\s+)?[Tt]o start,?\s*what should I call you\?\s*(?:[Aa]nd\s+)?/g,
            /(?:[Aa]nd\s+)?[Ww]hat should I call you\?\s*(?:[Aa]nd\s+)?/g,
            /[Pp]lease introduce yourself\?\s*/g,
          ];
          for (const pattern of namePatterns) {
            out = out.replace(pattern, "");
          }
          // Tidy up dangling separators left by the strip (e.g. "first things first - ").
          out = out.replace(/\s*-\s*$/g, "").replace(/\s+/g, " ").trimEnd();
        }

        // ── existing: subject-specific replacement (#171 era) ──
        if (subjectRef) {
          const genericPatterns = [
            /what topic or subject brought you here today\??$/i,
            /what subject are we drilling today\??$/i,
            /what are you preparing for\??$/i,
            /what world shall we explore today\??$/i,
            /what are we working on today\??$/i,
            /what situation would you like to practice\??$/i,
            /what process or journey are we tackling together\??$/i,
          ];
          for (const pattern of genericPatterns) {
            if (pattern.test(out.trim())) {
              out = out.trim().replace(pattern, `We're going to be working on ${subjectRef} together.`);
              break;
            }
          }
        }

        return out;
      };
      // Backward-compat alias — earlier branches called this `injectSubject`
      // before the name-strip extension. Keeping the old name local to avoid
      // touching unrelated callers in this file.
      const injectSubject = sanitiseWelcome;

      // #1385 — rollback of #1367. Locked-module and module-progress
      // branches previously short-circuited with hardcoded literal
      // greetings ("Hi ${name}! Let's get into ${module}.", "Welcome
      // back ${name}!"). Those literals intercepted BEFORE the
      // configurable cascade (identity spec, phase-derived #1195,
      // course-scoped welcome, generic fallback) could fire, making the
      // greeting un-customisable from Course Design and breaking the
      // "Configuration over Code" contract.
      //
      // After rollback: the cascade below handles every case. The
      // system-prompt body still carries `lockedModule.name` and the
      // "don't ask what they want to work on" intent — that's the right
      // home for those directives, not the literal-spoken greeting.
      // Mechanically enforced by `hf-compose/no-hardcoded-greeting-in-
      // composition` (severity `error`). See `.claude/rules/pipeline-
      // and-prompt.md` MANDATORY rule.

      // 1. Identity spec instruction (highest priority — persona spec)
      const identityOpening = (identitySpec?.config as SpecConfig)?.sessionStructure?.opening?.instruction;
      if (identityOpening) return injectSubject(identityOpening);

      // 1.5 #1403 — `welcomeMessage` literal override. Educator-authored
      // greeting wins over phase-derived (1b) when set AND isFirstCall.
      // Pre-#1403 this branch was branch 2 (after phase-derived). The
      // OCEAN-course incident (Beckett, 2026-06-09) showed phase-derived
      // ALWAYS firing for courses with onboarding phases configured —
      // educators' welcomeMessage was being silently shadowed.
      //
      // Token substitution: {firstName} + {courseName} resolved via
      // `substituteGreetingTokens` (allow-listed home under defaults/).
      // Returning-user phrasing guard (#1195) re-applied at this position.
      if (isFirstCall) {
        let welcomeMsgRaw: string | null = null;
        if (config.features.sessionFlowResolverEnabled) {
          welcomeMsgRaw = resolveSessionFlow({
            playbook,
            domain: callerDomain,
            onboardingSpec: loadedData.onboardingSpec,
          }).welcomeMessage;
        } else {
          welcomeMsgRaw = pbConfig.welcomeMessage ?? callerDomain?.onboardingWelcome ?? null;
        }
        if (welcomeMsgRaw) {
          if (hasReturningUserPhrasing(welcomeMsgRaw)) {
            console.log(
              "[first-line/rewrite] welcomeMessage rewritten — returning-user phrasing on first call",
              {
                playbookId: playbook?.id ?? null,
                playbookName: playbook?.name ?? null,
                original: welcomeMsgRaw,
              },
            );
            return rewriteReturningUserPhrasing({
              callerName: caller?.name ?? null,
              subjectRef,
            });
          }
          // Substitute tokens FIRST so the sanitiser sees the resolved
          // text (its strip-name-question pass needs the real name in
          // place to know whether to fire).
          const substituted = substituteGreetingTokens({
            template: welcomeMsgRaw,
            firstName: caller?.name ?? null,
            courseName: playbook?.name ?? null,
          });
          return injectSubject(substituted);
        }
      }

      // 1b. #1195 — Phase-derived first-call opening. When isFirstCall and
      // onboarding phases are configured at any layer of the cascade
      // (playbook, domain, or INIT-001), synthesise the opening from
      // phase 0's first goal classified by intent. This honours the
      // educator's course-setup configuration without inventing facts.
      //
      // Walks the SAME cascade as `pedagogy.ts::computeSessionPedagogy`
      // (and the resolver, when SESSION_FLOW_RESOLVER_ENABLED). Critical:
      // pre-#1195 first_line did NOT read the phases at all — operators
      // configured phases for SESSION FLOW but the literal opening was
      // disconnected. Now they're wired.
      if (isFirstCall) {
        let phases: { phases?: Array<{ goals?: string[]; phase?: string }> } | undefined;
        if (config.features.sessionFlowResolverEnabled) {
          phases = resolveSessionFlow({
            playbook,
            domain: callerDomain,
            onboardingSpec: loadedData.onboardingSpec,
          }).onboarding;
        } else {
          // Mirror `pedagogy.ts:245-249` cascade exactly.
          const playbookPhases = (pbConfig.onboardingFlowPhases as { phases?: Array<{ goals?: string[]; phase?: string }> } | undefined);
          const domainPhases = (callerDomain?.onboardingFlowPhases as { phases?: Array<{ goals?: string[]; phase?: string }> } | undefined);
          const initPhases = ((loadedData.onboardingSpec?.config as { firstCallFlow?: { phases?: Array<{ goals?: string[]; phase?: string }> } } | null | undefined)?.firstCallFlow);
          phases = playbookPhases ?? domainPhases ?? initPhases ?? undefined;
        }
        const firstPhaseGoal = phases?.phases?.[0]?.goals?.[0];
        if (firstPhaseGoal) {
          const intent = classifyFirstPhaseIntent(firstPhaseGoal);
          if (intent !== "unclassified") {
            return renderFirstCallOpening({
              intent,
              callerName: caller?.name ?? null,
              subjectRef,
              moduleTitle:
                nextModule?.title ?? null,
            });
          }
        }
      }

      // 2. (former) Course-scoped welcome — moved to branch 1.5 above
      //    in #1403 so educator's welcomeMessage wins over phase-derived.
      // 3. Generic fallback
      if (isFirstCall) {
        return subjectRef
          ? `Good to have you. We're going to be working on ${subjectRef} together — let's ease into this, no rush.`
          : "Good to have you. Let's just ease into this... no rush.";
      }
      return subjectRef
        ? `Good to reconnect. Ready to pick up where we left off with ${subjectRef}?`
        : "Good to reconnect. Let's pick up where we left off.";
    })(),

    /**
     * #1403 — Greeting ack-gate instruction. Tells the AI whether to
     * PAUSE after the welcomeMessage and wait for a learner response
     * before continuing. Emitted only on isFirstCall — calls 2+ don't
     * have a literal welcomeMessage, so the gate is moot.
     *
     * Rendered into the prompt body between `[OPENING]` and `[RULES]`
     * by `renderPromptSummary.ts`. When mode is "none", the key is
     * intentionally null so renderPromptSummary skips the block.
     */
    greeting_ack_gate: (() => {
      if (!isFirstCall) return null;
      const mode = pbConfig.firstCallWaitForAck ?? "greeting_words";
      switch (mode) {
        case "none":
          return null;
        case "any_response":
          return "After your welcome message, PAUSE. Do not continue until the learner sends any response — wait for them to acknowledge you.";
        case "greeting_words":
          return "After your welcome message, PAUSE. Do not continue until the learner says hello, hi, yes, yeah, or an equivalent greeting word.";
        default:
          return null;
      }
    })(),

    /**
     * #1403 — Course-intro turn spoken after the ack gate. Substitutes
     * `{courseName}` via `substituteGreetingTokens` so the AI receives
     * the resolved literal — never a raw `{...}` marker.
     *
     * Emitted only on isFirstCall AND when the educator has authored
     * a non-empty `firstCallCourseIntro`. Calls 2+ fall through to the
     * phase-derived session plan.
     */
    greeting_course_intro: (() => {
      if (!isFirstCall) return null;
      const raw = pbConfig.firstCallCourseIntro?.trim();
      if (!raw) return null;
      const resolved = substituteGreetingTokens({
        template: raw,
        firstName: caller?.name ?? null,
        courseName: playbook?.name ?? null,
      });
      if (resolved.length === 0) return null;
      return resolved;
    })(),

    /**
     * #2055 (sub-epic F of #2049) — Call 1 opening recap.
     *
     * When `pbConfig.openingRecapEnabled` is true AND this is Call 1,
     * emit a brief recap of the learner's intake answers (goal /
     * confidence / concern / prior knowledge / motivation). The AI
     * tutor uses this to open with continuity — "I see you're working
     * on X and you mentioned Y..." — rather than a cold ask.
     *
     * Distinct from `priorCallFeedback` (Call 2+ history recap). This
     * one looks BACKWARDS at intake; that one looks backwards at the
     * previous call.
     *
     * Pulls from the same `loadedData.callerAttributes` (PRE scope)
     * the `learner_survey` field reads, but presents them as a
     * tutor-facing recap directive rather than raw survey rows.
     *
     * Null when:
     *   - Not Call 1 (Calls 2+ use priorCallFeedback)
     *   - `openingRecapEnabled` is false / undefined
     *   - No intake answers exist (nothing to recap)
     */
    opening_recap: (() => {
      if (!isFirstCall) return null;
      if (pbConfig.openingRecapEnabled !== true) return null;

      const get = (key: string): string | null => {
        const attr = loadedData.callerAttributes.find(
          (a: CallerAttributeData) =>
            a.scope === SURVEY_SCOPES.PRE && a.key === key,
        );
        if (!attr) return null;
        const val = getAttributeValue(attr);
        return val != null ? String(val) : null;
      };

      const goal = get(PRE_SURVEY_KEYS.GOAL_TEXT);
      const priorKnowledge = get(PRE_SURVEY_KEYS.PRIOR_KNOWLEDGE);
      const confidence = get(PRE_SURVEY_KEYS.CONFIDENCE);
      const concern = get(PRE_SURVEY_KEYS.CONCERN_TEXT);
      const motivation = get(PRE_SURVEY_KEYS.MOTIVATION);

      const fragments: string[] = [];
      if (goal) fragments.push(`their stated goal is "${goal}"`);
      if (priorKnowledge) fragments.push(`prior knowledge: ${priorKnowledge}`);
      if (confidence) fragments.push(`self-rated confidence ${confidence}/5`);
      if (concern) fragments.push(`a concern they raised: "${concern}"`);
      if (motivation) fragments.push(`motivation: "${motivation}"`);

      if (fragments.length === 0) return null;

      const learnerLabel = caller?.name ?? "this learner";
      return (
        `Brief recap before you greet: from intake, ${learnerLabel} told us ` +
        `${fragments.join("; ")}. Open by acknowledging at least one of these ` +
        `so the learner feels heard — do NOT ask them to repeat what they already said.`
      );
    })(),

    discovery_guidance: (() => {
      if (!isFirstCall) return null;
      // #274 Slice B: when the learner has picked a specific module, the
      // discovery flow ("what brings you here / what to work on") is moot —
      // they already chose. Welcome-flow surveys (Goals/AboutYou/KC) are
      // gated separately by their own toggles and unaffected here.
      if (lockedModule) {
        return `The learner has picked "${lockedModule.name}" — do NOT ask 'what brings you here' or 'what to work on today'. That decision is already made. Welcome them by name (if known), confirm the focus, and move into teaching.`;
      }

      // Multi-playbook callers: using playbooks?.[0] is an existing assumption — not changed here.
      // Source of truth is `playbook.config.welcome.*.enabled` — what the educator toggles
      // on the Course Design tab. When SESSION_FLOW_RESOLVER_ENABLED, delegate to
      // resolveSessionFlow().intake. The legacy path keeps `?? true` defaults for
      // pre-welcome-config playbooks (epic #221, story #217).
      let askGoals: boolean, askAboutYou: boolean, askKnowledge: boolean;
      if (config.features.sessionFlowResolverEnabled) {
        const resolved = resolveSessionFlow({
          playbook,
          domain: callerDomain,
          onboardingSpec: loadedData.onboardingSpec,
        });
        askGoals = resolved.intake.goals.enabled;
        askAboutYou = resolved.intake.aboutYou.enabled;
        askKnowledge = resolved.intake.knowledgeCheck.enabled;
      } else {
        askGoals = pbConfig.welcome?.goals?.enabled ?? true;
        askAboutYou = pbConfig.welcome?.aboutYou?.enabled ?? true;
        askKnowledge = pbConfig.welcome?.knowledgeCheck?.enabled ?? true;
      }
      const toggles: WelcomeToggles = { askGoals, askAboutYou, askKnowledge };
      const mode = detectPersonalisationMode(loadedData.callerAttributes, toggles);

      if (mode === "PRE_LOADED") {
        const getName = (): string | null => {
          const attr = loadedData.callerAttributes.find(
            (a: CallerAttributeData) => a.scope === SURVEY_SCOPES.PRE && a.key === PRE_SURVEY_KEYS.GOAL_TEXT,
          );
          return attr ? (getAttributeValue(attr) as string | null) : null;
        };
        const callerName = caller?.name ?? "this learner";
        const goal = getName();
        const parts = [`You already know this learner — their name is ${callerName}.`];
        if (goal) parts.push(`Their goal: "${goal}".`);
        parts.push("Do NOT ask for name or goals. Jump straight into teaching.");
        return parts.join(" ");
      }

      if (mode === "OPT_OUT") {
        return "The educator has opted out of all welcome-flow questions. Do NOT ask the learner for their name, goals, motivation, confidence, or prior knowledge. Begin with a warm welcome and move directly into teaching.";
      }

      // COLD_START — discovery is on. Append granular skips for partial opt-outs.
      // #268 follow-up: when caller.name is already on file (joined via magic
      // link, prior session, or admin-created), drop the "discover their name"
      // instruction and direct the tutor to use it. The welcome-message strip
      // alone wasn't enough — this guidance was re-prompting the AI to ask.
      const knownName = caller?.name;
      const opener = knownName
        ? `This is a new learner — their name is already on file as ${knownName}. Greet them by name. Do NOT ask for their name. Discover their goals and prior experience before teaching.`
        : "This is a new learner with no prior data. Start with a warm welcome, then discover their name, goals, and prior experience before teaching.";
      const parts: string[] = [opener];
      if (!askGoals) parts.push("Do NOT ask about their learning goals — the educator has captured these elsewhere.");
      if (!askAboutYou) parts.push("Do NOT ask about their motivation or confidence.");
      if (!askKnowledge) parts.push("Do NOT probe their prior knowledge level.");
      return parts.join(" ");
    })(),

    offboarding_guidance: (() => {
      if (!sharedState.isFinalSession) return null;

      const completedCount = completedModules.size;
      const totalCount = modules.length;

      const parts = [
        `This is call ${callNumber} — the final session for this learner.`,
        `They have completed ${completedCount}/${totalCount} modules.`,
        "",
        "SESSION GOALS:",
        "1. SUMMARISE: Briefly recap what they've learned across all sessions. Highlight key concepts and progress.",
        "2. REFLECT: Ask them what was most valuable, what surprised them, and what they'd like to explore further.",
        "3. CELEBRATE: Acknowledge their effort and growth. Be specific about improvements you've observed.",
        "4. NEXT STEPS: Suggest concrete actions they can take to continue learning independently.",
        "",
        "Keep the tone warm and encouraging. This is a closing conversation, not a teaching session.",
      ];

      return parts.join("\n");
    })(),
  };
});

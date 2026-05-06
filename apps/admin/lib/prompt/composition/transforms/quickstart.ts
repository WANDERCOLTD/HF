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
import { getAudienceOption } from "./audience";
import { SURVEY_SCOPES, PRE_SURVEY_KEYS } from "@/lib/learner/survey-keys";
import { config } from "@/lib/config";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";

/** Keys whose presence (scope PRE) signals the learner already submitted onboarding data */
const PRE_LOADED_KEYS: readonly string[] = [
  PRE_SURVEY_KEYS.GOAL_TEXT,
  PRE_SURVEY_KEYS.SUBMITTED_AT,
];

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
  const { modules, isFirstCall, completedModules, moduleToReview, nextModule, thresholds, callNumber, schedulerDecision, schedulerPolicy } = sharedState;
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
  const durationMins = pbConfig.durationMins;
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
      // Surface aggregated learning competency from CallerAttributes (set by COMP/DISC/COACH-AGG specs)
      const learningAttrs = loadedData.callerAttributes.filter(
        (a: CallerAttributeData) => a.scope === "COMP-AGG-001" || a.scope === "DISC-AGG-001" || a.scope === "COACH-AGG-001",
      );
      if (learningAttrs.length === 0) return null;

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

    this_caller: `${caller?.name ?? caller?.id ?? "anonymous"} (call #${loadedData.callCount || 1})`,

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
      let session: string;
      if (isFirstCall && modules[0]) {
        session = `First session - introduce ${modules[0].name}`;
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
      const warmthLevel = classifyValue(warmth?.targetValue ?? 0.5, thresholds) || "MODERATE";
      const questionLevel = classifyValue(questions?.targetValue ?? 0.5, thresholds) || "MODERATE";
      const responseLengthLevel = classifyValue(responseLength?.targetValue ?? 0.5, thresholds) || "MODERATE";
      return `${warmthLevel} warmth, ${questionLevel} questions, ${responseLengthLevel} response length`;
    })(),

    critical_voice: (() => {
      const responseLength = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_RESPONSE_LEN);
      const turnLength = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_TURN_LENGTH);
      const pauseTolerance = mergedTargets.find((t: any) => t.parameterId === PARAMS.BEH_PAUSE_TOLERANCE);
      const rl = classifyValue(responseLength?.targetValue ?? 0.5, thresholds);
      const tl = classifyValue(turnLength?.targetValue ?? 0.5, thresholds);
      const pt = classifyValue(pauseTolerance?.targetValue ?? 0.5, thresholds);
      return {
        sentences_per_turn: rl === "LOW" ? "1-2" : rl === "HIGH" ? "3-4" : "2-3",
        max_seconds: tl === "LOW" ? 10 : tl === "HIGH" ? 20 : 15,
        silence_wait: pt === "HIGH" ? "4-5s, don't fill" : pt === "LOW" ? "2s then prompt" : "3s then prompt",
      };
    })(),

    first_line: (() => {
      // Helper: if a welcome message asks "what topic/subject" but we already know the subject,
      // replace the generic question with subject-specific context
      const injectSubject = (msg: string): string => {
        if (!subjectRef) return msg;
        // Detect generic subject-asking patterns at the end of the welcome
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
          if (pattern.test(msg.trim())) {
            return msg.trim().replace(pattern, `We're going to be working on ${subjectRef} together.`);
          }
        }
        return msg;
      };

      // 1. Identity spec instruction (highest priority — persona spec)
      const identityOpening = (identitySpec?.config as SpecConfig)?.sessionStructure?.opening?.instruction;
      if (identityOpening) return injectSubject(identityOpening);
      // 2. Course-scoped welcome (playbook.config) > Domain welcome (institution default).
      // When SESSION_FLOW_RESOLVER_ENABLED, delegate to resolveSessionFlow().
      // Both paths must produce byte-equal output (epic #221, story #217).
      if (isFirstCall) {
        let welcomeMsg: string | null = null;
        if (config.features.sessionFlowResolverEnabled) {
          welcomeMsg = resolveSessionFlow({
            playbook,
            domain: callerDomain,
            onboardingSpec: loadedData.onboardingSpec,
          }).welcomeMessage;
        } else {
          welcomeMsg = pbConfig.welcomeMessage ?? callerDomain?.onboardingWelcome ?? null;
        }
        if (welcomeMsg) return injectSubject(welcomeMsg);
      }
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

    discovery_guidance: (() => {
      if (!isFirstCall) return null;

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
      const parts: string[] = [
        "This is a new learner with no prior data. Start with a warm welcome, then discover their name, goals, and prior experience before teaching.",
      ];
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

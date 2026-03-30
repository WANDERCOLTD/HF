/**
 * Quick Start Transform
 * Extracted from route.ts lines 1477-1573
 *
 * Builds the _quickStart section — instant context for voice AI.
 * References sharedState for modules, and sections for targets/goals.
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue } from "../types";
import type { SpecConfig, PlaybookConfig } from "@/lib/types/json-fields";
import type { AssembledContext } from "../types";
import { PARAMS } from "@/lib/registry";
import { getAudienceOption } from "./audience";

registerTransform("computeQuickStart", (
  _rawData: any,
  context: AssembledContext,
) => {
  const { sharedState, loadedData, resolvedSpecs, sections } = context;
  const { modules, isFirstCall, completedModules, moduleToReview, nextModule, thresholds } = sharedState;
  const caller = loadedData.caller;
  const learnerGoals = loadedData.goals;
  const identitySpec = resolvedSpecs.identitySpec;
  const callerDomain = caller?.domain;

  // Use merged targets from the behavior_targets section (already computed)
  const mergedTargets = sections.behaviorTargets?._merged || sections.behaviorTargets?.all || [];

  // Get role statement
  const getRoleStatement = (): string => {
    const config = identitySpec?.config as SpecConfig;
    if (!config) return "A helpful voice assistant";
    if (config.tutor_role?.roleStatement) return config.tutor_role.roleStatement;
    if (config.roleStatement) return config.roleStatement;
    return identitySpec?.description || "A helpful voice assistant";
  };

  // Get deduplicated memories from the memories section
  const deduplicated = sections.memories?._deduplicated || sections.memories?.all || [];

  // Subject/course context for greeting and session orientation
  const playbook = loadedData.playbooks?.[0];
  const pbConfig = (playbook?.config || {}) as PlaybookConfig;
  const subjectDiscipline = pbConfig.subjectDiscipline;
  const courseContext = pbConfig.courseContext;
  // Derive subject name from PlaybookSubject data when subjectDiscipline isn't explicitly set
  const subjectNames = (loadedData.subjectSources as any)?.subjects
    ?.map((s: any) => s.name)
    ?.filter(Boolean) as string[] | undefined;
  const subjectRef = subjectDiscipline
    || (subjectNames?.length ? subjectNames.join(" & ") : null)
    || null;
  const audienceId = pbConfig.audience;
  const constraints = pbConfig.constraints;
  const sessionCount = pbConfig.sessionCount;
  const durationMins = pbConfig.durationMins;
  const lessonPlanModel = pbConfig.lessonPlanModel;
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

    session_pacing: sessionCount || durationMins
      ? `${sessionCount ? `${sessionCount} sessions` : ""}${sessionCount && durationMins ? " x " : ""}${durationMins ? `${durationMins} min each` : ""}`
      : null,

    lesson_model: lessonPlanModel
      ? lessonPlanModel.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      : null,

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

    this_caller: `${caller?.name ?? caller?.id ?? "anonymous"} (call #${loadedData.callCount + 1})`,

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

    key_memories: deduplicated.length > 0
      ? deduplicated.slice(0, 3).map((m: any) => `${m.key}: ${m.value}`)
      : null,

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
      // 2. Course-scoped welcome (playbook.config) > Domain welcome (institution default)
      if (isFirstCall && pbConfig.welcomeMessage) return injectSubject(pbConfig.welcomeMessage);
      if (isFirstCall && callerDomain?.onboardingWelcome) return injectSubject(callerDomain.onboardingWelcome);
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
  };
});

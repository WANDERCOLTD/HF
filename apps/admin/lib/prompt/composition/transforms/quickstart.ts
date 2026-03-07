/**
 * Quick Start Transform
 * Extracted from route.ts lines 1477-1573
 *
 * Builds the _quickStart section — instant context for voice AI.
 * References sharedState for modules, and sections for targets/goals.
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue } from "../types";
import type { SpecConfig } from "@/lib/types/json-fields";
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
  const subjectDiscipline = (playbook?.config as any)?.subjectDiscipline as string | undefined;
  const courseContext = (playbook?.config as any)?.courseContext as string | undefined;
  const subjectRef = subjectDiscipline || playbook?.name || null;
  const audienceId = (playbook?.config as any)?.audience as string | undefined;

  return {
    you_are: (() => {
      let role = getRoleStatement();
      if (callerDomain?.name && (role === "A helpful voice assistant" || role.toLowerCase().includes("generic"))) {
        const discipline = (loadedData.playbooks?.[0]?.config as any)?.subjectDiscipline as string | undefined;
        role = `A ${discipline || callerDomain.name} tutor and voice assistant`;
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

    this_caller: `${caller?.name || "Unknown"} (call #${loadedData.callCount + 1})`,

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
      if (isFirstCall && modules[0]) {
        return `First session - introduce ${modules[0].name}`;
      }
      if (moduleToReview && nextModule && moduleToReview.slug !== nextModule.slug) {
        return `Review ${moduleToReview.name} → Introduce ${nextModule.name}`;
      }
      if (nextModule) return `Continue with ${nextModule.name}`;
      if (moduleToReview) return `Deepen mastery of ${moduleToReview.name}`;
      if (subjectRef) return `${isFirstCall ? "First session" : "Continue"} — explore ${subjectRef} based on the caller's interests`;
      return "Open conversation - follow the caller's interests. Do not assume or invent specific academic topics.";
    })(),

    learner_goals: (() => {
      if (learnerGoals.length === 0) {
        return "No specific goals yet - discover what they want to learn in this session";
      }
      return learnerGoals.slice(0, 3).map(g => {
        const progressStr = g.progress > 0 ? ` (${Math.round(g.progress * 100)}% complete)` : "";
        return `${g.name}${progressStr}`;
      }).join("; ");
    })(),

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
      // 1. Identity spec instruction (highest priority — persona spec)
      const identityOpening = (identitySpec?.config as SpecConfig)?.sessionStructure?.opening?.instruction;
      if (identityOpening) return identityOpening;
      // 2. Domain welcome message (educator-configured via Settings page)
      if (isFirstCall && callerDomain?.onboardingWelcome) return callerDomain.onboardingWelcome;
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

/**
 * Session Pedagogy Transform
 * Extracted from route.ts lines 2158-2229
 *
 * Uses Domain onboarding flow for first-call, falls back to INIT-001.
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import { config } from "@/lib/config";

/**
 * Compute session pedagogy plan (flow, review, new material, principles).
 * Uses shared state for module data, review type, first-call detection.
 * For first calls, uses Domain.onboardingFlowPhases > INIT-001 fallback.
 */
registerTransform("computeSessionPedagogy", (
  _rawData: any,
  context: AssembledContext,
) => {
  const {
    isFirstCall, isFirstCallInDomain,
    modules, moduleToReview, nextModule, reviewType, reviewReason,
    lessonPlanSessionType, lessonPlanEntry, currentSessionNumber,
  } = context.sharedState;
  const domain = context.loadedData.caller?.domain;
  const onboardingSpec = context.loadedData.onboardingSpec;
  // First playbook's config for course-level onboarding override
  const primaryPlaybook = context.loadedData.playbooks?.[0];

  const plan: {
    sessionType: string;
    flow: string[];
    reviewFirst?: { module: string; reason: string; technique: string };
    newMaterial?: { module: string; approach: string };
    principles: string[];
    firstCallPhases?: Array<{
      phase: string;
      duration: string;
      priority: string;
      goals: string[];
      avoid: string[];
    }>;
    successMetrics?: string[];
    /** Lesson plan session info, when available */
    lessonPlanSession?: { number: number; type: string; label: string };
  } = {
    sessionType: isFirstCall ? "FIRST_CALL" : "RETURNING_CALLER",
    flow: [],
    principles: [],
  };

  // =========================================================================
  // THREE-WAY BRANCH: Onboarding / Lesson Plan / Generic Returning Caller
  // =========================================================================

  if (isFirstCall || isFirstCallInDomain) {
    // === ONBOARDING MODE ===
    const firstModule = modules[0];

    // Priority: Playbook (course) override > Domain > INIT-001 fallback
    const playbookFlow = primaryPlaybook?.config?.onboardingFlowPhases as { phases: any[]; successMetrics?: string[] } | undefined;
    const domainFlow = domain?.onboardingFlowPhases as { phases: any[]; successMetrics?: string[] } | null;
    const initFlow = onboardingSpec?.config?.firstCallFlow;
    const fcFlow = playbookFlow || domainFlow || initFlow;
    const source = playbookFlow ? `Playbook ${primaryPlaybook?.name}` : domainFlow ? `Domain ${domain?.slug}` : config.specs.onboarding;

    if (fcFlow?.phases) {
      plan.firstCallPhases = fcFlow.phases;
      plan.successMetrics = fcFlow.successMetrics;

      // Convert phases to flow steps, including content references
      plan.flow = fcFlow.phases.map((phase: any, i: number) => {
        const label = `${i + 1}. ${phase.phase.charAt(0).toUpperCase() + phase.phase.slice(1)} (${phase.duration}) - ${phase.goals[0]}`;
        const contentRefs = phase.content as Array<{ mediaId: string; instruction?: string }> | undefined;
        if (contentRefs?.length) {
          const contentNote = contentRefs.map((c: { instruction?: string }) =>
            c.instruction || "Share assigned content with learner"
          ).join("; ");
          return `${label} [Content: ${contentNote}]`;
        }
        return label;
      });

      console.log(`[pedagogy] Using ${source} first-call flow with ${fcFlow.phases.length} phases`);
    } else {
      // Fallback to default first-call flow
      plan.flow = [
        "1. Welcome & set expectations",
        "2. Probe existing knowledge with open questions",
        `3. Introduce foundation: ${firstModule?.name || "first concept"}`,
        "4. Check understanding with application question",
        "5. Summarize & preview next session",
      ];
    }

    if (firstModule) {
      plan.newMaterial = {
        module: firstModule.name,
        approach: `Start with ${firstModule.description || "foundational concepts"}. Use concrete examples before abstractions.`,
      };
    }
  } else if (lessonPlanSessionType && lessonPlanEntry) {
    // === LESSON PLAN MODE ===
    // Use the session type from the lesson plan to shape pedagogical flow
    plan.sessionType = lessonPlanSessionType.toUpperCase();
    plan.lessonPlanSession = {
      number: currentSessionNumber || lessonPlanEntry.session,
      type: lessonPlanSessionType,
      label: lessonPlanEntry.label,
    };

    // Phase-driven flow (model-aware) — when lesson plan entry has phases
    if (lessonPlanEntry.phases?.length) {
      plan.flow = lessonPlanEntry.phases.map((phase: any, i: number) => {
        const dur = phase.durationMins ? ` (${phase.durationMins}m)` : "";
        const methods = phase.teachMethods?.length
          ? ` — use ${phase.teachMethods.join("/")} techniques` : "";
        const guidance = phase.guidance ? ` — ${phase.guidance}` : "";
        return `${i + 1}. ${phase.label}${dur}${methods}${guidance}`;
      });

      if (moduleToReview && lessonPlanSessionType !== "introduce") {
        plan.reviewFirst = {
          module: moduleToReview.name,
          reason: reviewReason || "Spaced retrieval before new material",
          technique: reviewType === "quick_recall"
            ? "Ask one recall question, wait for their attempt"
            : "Walk through concepts with fresh examples",
        };
      }

      if (nextModule) {
        plan.newMaterial = {
          module: nextModule.name,
          approach: `Session focus: ${lessonPlanEntry.label}`,
        };
      }

      console.log(`[pedagogy] Phase-driven session ${currentSessionNumber}: ${lessonPlanSessionType} with ${lessonPlanEntry.phases.length} phases`);
    } else {
    // Fallback to hardcoded flows per session type (backward compatible)
    switch (lessonPlanSessionType) {
      case "introduce":
        plan.flow = [
          "1. Reconnect - reference last session briefly",
          `2. Preview - orient to today's topic: ${lessonPlanEntry.moduleLabel}`,
          "3. Introduce - start with concrete examples, build to concepts",
          "4. Check understanding - application question on new material",
          "5. Summarize key takeaways and preview next session",
        ];
        plan.newMaterial = {
          module: lessonPlanEntry.moduleLabel,
          approach: `First exposure to ${lessonPlanEntry.moduleLabel}. Lead with examples before definitions. Build from familiar to unfamiliar.`,
        };
        break;

      case "deepen":
        plan.flow = [
          "1. Reconnect - recall previous session",
          `2. Quick recall on ${lessonPlanEntry.moduleLabel} basics`,
          "3. Deepen - explore edge cases, exceptions, applications",
          "4. Practice - harder scenarios, real-world problems",
          "5. Consolidate understanding and preview next session",
        ];
        plan.newMaterial = {
          module: lessonPlanEntry.moduleLabel,
          approach: `Deepen understanding of ${lessonPlanEntry.moduleLabel}. Push beyond basics into application, edge cases, and integration with prior concepts.`,
        };
        if (moduleToReview) {
          plan.reviewFirst = {
            module: moduleToReview.name,
            reason: "Quick recall before deepening",
            technique: "Ask one recall question to activate prior knowledge",
          };
        }
        break;

      case "review":
        plan.flow = [
          "1. Reconnect - reference gap since last session",
          `2. Spaced retrieval (${reviewType}) - recall questions on covered material`,
          "3. Reinforce or correct based on their responses",
          "4. Application - use multiple concepts together",
          "5. Preview what comes next",
        ];
        if (moduleToReview) {
          plan.reviewFirst = {
            module: moduleToReview.name,
            reason: reviewReason,
            technique: reviewType === "quick_recall"
              ? "Ask recall questions, wait for their attempt"
              : "Walk through concepts with fresh examples",
          };
        }
        break;

      case "assess":
        plan.flow = [
          "1. Set context - this session checks understanding",
          "2. Diagnostic questions - gauge mastery across covered modules",
          "3. NO new material - focus entirely on assessment",
          "4. Note gaps - identify areas needing further review",
          "5. Feedback - summarize strengths and areas for growth",
        ];
        break;

      case "consolidate":
        plan.flow = [
          "1. Reconnect - reference the learning journey so far",
          "2. Synthesize - how do the concepts connect across modules?",
          "3. Big picture - overarching themes and patterns",
          "4. Application - integrate multiple concepts in a scenario",
          "5. Reflect - learner articulates their own understanding",
        ];
        break;

      default:
        // Unknown session type — use generic returning caller flow
        plan.flow = [
          "1. Reconnect - reference last session",
          `2. Review - recall on ${moduleToReview?.name || "previous concept"}`,
          `3. New material - ${nextModule?.name || "next concept"}`,
          "4. Integrate old and new",
          "5. Close with summary and preview",
        ];
    }

    console.log(`[pedagogy] Lesson plan session ${currentSessionNumber}: ${lessonPlanSessionType} - ${lessonPlanEntry.label}`);
    } // end fallback switch
  } else {
    // === GENERIC RETURNING CALLER MODE ===
    plan.flow = [
      "1. Reconnect - reference last session specifically",
      `2. Spaced retrieval (${reviewType}) - recall question on ${moduleToReview?.name || "previous concept"}`,
      "3. Reinforce or correct based on their recall",
      `4. Bridge - connect ${moduleToReview?.name || "old"} to ${nextModule?.name || "new material"}`,
      `5. New material - introduce ${nextModule?.name || "next concept"}`,
      "6. Integrate - question using both old and new",
      "7. Close with summary and preview",
    ];

    if (moduleToReview) {
      plan.reviewFirst = {
        module: moduleToReview.name,
        reason: reviewReason,
        technique: reviewType === "quick_recall"
          ? "Ask one recall question, wait for their attempt before proceeding"
          : reviewType === "application"
            ? "Give a scenario requiring them to apply the concept"
            : "Walk through the concept again with a fresh example",
      };
    }

    if (nextModule) {
      plan.newMaterial = {
        module: nextModule.name,
        approach: `After confirming ${moduleToReview?.name || "previous"} understanding, introduce ${nextModule.description || "new concepts"}`,
      };
    }
  }

  plan.principles = [
    "Review BEFORE new material - never skip unless learner explicitly confirms mastery",
    "One main new concept per session - depth over breadth",
    "If review reveals gaps, stay on review - don't accumulate confusion",
    "Connection questions ('How does X relate to Y?') are more valuable than isolated recall",
  ];

  return plan;
});

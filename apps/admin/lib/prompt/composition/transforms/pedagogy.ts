/**
 * Session Pedagogy Transform
 * Extracted from route.ts lines 2158-2229
 *
 * Uses Domain onboarding flow for first-call, falls back to INIT-001.
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import { config } from "@/lib/config";
import { detectPersonalisationMode } from "./quickstart";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";

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
    schedulerDecision, callNumber,
  } = context.sharedState;
  const domain = context.loadedData.caller?.domain;
  const onboardingSpec = context.loadedData.onboardingSpec;

  // Detect whether this caller has any curriculum to work with
  const hasTeachingContent = context.sections.teachingContent?.hasTeachingContent === true;
  const hasCurriculum = modules.length > 0 || hasTeachingContent;
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
    /** Post-coverage guidance — what to do when all TPs are covered */
    postCoverageGuidance?: string;
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

    // Priority: Playbook (course) override > Domain > INIT-001 fallback.
    // When SESSION_FLOW_RESOLVER_ENABLED, delegate to resolveSessionFlow().
    // Both paths must produce byte-equal output during the dual-read window
    // (epic #221, story #217).
    let fcFlow: { phases: any[]; successMetrics?: string[] } | undefined;
    let source: string;
    if (config.features.sessionFlowResolverEnabled) {
      const resolved = resolveSessionFlow({
        playbook: primaryPlaybook,
        domain,
        onboardingSpec,
      });
      fcFlow = resolved.onboarding;
      source =
        resolved.source.onboarding === "new-shape" || resolved.source.onboarding === "playbook-legacy"
          ? `Playbook ${primaryPlaybook?.name}`
          : resolved.source.onboarding === "domain"
            ? `Domain ${domain?.slug}`
            : config.specs.onboarding;
    } else {
      const playbookFlow = primaryPlaybook?.config?.onboardingFlowPhases as { phases: any[]; successMetrics?: string[] } | undefined;
      const domainFlow = domain?.onboardingFlowPhases as { phases: any[]; successMetrics?: string[] } | null;
      const initFlow = onboardingSpec?.config?.firstCallFlow;
      fcFlow = playbookFlow || domainFlow || initFlow;
      source = playbookFlow ? `Playbook ${primaryPlaybook?.name}` : domainFlow ? `Domain ${domain?.slug}` : config.specs.onboarding;
    }

    if (fcFlow?.phases) {
      // Drop the discovery phase from the first-call flow when in-call
      // discovery is redundant. Two cases:
      //   - OPT_OUT: educator turned off all three welcome phases — nothing to ask
      //   - PRE_LOADED: learner already submitted goals/about-you before the call
      // COLD_START keeps the discovery phase (AI asks in-call to fill the gap).
      //
      // Match BOTH "discover" (verb, used in INIT-001 + COACH-001 seed JSONs) and
      // "discovery" (noun, used in fallback-settings.ts DEFAULT_FLOW_PHASES). The
      // regex avoids accidental hits on hypothetical names like "discoverable-state".
      const pbWelcome = primaryPlaybook?.config?.welcome;
      const toggles = {
        askGoals: pbWelcome?.goals?.enabled ?? true,
        askAboutYou: pbWelcome?.aboutYou?.enabled ?? true,
        askKnowledge: pbWelcome?.knowledgeCheck?.enabled ?? true,
      };
      const mode = detectPersonalisationMode(
        context.loadedData.callerAttributes ?? [],
        toggles,
      );
      const dropDiscovery = mode === "OPT_OUT" || mode === "PRE_LOADED";
      const DISCOVERY_PHASE_RE = /^discover(y)?$/i;
      const allPhases = fcFlow.phases as any[];
      const filteredPhases = dropDiscovery
        ? allPhases.filter((p: any) => !DISCOVERY_PHASE_RE.test(p?.phase ?? ""))
        : allPhases;
      const removedCount = allPhases.length - filteredPhases.length;

      // Per-goal filtering: when Knowledge Check is OFF but discovery phase
      // survives (Goals or About You still on), strip goals that reference
      // probing prior knowledge. Resolves the contradiction between phase-
      // listed goals (e.g. "Assess existing knowledge level") and the
      // "Do NOT probe their prior knowledge level" directive that
      // quickstart.ts injects into discovery_guidance.
      const KNOWLEDGE_GOAL_RE = /\b(prior\s+knowledge|existing\s+knowledge|knowledge\s+level|assess.*knowledge|probe.*knowledge)\b/i;
      let goalDropCount = 0;
      const phasesAfterGoalFilter = !toggles.askKnowledge
        ? filteredPhases.map((p: any) => {
            if (!DISCOVERY_PHASE_RE.test(p?.phase ?? "")) return p;
            const originalGoals = (p.goals ?? []) as string[];
            const keptGoals = originalGoals.filter(g => !KNOWLEDGE_GOAL_RE.test(g));
            if (keptGoals.length === originalGoals.length) return p;
            goalDropCount += originalGoals.length - keptGoals.length;
            return { ...p, goals: keptGoals };
          })
        : filteredPhases;

      plan.firstCallPhases = phasesAfterGoalFilter;
      plan.successMetrics = fcFlow.successMetrics;

      // Convert phases to flow steps, including content references
      plan.flow = phasesAfterGoalFilter.map((phase: any, i: number) => {
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

      console.log(`[pedagogy] Using ${source} first-call flow with ${phasesAfterGoalFilter.length} phases`);
      if (removedCount > 0) {
        console.log(`[pedagogy] Filtered ${removedCount} discovery phase(s) — personalisation mode = ${mode}`);
      }
      if (goalDropCount > 0) {
        console.log(`[pedagogy] Dropped ${goalDropCount} prior-knowledge goal(s) from discovery phase — Knowledge Check off`);
      }
    } else {
      // Fallback to default first-call flow.
      // The "Probe existing knowledge" step is the open-conversation cousin
      // of the Knowledge Check welcome-flow flag — both gauge prior knowledge,
      // just different formats (probe = Socratic Q, knowledgeCheck = MCQ).
      // Gate the probe step on welcome.knowledgeCheck specifically so educators
      // who turn off Knowledge Check on Course Design don't get probed anyway.
      const fbAskKnowledge =
        primaryPlaybook?.config?.welcome?.knowledgeCheck?.enabled ?? true;

      if (!fbAskKnowledge) {
        plan.flow = [
          "1. Welcome & set expectations",
          `2. Introduce foundation: ${firstModule?.name || "first concept"}`,
          "3. Check understanding with application question",
          "4. Summarize & preview next session",
        ];
      } else {
        plan.flow = [
          "1. Welcome & set expectations",
          "2. Probe existing knowledge with open questions",
          `3. Introduce foundation: ${firstModule?.name || "first concept"}`,
          "4. Check understanding with application question",
          "5. Summarize & preview next session",
        ];
      }
    }

    if (firstModule) {
      plan.newMaterial = {
        module: firstModule.name,
        approach: `Start with ${firstModule.description || "foundational concepts"}. Use concrete examples before abstractions.`,
      };
    }
  } else if (schedulerDecision && hasCurriculum) {
    // === SCHEDULER MODE ===
    // Use the scheduler's decision mode to shape pedagogical flow
    const mode = schedulerDecision.mode;
    plan.sessionType = mode.toUpperCase();
    plan.lessonPlanSession = {
      number: callNumber,
      type: mode,
      label: `Scheduler: ${mode}`,
    };

    switch (mode) {
      case "teach":
        plan.flow = [
          "1. Reconnect - reference last session briefly",
          `2. Preview - orient to today's topic: ${nextModule?.name || "next concept"}`,
          "3. Introduce - start with concrete examples, build to concepts",
          "4. Check understanding - application question on new material",
          "5. Summarize key takeaways",
        ];
        if (nextModule) {
          plan.newMaterial = {
            module: nextModule.name,
            approach: `Introduce ${nextModule.description || "new concepts"}. Lead with examples before definitions.`,
          };
        }
        if (moduleToReview && nextModule?.name !== moduleToReview.name) {
          plan.reviewFirst = {
            module: moduleToReview.name,
            reason: reviewReason || "Spaced retrieval before new material",
            technique: reviewType === "quick_recall"
              ? "Ask one recall question, wait for their attempt"
              : "Walk through concepts with fresh examples",
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

      case "practice":
        plan.flow = [
          "1. Reconnect - reference the learning journey so far",
          "2. Synthesize - how do the concepts connect across modules?",
          "3. Application - integrate multiple concepts in a scenario",
          "4. Practice harder scenarios and real-world problems",
          "5. Reflect - learner articulates their own understanding",
        ];
        break;

      default:
        plan.flow = [
          "1. Reconnect - reference last session",
          `2. Review - recall on ${moduleToReview?.name || "previous concept"}`,
          `3. New material - ${nextModule?.name || "next concept"}`,
          "4. Integrate old and new",
          "5. Close with summary and preview",
        ];
    }

    console.log(`[pedagogy] Scheduler call ${callNumber}: ${mode}`);
  } else if (hasCurriculum) {
    // === GENERIC RETURNING CALLER MODE (with curriculum) ===
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
  } else {
    // === NO CURRICULUM MODE — open conversation, do NOT invent topics ===
    plan.sessionType = "OPEN_CONVERSATION";
    plan.flow = [
      "1. Reconnect - warmly reference the previous conversation",
      "2. Ask what they'd like to talk about or work on today",
      "3. Follow the caller's lead - explore their chosen topic",
      "4. Use open questions to deepen the conversation",
      "5. Summarise what was discussed and ask if there's anything else",
    ];
    // No reviewFirst — nothing to review
    // No newMaterial — nothing assigned
    console.log("[pedagogy] No curriculum loaded — using open conversation flow");
  }

  // =========================================================================
  // POST-COVERAGE GUIDANCE — what to do when all TPs are covered
  // =========================================================================
  const isTeachingSession = hasCurriculum && !isFirstCall && !isFirstCallInDomain
    && plan.sessionType !== "OPEN_CONVERSATION";

  if (isTeachingSession) {
    const tutorSpec = (context.loadedData.systemSpecs as Array<{ slug?: string; config?: any }>)?.find(
      (s) => s.slug?.toUpperCase().includes("TUT-001") || s.slug?.toUpperCase().includes("TUTOR-IDENTITY"),
    );
    const pcFlow = tutorSpec?.config?.session_pedagogy?.postCoverageFlow;

    if (pcFlow?.phases) {
      plan.postCoverageGuidance = [
        "IF YOU COVER ALL TEACHING POINTS BEFORE THE SESSION ENDS:",
        ...(pcFlow.phases as Array<{ condition?: string; action: string }>).map((p, i: number) =>
          `${i + 1}. ${p.condition ? `[${p.condition}] ` : ""}${p.action}`,
        ),
        "",
        ...((pcFlow.principles as string[]) || []).map((p: string) => `- ${p}`),
      ].join("\n");
    } else {
      // Hardcoded fallback (spec not yet seeded)
      plan.postCoverageGuidance = [
        "IF YOU COVER ALL TEACHING POINTS BEFORE THE SESSION ENDS:",
        "1. Signal: 'We've covered everything I had planned — nice work.'",
        "2. Confidence check: 'Which topic feels least solid?'",
        "3. [Shaky] Teach-back: 'Try explaining [topic] to me as if I didn't know it.'",
        "4. [Solid] Retrieval probe: application question combining two session concepts.",
        "5. Preview next session + warm close.",
        "",
        "- Never invent new curriculum beyond what is assigned.",
        "- Stretching should feel rewarding, not punitive.",
      ].join("\n");
    }
  }

  plan.principles = hasCurriculum
    ? [
        "Review BEFORE new material - never skip unless learner explicitly confirms mastery",
        "One main new concept per session - depth over breadth",
        "If review reveals gaps, stay on review - don't accumulate confusion",
        "Connection questions ('How does X relate to Y?') are more valuable than isolated recall",
      ]
    : [
        "Do NOT invent or assume specific academic topics, modules, or curriculum",
        "Follow the caller's lead — let them set the agenda",
        "If the caller mentions a topic from a previous conversation, explore it naturally",
        "Keep the conversation supportive and exploratory, not lecture-based",
      ];

  return plan;
});

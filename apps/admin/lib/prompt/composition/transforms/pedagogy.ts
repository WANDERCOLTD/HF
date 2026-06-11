/**
 * Session Pedagogy Transform
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §4
 * @canonical-doc docs/CONTENT-PIPELINE.md §11
 *
 * Uses Domain onboarding flow for first-call, falls back to INIT-001.
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, CourseInstructionData } from "../types";
import { config } from "@/lib/config";
import { detectPersonalisationMode } from "./quickstart";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import type { OnboardingPhase } from "@/lib/types/json-fields";
import {
  shouldSuppressModuleNames,
  SUPPRESSED_NEW_MATERIAL_MODULE,
  SUPPRESSED_INTRODUCE_STEP,
} from "./module-visibility-gate";

/**
 * Match a session range string (e.g., "1", "1-3", "2+", "final") against a
 * call number. Mirror of the helper in `transforms/course-instructions.ts` —
 * kept local so pedagogy can decide whether course-ref `session_override`
 * assertions apply to the current call without importing transform internals.
 */
function matchesSessionRange(range: unknown, callNumber: number): boolean {
  if (typeof range !== "string") return false;
  const trimmed = range.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed === "final" || trimmed === "last") return false;
  if (trimmed.endsWith("+")) {
    const lower = parseInt(trimmed.slice(0, -1), 10);
    if (!isNaN(lower)) return callNumber >= lower;
  }
  if (trimmed.includes("-")) {
    const [startStr, endStr] = trimmed.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!isNaN(start) && !isNaN(end)) return callNumber >= start && callNumber <= end;
  }
  const exact = parseInt(trimmed, 10);
  if (!isNaN(exact)) return callNumber === exact;
  return false;
}

/**
 * Pull `session_override` course-ref assertions that match the current call
 * and turn them into a single synthetic OnboardingPhase. When this returns a
 * non-empty result, the override REPLACES `onboardingFlowPhases` for this
 * call — see comment in computeSessionPedagogy.
 *
 * Refs CONTENT-PIPELINE.md §11 — "Generic welcome fires instead of course-ref
 * First-Call rules" (added 2026-05-10).
 */
export function deriveSessionOverridePhases(
  courseInstructions: CourseInstructionData[] | undefined,
  callNumber: number | undefined,
): { phases: OnboardingPhase[]; matchedCount: number } | null {
  if (!callNumber || !courseInstructions || courseInstructions.length === 0) return null;
  const matched = courseInstructions.filter(
    (inst) =>
      inst.category === "session_override"
      && matchesSessionRange(inst.section, callNumber),
  );
  if (matched.length === 0) return null;

  // Render every matched override as a single phase. The assertion text is
  // already a "Do X; Do Y; …" sentence (see course-ref-to-assertions.ts §424)
  // — splitting it back into bullet goals preserves educator intent.
  const goals: string[] = [];
  for (const inst of matched) {
    const sentences = inst.assertion
      .split(/\.\s+(?=[A-Z])/)
      .map((s) => s.trim().replace(/\.$/, ""))
      .filter(Boolean);
    goals.push(...sentences);
  }

  const phase: OnboardingPhase = {
    phase: "course-ref-special-rules",
    duration: "see course-ref",
    goals: goals.length > 0 ? goals : ["Follow First-Call rules from course-ref.md"],
  };

  return { phases: [phase], matchedCount: matched.length };
}

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
    // #1008 (I-C1) — pedagogy must honour the module lock. When set, the
    // generic returning-caller flow below switches to a lock-focused branch
    // that targets the locked module rather than spaced-retrieving an
    // unrelated module the learner has never touched (Maya #1006).
    lockedModule,
  } = context.sharedState;
  const domain = context.loadedData.caller?.domain;
  const onboardingSpec = context.loadedData.onboardingSpec;

  // #1008 (I-C3) — evidence gate for memory-less reminisce. When the learner
  // has no CallerMemory rows AND no prior-call feedback, the AI has nothing
  // factual to anchor a "reference last session" directive against. Without
  // this gate, the model fabricates plausible-sounding history (Maya #1006:
  // "from one minute panic to past 90 seconds").
  const memoryCount = context.loadedData.memories?.length ?? 0;
  const priorCallFeedback = (context.sections as Record<string, unknown> | undefined)?.priorCallFeedback as
    | { hasFeedback?: boolean }
    | undefined;
  const hasPriorEvidence = memoryCount > 0 || priorCallFeedback?.hasFeedback === true;

  // Detect whether this caller has any curriculum to work with
  const hasTeachingContent = context.sections.teachingContent?.hasTeachingContent === true;
  const hasCurriculum = modules.length > 0 || hasTeachingContent;
  // First playbook's config for course-level onboarding override
  const primaryPlaybook = context.loadedData.playbooks?.[0];

  // #790 (S8) — first-call mode override. Default 'onboarding' preserves
  // existing behaviour byte-for-byte. `teach_immediately` skips the
  // ONBOARDING MODE branch so the returning-caller flow runs on call 1.
  // `baseline_assessment` swaps in a diagnostic-only branch with no
  // curriculum teaching content. See lib/types/json-fields.ts.
  const firstCallMode =
    ((primaryPlaybook as { config?: { firstCallMode?: "onboarding" | "teach_immediately" | "baseline_assessment" } })?.config?.firstCallMode) ?? "onboarding";
  const isFirstCallAny = isFirstCall || isFirstCallInDomain;
  // #598 Slice 1 — `firstCall.introducePedagogy === false` suppresses the
  // ONBOARDING MODE intro block on call 1 (the "here's how this works"
  // speech). Behaviour-wise this matches firstCallMode=teach_immediately for
  // the ONBOARDING-vs-RETURNING gate, but kept as a separate knob so it
  // composes cleanly with `baseline_assessment` (which keeps its own branch).
  // Absent or `true` → current behaviour.
  const introducePedagogy =
    ((primaryPlaybook as { config?: { firstCall?: { introducePedagogy?: boolean } } })?.config?.firstCall?.introducePedagogy) ?? true;
  const isOnboardingFirstCall =
    isFirstCallAny && firstCallMode === "onboarding" && introducePedagogy;
  // #1405 — module-visibility gate. Decided once, applied in the
  // onboarding-first-call branch below to redact module names from
  // `plan.newMaterial.module` and "Introduce <module>" flow steps.
  const moduleVisibility = (
    (primaryPlaybook as {
      config?: {
        firstCall?: {
          firstCallModuleVisibility?:
            | "mention_from_call_1"
            | "hide_until_call_2"
            | "hide_until_learner_picks";
        };
      };
    })?.config?.firstCall?.firstCallModuleVisibility
  );
  const suppressModuleNames = shouldSuppressModuleNames({
    firstCallModuleVisibility: moduleVisibility,
    isFirstCall: Boolean(isFirstCallAny),
    callNumber: callNumber ?? 0,
    lastSelectedModuleId: lockedModule
      ? (lockedModule.id ?? lockedModule.slug ?? null)
      : null,
  });
  const isBaselineFirstCall = isFirstCallAny && firstCallMode === "baseline_assessment";
  if (isFirstCallAny && firstCallMode === "onboarding" && !introducePedagogy) {
    console.log(
      "[pedagogy] #598 Slice 1: firstCall.introducePedagogy=false — suppressing ONBOARDING MODE intro on call 1; routing through returning-caller flow.",
    );
  }

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
    // #790 (S8) — sessionType now reflects firstCallMode on call 1:
    //   onboarding (default) → FIRST_CALL (current behaviour)
    //   baseline_assessment  → BASELINE
    //   teach_immediately    → RETURNING_CALLER (treat call 1 as returning)
    sessionType: isOnboardingFirstCall
      ? "FIRST_CALL"
      : isBaselineFirstCall
        ? "BASELINE"
        : "RETURNING_CALLER",
    flow: [],
    principles: [],
  };

  // =========================================================================
  // FOUR-WAY BRANCH: Baseline / Onboarding / Lesson Plan / Generic Returning Caller
  //
  // #790 (S8) — `firstCallMode` selects between Baseline and Onboarding on
  // call 1. `teach_immediately` falls THROUGH this if-chain entirely so the
  // scheduler / returning-caller path runs on call 1 with no first-call
  // override flow. `baseline_assessment` short-circuits with a diagnostic-
  // only flow that ignores any curriculum teaching content.
  // =========================================================================

  if (isBaselineFirstCall) {
    // === BASELINE ASSESSMENT MODE (#790 S8) ===
    // Diagnostic-only first call: capture baseline scores against learning
    // objectives, no teaching content, no correction. The corresponding
    // critical rule (BASELINE_ASSESSMENT_RULE) is injected by preamble.ts.
    plan.flow = [
      "1. Set context — this first call captures baseline ability, no teaching.",
      "2. Ask the learner to attempt each learning objective in turn.",
      "3. Listen and score; do NOT correct or explain.",
      "4. Encourage attempts; never lead the learner to a correct answer.",
      "5. Close by thanking them and explaining teaching starts next session.",
    ];
    plan.principles = [
      "No teaching, no review, no remediation on this call.",
      "Score every learning objective you observe.",
      "Encourage attempts; never give the answer.",
    ];
    console.log("[pedagogy] firstCallMode=baseline_assessment — diagnostic-only flow");
  } else if (isOnboardingFirstCall) {
    // === ONBOARDING MODE ===
    const firstModule = modules[0];

    // Priority for first-call flow (highest first):
    //   0. course-ref `session_override` assertion matching current callNumber
    //   1. Playbook (course) override
    //   2. Domain
    //   3. INIT-001 fallback
    //
    // Layer 0 is the answer to the "AI did a generic welcome instead of
    // the course-ref First-Call rules" incident (2026-05-10). When the
    // educator's course-ref.md has `**Session scope:** 1` sections, those
    // become `category=session_override` `section="1"` assertions on
    // extraction. When such assertions match the current call, they REPLACE
    // `onboardingFlowPhases` entirely — not augment it.
    //
    // When SESSION_FLOW_RESOLVER_ENABLED, delegate to resolveSessionFlow().
    // Both paths must produce byte-equal output during the dual-read window
    // (epic #221, story #217) — the override layer applies AFTER resolution.
    let fcFlow: { phases: OnboardingPhase[]; successMetrics?: string[] } | undefined;
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
      const playbookFlow = primaryPlaybook?.config?.onboardingFlowPhases as { phases: OnboardingPhase[]; successMetrics?: string[] } | undefined;
      const domainFlow = domain?.onboardingFlowPhases as { phases: OnboardingPhase[]; successMetrics?: string[] } | null;
      const initFlow = onboardingSpec?.config?.firstCallFlow;
      fcFlow = playbookFlow || domainFlow || initFlow;
      source = playbookFlow ? `Playbook ${primaryPlaybook?.name}` : domainFlow ? `Domain ${domain?.slug}` : config.specs.onboarding;
    }

    // Layer 0: course-ref session_override REPLACES whichever flow resolution
    // chose. Logged so educators can see why the welcome flow they configured
    // is not firing.
    const overrideResult = deriveSessionOverridePhases(
      context.loadedData.courseInstructions,
      callNumber,
    );
    if (overrideResult) {
      const previousSource = source;
      fcFlow = { phases: overrideResult.phases };
      source = "course-ref session_override";
      console.log(
        `[compose] course-ref First-Call rules override ${previousSource} for call ${callNumber} (${overrideResult.matchedCount} session_override assertion(s) matched)`,
      );
    } else if (callNumber) {
      // Negative-path visibility: when overrides COULD fire but didn't.
      const sessionOverrideCount = (context.loadedData.courseInstructions ?? []).filter(
        (i) => i.category === "session_override",
      ).length;
      if (sessionOverrideCount > 0) {
        console.log(
          `[compose] No course-ref session_override applies to call ${callNumber} (${sessionOverrideCount} override(s) in course-ref, none matched); using ${source}`,
        );
      }
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

      // #1008 (I-C4) — drop the "Introduce foundation" step when there is no
      // first module to anchor it to. Generic noun "first concept" is a
      // fabrication invitation.
      // #1405 — when module-visibility gate is active, the "Introduce
      // foundation: <module>" step swaps to "introduce the subject area".
      // The teaching-content block still loads — only the framing copy
      // is redacted.
      const introduceStep = (n: number): string => {
        if (!firstModule) return "";
        return suppressModuleNames
          ? `${n}. Introduce foundation — ${SUPPRESSED_INTRODUCE_STEP}`
          : `${n}. Introduce foundation: ${firstModule.name}`;
      };
      if (!fbAskKnowledge) {
        plan.flow = [
          "1. Welcome & set expectations",
          ...(firstModule
            ? [introduceStep(2)]
            : []),
          `${firstModule ? 3 : 2}. Check understanding with application question`,
          `${firstModule ? 4 : 3}. Summarize & preview next session`,
        ];
      } else {
        plan.flow = [
          "1. Welcome & set expectations",
          "2. Probe existing knowledge with open questions",
          ...(firstModule
            ? [introduceStep(3)]
            : []),
          `${firstModule ? 4 : 3}. Check understanding with application question`,
          `${firstModule ? 5 : 4}. Summarize & preview next session`,
        ];
      }
    }

    if (firstModule) {
      // #1405 — module-visibility gate. When suppressed, swap the module
      // name out of the framing field; keep the `approach` generic enough
      // that the AI doesn't immediately name the module via the description.
      plan.newMaterial = {
        module: suppressModuleNames
          ? SUPPRESSED_NEW_MATERIAL_MODULE
          : firstModule.name,
        // #1008 (I-C4) — anchor on the module name when description is null;
        // never emit the generic "foundational concepts" placeholder.
        approach: suppressModuleNames
          ? "Start with broad subject framing. Use concrete examples before abstractions; let the learner's interests surface what to cover first."
          : firstModule.description
            ? `Start with ${firstModule.description}. Use concrete examples before abstractions.`
            : `Start with ${firstModule.name}. Use concrete examples before abstractions.`,
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

    // #1008 (I-C3, I-C4) — local helpers for the scheduler-mode branches:
    //   • reconnectStep drops "reference last session" when no evidence
    //   • orStart is used for graceful first-step substitution
    const reconnectStep = (variant: string): string[] =>
      hasPriorEvidence ? [`1. Reconnect - ${variant}`] : [];
    const renumber = (steps: string[]): string[] =>
      steps.map((s, i) => s.replace(/^\d+\./, `${i + 1}.`));

    switch (mode) {
      case "teach": {
        // #1008 (I-C4) — drop the "Preview ${nextModule.name}" step rather
        // than emit "${... || "next concept"}". Renumber the rest.
        const steps = [
          ...reconnectStep("reference last session briefly"),
          ...(nextModule ? [`Preview - orient to today's topic: ${nextModule.name}`] : []),
          "Introduce - start with concrete examples, build to concepts",
          "Check understanding - application question on new material",
          "Summarize key takeaways",
        ];
        plan.flow = renumber(steps.map((s, i) => `${i + 1}. ${s}`));
        if (nextModule) {
          plan.newMaterial = {
            module: nextModule.name,
            // #1008 (I-C4) — anchor on the module name when description is null.
            approach: nextModule.description
              ? `Introduce ${nextModule.description}. Lead with examples before definitions.`
              : `Introduce ${nextModule.name}. Lead with examples before definitions.`,
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
      }

      case "review": {
        const steps = [
          ...reconnectStep("reference gap since last session"),
          `Spaced retrieval (${reviewType}) - recall questions on covered material`,
          "Reinforce or correct based on their responses",
          "Application - use multiple concepts together",
          "Preview what comes next",
        ];
        plan.flow = renumber(steps.map((s, i) => `${i + 1}. ${s}`));
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
      }

      case "assess":
        plan.flow = [
          "1. Set context - this session checks understanding",
          "2. Diagnostic questions - gauge mastery across covered modules",
          "3. NO new material - focus entirely on assessment",
          "4. Note gaps - identify areas needing further review",
          "5. Feedback - summarize strengths and areas for growth",
        ];
        break;

      case "practice": {
        // #1008 (I-C3) — "reference the learning journey so far" requires
        // prior evidence to anchor; without it, drop the line.
        const steps = [
          ...reconnectStep("reference the learning journey so far"),
          "Synthesize - how do the concepts connect across modules?",
          "Application - integrate multiple concepts in a scenario",
          "Practice harder scenarios and real-world problems",
          "Reflect - learner articulates their own understanding",
        ];
        plan.flow = renumber(steps.map((s, i) => `${i + 1}. ${s}`));
        break;
      }

      default: {
        // #1008 (I-C4) — drop the "Review on previous concept" and
        // "New material - next concept" steps when the data is missing,
        // rather than emit generic nouns.
        const steps = [
          ...reconnectStep("reference last session"),
          ...(moduleToReview ? [`Review - recall on ${moduleToReview.name}`] : []),
          ...(nextModule ? [`New material - ${nextModule.name}`] : []),
          "Integrate old and new",
          "Close with summary and preview",
        ];
        plan.flow = renumber(steps.map((s, i) => `${i + 1}. ${s}`));
      }
    }

    console.log(`[pedagogy] Scheduler call ${callNumber}: ${mode}`);
  } else if (hasCurriculum && lockedModule) {
    // === LOCKED-MODULE MODE (Maya #1006 path) ===
    // #1008 (I-C1) — the learner explicitly picked a module to work on, and
    // the scheduler was bypassed at compose time. We MUST NOT spaced-retrieve
    // a different module from catalogue order. Focus the flow on the locked
    // module; only emit reminisce text when there is evidence.
    plan.sessionType = "LOCKED_MODULE";
    const lockSteps = [
      ...(hasPriorEvidence ? ["Reconnect - reference the prior session(s) on this module"] : []),
      `Anchor - re-establish the goal for ${lockedModule.name}`,
      `Engage - learner-led attempt on a representative ${lockedModule.name} task`,
      "Feedback - confirm, refine, or correct based on the attempt",
      "Close with one specific takeaway and a preview of the next attempt",
    ];
    plan.flow = lockSteps.map((s, i) => `${i + 1}. ${s}`);

    if (moduleToReview && moduleToReview.name === lockedModule.name) {
      plan.reviewFirst = {
        module: lockedModule.name,
        reason: reviewReason || "Continuing focused practice on this module",
        technique: reviewType === "quick_recall"
          ? "Ask one recall question on the locked module before the attempt"
          : reviewType === "application"
            ? "Give a scenario tied to the locked module"
            : "Re-state the locked module's goal in plain language",
      };
    }
    if (lockedModule.description) {
      plan.newMaterial = {
        module: lockedModule.name,
        approach: `Stay inside ${lockedModule.name}. ${lockedModule.description}`,
      };
    }
  } else if (hasCurriculum) {
    // === GENERIC RETURNING CALLER MODE (with curriculum) ===
    // #1008 (I-C3, I-C4) — every step here is conditional on real data.
    // Generic-noun fallbacks dropped; reminisce gated on hasPriorEvidence.
    const steps = [
      ...(hasPriorEvidence ? ["Reconnect - reference last session specifically"] : []),
      ...(moduleToReview ? [`Spaced retrieval (${reviewType}) - recall question on ${moduleToReview.name}`] : []),
      ...(moduleToReview ? ["Reinforce or correct based on their recall"] : []),
      ...(moduleToReview && nextModule
        ? [`Bridge - connect ${moduleToReview.name} to ${nextModule.name}`]
        : []),
      ...(nextModule ? [`New material - introduce ${nextModule.name}`] : []),
      "Integrate - question using available material",
      "Close with summary and preview",
    ];
    plan.flow = steps.map((s, i) => `${i + 1}. ${s}`);

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
        // #1008 (I-C4) — anchor on names when description is null, and drop
        // the "previous understanding" clause when moduleToReview is null
        // rather than fabricating a "previous" placeholder.
        approach: moduleToReview
          ? nextModule.description
            ? `After confirming ${moduleToReview.name} understanding, introduce ${nextModule.description}`
            : `After confirming ${moduleToReview.name} understanding, introduce ${nextModule.name}`
          : nextModule.description
            ? `Introduce ${nextModule.description}`
            : `Introduce ${nextModule.name}`,
      };
    }
  } else {
    // === NO CURRICULUM MODE — open conversation, do NOT invent topics ===
    plan.sessionType = "OPEN_CONVERSATION";
    plan.flow = [
      ...(hasPriorEvidence
        ? ["1. Reconnect - warmly reference the previous conversation"]
        : ["1. Welcome - start a fresh conversation"]),
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
  // #790 (S8) — `teach_immediately` IS a teaching session on call 1, but
  // `onboarding` and `baseline_assessment` are not. The exclusion now keys
  // off the firstCallMode-aware flags computed above, not raw isFirstCall.
  const isTeachingSession = hasCurriculum && !isOnboardingFirstCall && !isBaselineFirstCall
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

  // #790 (S8) — baseline mode owns its own principles; do NOT overwrite.
  // Onboarding sets `principles=[]` (existing behaviour) so the curriculum-
  // vs-no-curriculum block below applies. teach_immediately falls into the
  // returning-caller principles which match the existing call-2+ behaviour.
  if (isBaselineFirstCall) {
    return plan;
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

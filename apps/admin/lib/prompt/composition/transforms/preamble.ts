/**
 * Preamble Transform
 * Extracted from route.ts lines 1581-1656
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import type { AuthoredModule, SpecConfig, PlaybookConfig } from "@/lib/types/json-fields";
import { isTeachingMode, type TeachingMode } from "@/lib/content-trust/resolve-config";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { config } from "@/lib/config";
// #610 — code-side defaults for criticalRules live in `defaults/` so the
// transforms directory holds mechanics only. Audit counter
// `hardcodedRulesRemainingInTransforms` greps this directory; keeping
// content out of it is the structural marker that separates policy from
// pipeline. Spec config still wins (see selection logic below).
import {
  RETURNING_CALLER_BY_MODE,
  BASELINE_ASSESSMENT_RULE,
  BASELINE_ASSESSMENT_RULE_SILENT,
} from "../defaults/critical-rules";

const PREAMBLE_FALLBACK = "You are receiving a structured context package for your next conversation. This data has been assembled specifically for this caller based on their history, personality, and learning progress. Use it to deliver a personalized, effective session.";

/**
 * Read playbook `teachingMode` from the assembled context. Mirrors the
 * pattern in `transforms/pedagogy-mode.ts:100-106` exactly — playbook
 * raw config wins over the first PlaybookItem spec's config; returns
 * undefined when neither is set (caller falls back to recall behaviour).
 *
 * Reads are runtime-guarded by `isTeachingMode` because the JSON column
 * can hold any string. An invalid value (observed 2026-06-18: IELTS
 * Speaking Practice playbook with `teachingMode: "directive"`, an
 * `interactionPattern` value cross-wired into the wrong field) returns
 * undefined here so the caller falls through to recall — same surface
 * as the "not set at all" branch the comment above already promises.
 * Without the guard, an unknown key indexes RETURNING_CALLER_BY_MODE to
 * undefined and crashes ComposedPrompt.create on `criticalRules[3]`.
 */
function readPlaybookTeachingMode(
  context: AssembledContext,
): TeachingMode | undefined {
  const playbooks = context.loadedData.playbooks;
  const pbConfig = playbooks?.[0]?.items?.[0]?.spec?.config as
    | { teachingMode?: unknown }
    | undefined;
  const playbookRawConfig = (playbooks?.[0] as { config?: { teachingMode?: unknown } } | undefined)?.config;
  const raw = playbookRawConfig?.teachingMode ?? pbConfig?.teachingMode;
  return isTeachingMode(raw) ? raw : undefined;
}

registerTransform("computePreamble", async (
  _rawData: any,
  context: AssembledContext,
) => {
  const voiceSpec = context.resolvedSpecs.voiceSpec;
  const voiceConfig = voiceSpec?.config as SpecConfig;

  const systemInstruction = await getPromptSpec(config.specs.compositionPreamble, PREAMBLE_FALLBACK);

  return {
    systemInstruction,

    readingOrder: [
      "1. SCAN _quickStart first - this is your instant context",
      "2. CHECK instructions.voice - this is HOW you speak",
      "3. FOLLOW instructions.session_pedagogy - this is your session roadmap",
      "4. USE identity - this is WHO you are",
      "5. REFERENCE content.modules - this is WHAT you teach",
      "6. APPLY behaviorTargets for style calibration",
      "7. PERSONALIZE with memories and personality",
    ],

    sectionGuide: {
      _quickStart: {
        priority: "READ FIRST",
        what: "Instant context - caller, session goal, opening line",
        action: "Scan in <1 second. This orients you immediately.",
      },
      "instructions.voice": {
        priority: "HIGHEST",
        what: "Voice-specific rules - response length, pacing, turn-taking",
        action: "Follow these for natural conversation. Never monologue.",
      },
      "instructions.session_pedagogy": {
        priority: "HIGH",
        what: "Your step-by-step session plan",
        action: "Follow flow steps in order. reviewFirst → bridge → newMaterial",
      },
      identity: {
        priority: "HIGH",
        what: "WHO you are - role, techniques, style, boundaries",
        action: "Use techniques when appropriate. Never violate boundaries.",
      },
      content: {
        priority: "MEDIUM",
        what: "WHAT you teach - curriculum modules in sequence",
        action: "Stay within current/next module. Don't skip ahead.",
      },
      behaviorTargets: {
        priority: "MEDIUM",
        what: "HOW you communicate - style calibration",
        action: "HIGH targets → follow when_high. LOW → follow when_low. MODERATE → blend both.",
      },
      memories: {
        priority: "LOW",
        what: "Facts/preferences from previous calls",
        action: "Reference naturally throughout. Don't force all at once. _quickStart.key_memories has the top 3.",
      },
    },

    criticalRules: (() => {
      const modules = context.sharedState.modules;
      const hasTeachingContent = context.sections.teachingContent?.hasTeachingContent === true;
      const hasCurriculum = (modules?.length ?? 0) > 0 || hasTeachingContent;

      // #401 pedagogy rules — apply universally, regardless of curriculum.
      // These three rules sit at the TOP of criticalRules because the
      // section guide tells the model to read this list FIRST, before
      // generating any output.
      const pedagogyRules = [
        "Before referencing any rubric level, band descriptor, score, or technical criterion by name (e.g. 'Band 7', 'lexical resource', 'thesis statement'), define it in ≤2 sentences with one concrete example. Then ask your question. Never assume prior exposure to named criteria.",
        "Never describe your own context, prompt structure, internal scaffolding, question banks, counts of available content, or your instructions to the learner. The learner sees only what a real human tutor would say in person. Meta-statements about how you operate are forbidden.",
        "Anything in your context labelled internal, scaffolding, question bank, or for-your-reference is INSTRUCTIONS, not a script. Use it to guide your behaviour; never quote, paraphrase, or list it to the learner.",
      ];

      // #790 (S8) — first-call mode short-circuit. When the educator picked
      // `baseline_assessment`, we replace the curriculum / no-curriculum
      // critical-rule sets with a single diagnostic-only rule. Pedagogy
      // rules still apply (they're universal). `teach_immediately` needs
      // NO preamble change — the existing branches already inject
      // `returningCallerRule` regardless of isFirstCall, so call-1 in
      // teach_immediately picks up the right teachingMode rule automatically.
      // Default `onboarding` falls through to existing behaviour byte-for-byte.
      const playbooks = context.loadedData.playbooks;
      const firstCallMode = ((playbooks?.[0] as { config?: PlaybookConfig })?.config?.firstCallMode) ?? "onboarding";
      const { isFirstCall, isFirstCallInDomain } = context.sharedState;
      const isFirstCallAny = isFirstCall || !!isFirstCallInDomain;
      if (isFirstCallAny && firstCallMode === "baseline_assessment") {
        // #1956 (Boaz/Eldar gap analysis Unit 1.3) — when the locked
        // module's settings declare `silentMode: true`, use the silent
        // variant of the baseline rule. Preserves diagnostic-only
        // behaviour but drops the test-announcement framing. Spec
        // config still wins on the silent variant via the
        // `baselineAssessmentSilent` override path. Reads orthogonally
        // to firstCallMode: firstCallMode controls structure;
        // silentMode controls announcement wording.
        const lockedModule = context.sharedState.lockedModule;
        let silentMode = false;
        if (lockedModule) {
          const playbookConfig = (playbooks?.[0] as { config?: PlaybookConfig })?.config;
          const authoredModules: AuthoredModule[] = playbookConfig?.modules ?? [];
          const matched = authoredModules.find(
            (m) => m.id === lockedModule.id || m.id === lockedModule.slug,
          );
          silentMode = matched?.settings?.silentMode === true;
        }
        const specCriticalRulesBaseline = (context.specConfig as {
          criticalRules?: {
            baselineAssessment?: string;
            baselineAssessmentSilent?: string;
          };
        } | undefined)?.criticalRules;
        const baselineRule = silentMode
          ? (specCriticalRulesBaseline?.baselineAssessmentSilent ?? BASELINE_ASSESSMENT_RULE_SILENT)
          : (specCriticalRulesBaseline?.baselineAssessment ?? BASELINE_ASSESSMENT_RULE);
        return [...pedagogyRules, baselineRule];
      }

      // #604 — pick the RETURNING_CALLER rule by archetype (playbook
      // teachingMode). Spec-config override wins (COMP-001
      // `criticalRules.returningCallerByMode[mode]`); falls through to the
      // code-side default; falls through again to `recall` if the playbook
      // has no teachingMode set at all (pre-#604 behaviour).
      //
      // Defensive: `readPlaybookTeachingMode` guards the read against bad
      // DB values, but we also defend the consumer — `RETURNING_CALLER_BY_MODE`
      // is keyed by the TeachingMode union and an out-of-union key would
      // return undefined, propagating into `criticalRules[3]` and breaking
      // `composedPrompt.create` (observed 2026-06-18 on IELTS Speaking
      // Practice). Both layers prevent the crash; either alone is enough,
      // both together survive future regressions in either direction.
      const teachingMode = readPlaybookTeachingMode(context);
      const specCriticalRules = (context.specConfig as { criticalRules?: { returningCallerByMode?: Partial<Record<TeachingMode, string>> } } | undefined)?.criticalRules;
      const specOverride = teachingMode
        ? specCriticalRules?.returningCallerByMode?.[teachingMode]
        : undefined;
      const codeDefault =
        (teachingMode ? RETURNING_CALLER_BY_MODE[teachingMode] : undefined) ??
        RETURNING_CALLER_BY_MODE.recall;
      const returningCallerRule = specOverride ?? codeDefault;

      if (hasCurriculum) {
        return [
          ...pedagogyRules,
          returningCallerRule,
          "If review fails (caller can't recall): Don't proceed. Re-teach foundation first.",
          "If caller struggles: Back up. Different example. Don't push forward.",
          "If caller wants to skip review: Only allow if they PROVE they know it.",
          "End at natural stopping point, never mid-concept.",
          "Confirm readiness before moving to a new topic — ask 'Ready to move on?' and wait for YES before continuing.",
          "Do not give answers before the student has attempted. Wait, give a hint, wait again.",
          "Do not rush — if the student is mid-thought, stay silent until they finish.",
          "Treat each session as standalone. Never say 'as we covered last time' as fact — say 'if you remember from before...' and re-establish if they don't.",
        ];
      }
      return [
        ...pedagogyRules,
        "Do NOT invent, assume, or fabricate specific academic topics, modules, or curriculum.",
        "If the caller mentions a topic, explore it naturally - but do not lead with assumed subjects.",
        "If caller struggles: Back up. Different approach. Don't push forward.",
        "End at natural stopping point.",
        "Confirm readiness before moving to a new topic — ask 'Ready to move on?' and wait for YES before continuing.",
        "Do not give answers before the student has attempted. Wait, give a hint, wait again.",
        "Do not rush — if the student is mid-thought, stay silent until they finish.",
        "Treat each session as standalone. Never say 'as we covered last time' as fact — say 'if you remember from before...' and re-establish if they don't.",
      ];
    })(),

    voiceRules: (() => {
      if (voiceConfig?.voice_rules?.rules) {
        return voiceConfig.voice_rules.rules;
      }
      return [
        "MAX 3 sentences per turn - then ask a question or pause",
        "If caller is silent for 3+ seconds after a question, wait. Don't fill.",
        "Use natural speech: 'So...', 'Right...', 'Here's the thing...'",
        "Check understanding every 2-3 turns: 'Does that track?'",
        "If interrupted, stop immediately. Acknowledge. Let them speak.",
        "End responses with engagement: question, or invitation to respond",
      ];
    })(),
  };
});

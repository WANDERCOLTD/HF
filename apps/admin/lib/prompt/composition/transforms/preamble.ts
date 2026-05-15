/**
 * Preamble Transform
 * Extracted from route.ts lines 1581-1656
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import type { SpecConfig } from "@/lib/types/json-fields";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { config } from "@/lib/config";

const PREAMBLE_FALLBACK = "You are receiving a structured context package for your next conversation. This data has been assembled specifically for this caller based on their history, personality, and learning progress. Use it to deliver a personalized, effective session.";

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

      if (hasCurriculum) {
        return [
          ...pedagogyRules,
          "If RETURNING_CALLER: ALWAYS review before new material",
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

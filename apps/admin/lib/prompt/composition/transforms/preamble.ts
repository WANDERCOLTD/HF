/**
 * Preamble Transform
 * Extracted from route.ts lines 1581-1656
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import type { SpecConfig } from "@/lib/types/json-fields";

registerTransform("computePreamble", (
  _rawData: any,
  context: AssembledContext,
) => {
  const voiceSpec = context.resolvedSpecs.voiceSpec;
  const voiceConfig = voiceSpec?.config as SpecConfig;

  return {
    systemInstruction: "You are receiving a structured context package for your next conversation. This data has been assembled specifically for this caller based on their history, personality, and learning progress. Use it to deliver a personalized, effective session.",

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

      if (hasCurriculum) {
        return [
          "If RETURNING_CALLER: ALWAYS review before new material",
          "If review fails (caller can't recall): Don't proceed. Re-teach foundation first.",
          "If caller struggles: Back up. Different example. Don't push forward.",
          "If caller wants to skip review: Only allow if they PROVE they know it.",
          "End at natural stopping point, never mid-concept.",
        ];
      }
      return [
        "Do NOT invent, assume, or fabricate specific academic topics, modules, or curriculum.",
        "If the caller mentions a topic, explore it naturally - but do not lead with assumed subjects.",
        "If caller struggles: Back up. Different approach. Don't push forward.",
        "End at natural stopping point.",
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

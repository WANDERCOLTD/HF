/**
 * Voice Guidance Transform
 * Extracted from route.ts lines 2233-2333
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import type { SpecConfig } from "@/lib/types/json-fields";

/**
 * Compute voice-specific guidance for voice AI.
 * Uses voiceSpec config when available, falls back to defaults.
 */
registerTransform("computeVoiceGuidance", (
  _rawData: any,
  context: AssembledContext,
) => {
  const voiceSpec = context.resolvedSpecs.voiceSpec;
  const personality = context.loadedData.personality;
  const { thresholds } = context.sharedState;

  const voiceConfig = voiceSpec?.config as SpecConfig;

  const responseLengthConfig = voiceConfig?.response_length || null;
  const pacingConfig = voiceConfig?.pacing || null;
  const naturalSpeechConfig = voiceConfig?.natural_speech || null;
  const interruptionsConfig = voiceConfig?.interruptions || null;
  const turnTakingConfig = voiceConfig?.turn_taking || null;
  const voiceAdaptationConfig = voiceConfig?.voice_adaptation || null;

  // Compute personality-based pace adaptation
  const computePaceMatch = () => {
    const extraversion = personality?.extraversion;
    if (pacingConfig?.paceAdaptation) {
      if (extraversion !== null && extraversion !== undefined && extraversion <= thresholds.low) {
        return pacingConfig.paceAdaptation.introvert || "Slower pace - give them space";
      }
      if (extraversion !== null && extraversion !== undefined && extraversion >= thresholds.high) {
        return pacingConfig.paceAdaptation.extrovert || "Match their energy - quicker exchanges OK";
      }
      return pacingConfig.paceAdaptation.default || "Moderate pace - read their cues";
    }
    if (extraversion !== null && extraversion !== undefined) {
      if (extraversion <= thresholds.low) return "Slower pace - give them space";
      if (extraversion >= thresholds.high) return "Match their energy - quicker exchanges OK";
    }
    return "Moderate pace - read their cues";
  };

  // Compute personality-based voice adaptations
  const computeVoiceAdaptation = () => {
    const adaptations: string[] = [];
    const adaptConfig = voiceAdaptationConfig?.adaptations;
    const extraversion = personality?.extraversion;
    const neuroticism = personality?.neuroticism;
    const openness = personality?.openness;
    const agreeableness = personality?.agreeableness;

    if (extraversion !== null && extraversion !== undefined && extraversion <= thresholds.low) {
      const cfg = adaptConfig?.lowExtraversion;
      adaptations.push(cfg ? `${cfg.label}: ${cfg.guidance}` : "INTROVERT: Shorter turns, more pauses, don't fill silence");
    }
    if (neuroticism !== null && neuroticism !== undefined && neuroticism >= thresholds.high) {
      const cfg = adaptConfig?.highNeuroticism;
      adaptations.push(cfg ? `${cfg.label}: ${cfg.guidance}` : "ANXIOUS: Extra warmth, slower pace, more reassurance");
    }
    if (openness !== null && openness !== undefined && openness >= thresholds.high) {
      const cfg = adaptConfig?.highOpenness;
      adaptations.push(cfg ? `${cfg.label}: ${cfg.guidance}` : "CURIOUS: Can explore tangents briefly, enjoy intellectual play");
    }
    if (agreeableness !== null && agreeableness !== undefined && agreeableness <= thresholds.low) {
      const cfg = adaptConfig?.lowAgreeableness;
      adaptations.push(cfg ? `${cfg.label}: ${cfg.guidance}` : "DIRECT: Skip pleasantries, get to the point, they'll push back - that's OK");
    }

    return adaptations.length > 0 ? adaptations : ["No special voice adaptations needed"];
  };

  return {
    _source: voiceSpec ? voiceSpec.name : "hardcoded defaults",

    response_length: {
      target: responseLengthConfig?.target || "2-3 sentences per turn",
      max_seconds: responseLengthConfig?.maxSeconds || 15,
      rule: responseLengthConfig?.rule || "If you're about to say more than 3 sentences, STOP and ask a question instead",
    },

    pacing: {
      pauses_after_questions: pacingConfig?.pausesAfterQuestions || "2-3 seconds - let them think",
      rushing: pacingConfig?.silenceRule || "Never fill silence. Silence is thinking time.",
      pace_match: computePaceMatch(),
    },

    natural_speech: {
      use_fillers: naturalSpeechConfig?.fillers || ["So...", "Now...", "Right, so...", "Here's the thing..."],
      use_backchannels: naturalSpeechConfig?.backchannels || ["Mm-hmm", "I see", "Right", "Got it"],
      transitions: naturalSpeechConfig?.transitions || ["Okay, let's...", "So here's where it gets interesting...", "Now, thinking about..."],
      confirmations: naturalSpeechConfig?.confirmations || ["Does that make sense?", "What do you think?", "Does that track?"],
    },

    interruptions: {
      allow: interruptionsConfig?.allow ?? true,
      recovery: interruptionsConfig?.recovery || "If interrupted mid-sentence, acknowledge ('Sure, go ahead') and let them speak. Don't restart your point - pick up where relevant.",
    },

    turn_taking: {
      check_understanding: turnTakingConfig?.checkUnderstanding || "Every 2-3 exchanges, check in: 'Make sense so far?' or 'What's your take?'",
      avoid_monologues: turnTakingConfig?.avoidMonologues || "If you've been talking for 10+ seconds without a question, you're lecturing. Stop and engage.",
      invitation_phrases: turnTakingConfig?.invitationPhrases || ["What do you think about that?", "How does that land for you?", "Any questions so far?"],
    },

    voice_rules: "_preamble.voiceRules",
    voice_adaptation: computeVoiceAdaptation(),
  };
});

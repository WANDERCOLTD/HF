/**
 * Hover/help copy for acronyms that appear in caller / goal UI.
 *
 * Consumers: `components/shared/Acronym.tsx` looks up by key, falls back
 * to the literal string if no definition exists. Add new entries here so
 * the lookup stays centralised (educator-facing copy in one place).
 */

export interface AcronymDefinition {
  /** What it stands for, expanded. */
  full: string;
  /** One-line educator-facing explanation. */
  description: string;
}

/**
 * IELTS Speaking criteria + ref shapes. Keys are case-sensitive; the
 * Acronym component normalises with `.toUpperCase()` before lookup.
 */
export const ACRONYM_GLOSSARY: Record<string, AcronymDefinition> = {
  // IELTS Speaking criteria (rubric short-codes)
  FC: {
    full: "Fluency & Coherence",
    description:
      "Talking with normal flow, linking ideas without long pauses or excessive self-correction. Discourse markers used appropriately.",
  },
  LR: {
    full: "Lexical Resource",
    description:
      "Range and precision of vocabulary, including less-common and idiomatic items. Effective paraphrase when an exact word is out of reach.",
  },
  GRA: {
    full: "Grammatical Range & Accuracy",
    description:
      "Range of grammatical structures used flexibly. Sentences are mostly error-free; complex structures attempted with control.",
  },
  P: {
    full: "Pronunciation",
    description:
      "Ease of being understood. Stress, rhythm, intonation, and connected-speech features used appropriately. L1 accent is fine; intelligibility is the criterion.",
  },
  // Ref shapes
  "OUT-NN": {
    full: "Outcome ref",
    description:
      "Stable identifier for a learning outcome from a Course Reference document (e.g. OUT-01). Per-outcome mastery accumulates on CallerModuleProgress.loScoresJson.",
  },
  "SKILL-NN": {
    full: "Skill ref",
    description:
      "Stable identifier for a skill criterion from a Skills Framework section (e.g. SKILL-01 = Fluency & Coherence in IELTS Speaking). Drives per-skill running scores via CallerTarget.currentScore.",
  },
  // Banding tiers (IELTS-shaped defaults)
  "Approaching Emerging": {
    full: "Approaching Emerging tier",
    description:
      "Below the Emerging threshold. Evidence so far suggests the learner has not yet demonstrated the criterion consistently. Default mapping: IELTS Band 3.",
  },
  Emerging: {
    full: "Emerging tier",
    description:
      "Learner shows beginnings of the criterion but not yet sustained. Default mapping: IELTS Band 4.",
  },
  Developing: {
    full: "Developing tier",
    description:
      "Learner demonstrates the criterion with mixed control. Default mapping: IELTS Band 5–6.",
  },
  Secure: {
    full: "Secure tier",
    description:
      "Learner demonstrates the criterion consistently. Default mapping: IELTS Band 7+.",
  },
};

/**
 * Resolve a key (literal match) to its definition. Used by the Acronym
 * component; consumers can also call this directly for tooltip body
 * generation elsewhere.
 */
export function lookupAcronym(key: string): AcronymDefinition | undefined {
  if (!key) return undefined;
  if (ACRONYM_GLOSSARY[key]) return ACRONYM_GLOSSARY[key];
  // Try the OUT-NN / SKILL-NN pattern match
  if (/^OUT-\d+$/i.test(key)) return ACRONYM_GLOSSARY["OUT-NN"];
  if (/^SKILL-\d+$/i.test(key)) return ACRONYM_GLOSSARY["SKILL-NN"];
  return undefined;
}

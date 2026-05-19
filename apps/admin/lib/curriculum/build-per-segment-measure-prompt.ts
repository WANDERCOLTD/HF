/**
 * Per-Segment MEASURE Prompt Builder (#550 follow-up).
 *
 * The generic `buildBatchedCallerPrompt` dumps 21 parameters with no
 * grounding — when the per-segment AI call sees a short Part 1 turn
 * with a generic prompt, it scatters attention and returns near-empty
 * responses. This builder is the focused alternative for IELTS Mock
 * Exam segments:
 *
 *   - Restricts scoring to the 4 IELTS Speaking skills only
 *     (fluency, lexical, grammatical, pronunciation). Behaviour
 *     params (B5-*, CONV_*, COMP_*) don't need per-part attribution.
 *   - Embeds the official IELTS band rubric (Emerging / Developing /
 *     Secure → Band 4-5 / 5.5-6.5 / 7+) so the AI scores against
 *     concrete anchors instead of a free-floating 0-1 scale.
 *   - Adds per-part context so the AI knows what each part tests
 *     (Part 1 = short turns on familiar topics, Part 2 = 2-minute
 *     monologue, Part 3 = abstract discussion).
 *   - Asks the AI to return integer bands (4-9) which we map to 0-1
 *     in code — the AI reasons better in IELTS-native units.
 *
 * Returns `null` when no IELTS skill params are present in the input
 * (i.e. this isn't an IELTS course) — caller falls back to the
 * generic per-segment scoring.
 */

export interface IeltsPerSegmentPromptInput {
  segmentText: string;
  /** The full set of MEASURE params from the bound call's specs. */
  measureParams: Array<{ parameterId: string; name: string; definition: string | null }>;
  /** Sub-module slug, e.g. "part1". */
  partSlug: string;
  /** Optional override for transcript truncation. */
  transcriptLimit?: number;
}

export interface IeltsPerSegmentPromptOutput {
  /** Final user-message text ready to send to the AI. */
  prompt: string;
  /** The IELTS skill params actually included — used by the caller for whitelist validation. */
  scopedParams: Array<{ parameterId: string; name: string }>;
}

const IELTS_SKILL_PREFIX = "skill_";
const IELTS_EMA_AGGREGATE = "skill_ema_aggregate"; // exclude — meta-param, not a per-segment band

/** Per-part scoring context the AI uses to weight evidence appropriately. */
const PART_CONTEXT: Record<string, string> = {
  part1:
    "Part 1 is short Q&A on familiar everyday topics. The learner should give 2-3 sentence answers with a reason and example. Pronunciation barely shows in short turns — be conservative with that score. Lexical Resource and Grammatical Range are best assessed here.",
  part2:
    "Part 2 is a 2-minute long-turn monologue with a cue card and 1 minute of prep. Score Fluency & Coherence based on whether the learner sustains the turn without breakdown. Look for connectives, signposting, and whether they address all bullets with progression.",
  part3:
    "Part 3 is abstract discussion — follow-up questions on broader themes connected to Part 2. Score how the learner handles unfamiliar topics, uses extension techniques (reasons / contrast / examples / hedging), and produces complex grammatical structures (conditionals, relative clauses, passives).",
};

/**
 * The official IELTS Speaking band descriptors at Band 5, 6, 7, 8 for
 * each criterion. Calibrated to the public IELTS rubric. Embedded
 * here as plain text so we don't depend on DB-loaded descriptors
 * being present — and because the fixture rubric is only at
 * tier-level (Emerging / Developing / Secure), not per-band integer.
 */
const IELTS_RUBRIC = `
Score on the IELTS Band scale 4-9. Anchor descriptors:

Fluency & Coherence
  Band 5: Hesitates often, repeats and self-corrects. Uses simple linkers (and, but, because).
  Band 6: Willing to speak at length though may lose coherence at times. Uses a range of linkers but not always flexibly.
  Band 7: Speaks at length without noticeable effort or loss of coherence. Uses a range of cohesive devices flexibly.
  Band 8: Fluent with only rare repetition or self-correction. Hesitation is content-related, not language-related.

Lexical Resource
  Band 5: Limited flexibility, mostly familiar/concrete vocabulary. Frequent paraphrase.
  Band 6: Wide enough vocabulary to discuss topics at length with appropriate paraphrase. Some less common items, some inappropriacy.
  Band 7: Uses vocabulary flexibly to discuss a variety of topics. Some idiomatic and less common items, with some inaccuracy in style.
  Band 8: Wide vocabulary used readily and flexibly. Skilful use of less common and idiomatic items.

Grammatical Range & Accuracy
  Band 5: Basic sentence patterns dominate. Frequent errors that may impede meaning.
  Band 6: Mix of simple and complex structures, with limited flexibility. Errors persist in complex structures, but rarely impede communication.
  Band 7: Range of complex structures with some flexibility. Frequent error-free sentences, though errors still occur.
  Band 8: Wide range of structures used flexibly. Most sentences are error-free; only occasional inappropriacies and basic/non-systematic errors.

Pronunciation
  Band 5: Shows some effective use of features but with limited control. Mispronunciations are frequent.
  Band 6: Uses a range of pronunciation features with mixed control. Generally understood throughout, though individual words/sounds reduce clarity.
  Band 7: Shows all positive features of Band 6 and some of Band 8. Easy to understand throughout; L1 accent has minimal effect.
  Band 8: Wide range of pronunciation features used to convey meaning. Sustains flexible pronunciation features with only occasional lapses.
`.trim();

/**
 * Build the focused per-segment MEASURE prompt. Returns null when the
 * caller's measureParams don't include any IELTS skill params (i.e.
 * this isn't an IELTS-shaped course) — the caller then falls back to
 * the generic `buildBatchedCallerPrompt` path.
 */
export function buildPerSegmentMeasurePrompt(
  input: IeltsPerSegmentPromptInput,
): IeltsPerSegmentPromptOutput | null {
  const { segmentText, measureParams, partSlug, transcriptLimit = 4000 } = input;

  // Scope to IELTS skill params only. Excludes the meta-aggregate
  // (`skill_ema_aggregate`) which is not a per-segment scoreable
  // skill — it's the rollup target.
  const scopedParams = measureParams
    .filter(
      (p) =>
        p.parameterId.startsWith(IELTS_SKILL_PREFIX) &&
        p.parameterId !== IELTS_EMA_AGGREGATE,
    )
    .map((p) => ({ parameterId: p.parameterId, name: p.name }));

  if (scopedParams.length === 0) return null;

  const partContext =
    PART_CONTEXT[partSlug] ??
    `Score the IELTS criteria based on the evidence in this segment only.`;

  const paramList = scopedParams.map((p) => `- ${p.parameterId} — ${p.name}`).join("\n");

  const prompt = `You are an IELTS Speaking examiner scoring a single part of a Mock Exam.

PART CONTEXT (${partSlug}):
${partContext}

${IELTS_RUBRIC}

PARAMETERS TO SCORE (use these exact parameterId strings as JSON keys):
${paramList}

TRANSCRIPT SEGMENT (this is the part you are scoring — score ONLY based on what's in this segment, not the whole Mock):
${segmentText.slice(0, transcriptLimit)}

OUTPUT RULES:
- Return STRICT JSON with no commentary, no markdown fences.
- "band" is an integer 4-9 on the IELTS scale (use 4 for very weak, 9 for native-like).
- "c" is confidence 0-1 reflecting how much evidence this segment gives you.
- If a criterion CANNOT be reliably scored from this segment (e.g. Pronunciation from a 30-second Part 1 exchange), set "band":5 and "c":0.2 — do not omit the entry.

RETURN SHAPE (exactly):
{"scores":{"<parameterId>":{"band":<4-9>,"c":<0-1>,"r":"<one-sentence reason>"}}}`;

  return { prompt, scopedParams };
}

/**
 * Convert an IELTS band integer (4-9) into the 0-1 scale used by
 * `CallScore.score`. The mapping uses band 9 → 1.0 and band 4 → ~0.44,
 * matching the standard IELTS-to-percentile rough conversion.
 */
export function bandToScore(band: number): number {
  if (!Number.isFinite(band)) return 0.5;
  return Math.max(0, Math.min(1, band / 9));
}

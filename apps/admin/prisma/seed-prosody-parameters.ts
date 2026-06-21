/**
 * Prosody Parameter Seed — separate slots for vendor-derived voice signals.
 *
 * Why this exists (2026-06-15 audit follow-on):
 *
 *   Pre-this-seed, `lib/pipeline/prosody-consumer.ts` general-mode wrote to
 *   `CONV_PACE` and `pace_indicators` — parameter IDs ALSO written by EXTRACT
 *   from the AI-judged transcript analysis. With `writeCallScore` being
 *   idempotent on `(callId, parameterId, moduleId)`, the AGGREGATE-stage
 *   prosody consumer ran AFTER EXTRACT and overwrote its AI-judged scores
 *   with the prosody-derived (today: hardcoded zero) values. Last writer
 *   wins → AI's qualitative pace judgment silently destroyed.
 *
 *   Splitting the parameter ID gives each writer its own slot:
 *     - `CONV_PACE` stays — AI-judged conversational pace from transcript
 *       (EXTRACT writer, scoredBy: claude_batched_v2)
 *     - `prosody_pace_wpm` — vendor-measured words-per-minute, normalised
 *       60–200 → 0–1 (PROSODY consumer, scoredBy: prosody_v1)
 *     - `pace_indicators` stays — AI-judged hesitation/filler markers from
 *       transcript (EXTRACT writer)
 *     - `prosody_hesitation_rate` — vendor-measured hesitation rate,
 *       inverted to score (PROSODY consumer)
 *
 *   They measure different things — qualitative judgment vs quantitative
 *   signal. Both surfaces stay alive; neither overwrites the other.
 *
 * #2138 (epic #2135 S3) — same shape applied to the IELTS mode:
 *
 *   Pre-#2138, `lib/pipeline/prosody-consumer.ts` IELTS-mode wrote to the 4
 *   IELTS skill parameter IDs (`skill_fluency_and_coherence_fc`,
 *   `skill_pronunciation_p`, `skill_lexical_resource_lr`,
 *   `skill_grammatical_range_and_accuracy_gra`). #2155 (epic #2135 S2)
 *   introduced the canonical IELTS-MEASURE-001 LLM spec as the rightful
 *   writer of those 4 IDs — the prosody vendor cannot reliably score LR or
 *   GRA (those require LLM judgment of transcript content; the vendor only
 *   sees audio features). The S2 path was flag-gated to avoid a dual-writer
 *   race during transition.
 *
 *   S3 closes the transition: prosody-consumer now writes to its own
 *   `prosody_raw_*` slots instead. The LLM spec is the sole writer to the
 *   IELTS skill IDs; the prosody vendor's raw audio-feature signal lives in
 *   `prosody_raw_*` rows that the IELTS-MEASURE-001 spec MAY optionally
 *   consume via tool-use (post-MVP) to augment FC + P confidence. LR + GRA
 *   stay LLM-only forever — but the prosody-raw rows still land so the
 *   vendor signal isn't silently dropped.
 *
 *     - `prosody_raw_fc` — vendor-measured Fluency & Coherence band signal
 *       (band 0–9 normalised to 0–1), confidence 0.9 — audio fluency
 *       features are reasonably observable from vendor signal
 *     - `prosody_raw_p`  — vendor-measured Pronunciation band signal,
 *       confidence 0.9 — phoneme accuracy is the vendor's strong suit
 *     - `prosody_raw_lr` — vendor-measured Lexical Resource band signal,
 *       confidence 0.7 — vendor cannot reliably score vocabulary from
 *       audio features; this is an audio-feature approximation
 *     - `prosody_raw_gra`— vendor-measured Grammatical Range & Accuracy
 *       band signal, confidence 0.7 — same caveat as LR; included for
 *       completeness but the LLM is the authority
 *
 * Note on values today: the vendor adapter at
 * `lib/pipeline/prosody-runner.ts:367-373` hardcodes `paceWpm: 0` and
 * `hesitationRate: 0` because the SpeechAce / SpeechSuper response shape
 * for general-mode signals isn't yet plumbed through. So `prosody_pace_wpm`
 * and `prosody_hesitation_rate` will receive 0-scored CallScore rows until
 * the adapter extension lands (see follow-on story for vendor extraction).
 * The split is still correct: the zeros are now isolated to their own
 * parameter slot, not polluting the AI-judged `CONV_PACE` value.
 *
 * On `domainGroup`: per `lib/registry/canonical-domain-group.ts`, the
 * canonical 12-tuple includes `voice-delivery` — the closest match for
 * vendor-derived voice signals. The 4 new IELTS prosody-raw rows use the
 * same group as the existing `prosody_pace_wpm` / `prosody_hesitation_rate`
 * (`voice`). Pre-existing `voice` value is non-canonical (legacy debt) —
 * we mirror it here for consistency rather than introducing a fresh
 * divergence. The DB-parity ratchet (#2040 S7) tracks this.
 *
 * Idempotent — uses `findUnique → update | create`. Re-running is a no-op
 * when the rows already exist with the same shape.
 *
 * @see prisma/seed-tolerance-parameters.ts — template for this shape
 * @see lib/pipeline/prosody-consumer.ts::GENERAL_PARAM_IDS — the constants
 *      that route the general-mode writes
 * @see lib/pipeline/prosody-consumer.ts::PROSODY_RAW_PARAM_IDS — the
 *      constants that route the IELTS-mode prosody-raw writes (#2138)
 * @see docs/decisions/2026-06-15-agent-report-verification.md — context
 *      for the audit that surfaced the overwrite
 */

import { PrismaClient } from "@prisma/client";

interface ProsodyParameterSeed {
  parameterId: string;
  name: string;
  definition: string;
  sectionId: string;
  domainGroup: string;
  scaleType: string;
  directionality: string;
  computedBy: string;
}

const PROSODY_PARAMETERS: ProsodyParameterSeed[] = [
  {
    parameterId: "prosody_pace_wpm",
    name: "Prosody — Pace (Words Per Minute)",
    definition:
      "Vendor-measured speaking rate, normalised 60–200 WPM → 0–1. " +
      "Written by lib/pipeline/prosody-consumer.ts during the AGGREGATE " +
      "stage when the prosody envelope mode is 'general' (non-IELTS " +
      "courses with a connected SpeechAssessmentProvider). Distinct from " +
      "CONV_PACE (which is the AI-judged conversational-pace score from " +
      "EXTRACT's transcript analysis). Observational signal — no " +
      "BehaviorTarget; tracked by CallerTarget.currentScore EMA for " +
      "trend visibility.",
    sectionId: "prosody",
    domainGroup: "voice",
    scaleType: "0-1",
    directionality: "positive",
    computedBy: "prosody-vendor",
  },
  {
    parameterId: "prosody_hesitation_rate",
    name: "Prosody — Hesitation Rate",
    definition:
      "Vendor-measured hesitation / disfluency rate, inverted (lower " +
      "hesitation → higher score). Written by lib/pipeline/prosody-" +
      "consumer.ts during AGGREGATE when the prosody envelope mode is " +
      "'general'. Distinct from pace_indicators (which is the AI-judged " +
      "hesitation marker count from EXTRACT). Observational signal.",
    sectionId: "prosody",
    domainGroup: "voice",
    scaleType: "0-1",
    directionality: "positive",
    computedBy: "prosody-vendor",
  },
  // #2138 (epic #2135 S3) — IELTS-mode prosody-raw slots. Separate from
  // the 4 IELTS skill parameter IDs (`skill_fluency_and_coherence_fc`,
  // `skill_pronunciation_p`, `skill_lexical_resource_lr`,
  // `skill_grammatical_range_and_accuracy_gra`) which are owned by the
  // IELTS-MEASURE-001 LLM spec via the canonical SCORE_AGENT path (#2155).
  // These prosody-raw rows carry the vendor's audio-feature signal so
  // (a) it isn't silently dropped, and (b) the IELTS-MEASURE-001 spec MAY
  // optionally consume them via tool-use (post-MVP) to augment FC + P
  // confidence. LR + GRA confidence stays 0.7 — vendor cannot reliably
  // score vocab/grammar from audio features alone.
  {
    parameterId: "prosody_raw_fc",
    name: "Prosody — Fluency & Coherence raw signal",
    definition:
      "Vendor-measured Fluency & Coherence band signal (band 0–9 " +
      "normalised to 0–1). Written by lib/pipeline/prosody-consumer.ts " +
      "during AGGREGATE when the prosody envelope mode is 'ielts'. " +
      "Distinct from skill_fluency_and_coherence_fc (which is the " +
      "LLM-judged transcript score from IELTS-MEASURE-001 via " +
      "SCORE_AGENT). Audio fluency features are reasonably observable " +
      "from vendor signal, so confidence is 0.9. Optionally consumed by " +
      "IELTS-MEASURE-001 via tool-use (post-MVP) to augment LLM judgment.",
    sectionId: "prosody",
    domainGroup: "voice",
    scaleType: "0-1",
    directionality: "positive",
    computedBy: "prosody-vendor",
  },
  {
    parameterId: "prosody_raw_p",
    name: "Prosody — Pronunciation raw signal",
    definition:
      "Vendor-measured Pronunciation band signal (band 0–9 normalised " +
      "to 0–1). Written by lib/pipeline/prosody-consumer.ts during " +
      "AGGREGATE when the prosody envelope mode is 'ielts'. Distinct " +
      "from skill_pronunciation_p (which is the LLM-judged transcript " +
      "score from IELTS-MEASURE-001). Phoneme accuracy is the vendor's " +
      "strongest signal — confidence 0.9. Optionally consumed by " +
      "IELTS-MEASURE-001 via tool-use (post-MVP) to augment LLM judgment.",
    sectionId: "prosody",
    domainGroup: "voice",
    scaleType: "0-1",
    directionality: "positive",
    computedBy: "prosody-vendor",
  },
  {
    parameterId: "prosody_raw_lr",
    name: "Prosody — Lexical Resource raw signal",
    definition:
      "Vendor-measured Lexical Resource band signal (band 0–9 normalised " +
      "to 0–1). Written by lib/pipeline/prosody-consumer.ts during " +
      "AGGREGATE when the prosody envelope mode is 'ielts'. Distinct " +
      "from skill_lexical_resource_lr (which is the LLM-judged " +
      "transcript score from IELTS-MEASURE-001 — the authoritative LR " +
      "score). The vendor cannot reliably score vocabulary from audio " +
      "features alone; this row is an audio-feature approximation only, " +
      "confidence 0.7. NOT consumed by IELTS-MEASURE-001 — kept for " +
      "completeness + forensics.",
    sectionId: "prosody",
    domainGroup: "voice",
    scaleType: "0-1",
    directionality: "positive",
    computedBy: "prosody-vendor",
  },
  {
    parameterId: "prosody_raw_gra",
    name: "Prosody — Grammatical Range & Accuracy raw signal",
    definition:
      "Vendor-measured Grammatical Range & Accuracy band signal (band " +
      "0–9 normalised to 0–1). Written by lib/pipeline/prosody-" +
      "consumer.ts during AGGREGATE when the prosody envelope mode is " +
      "'ielts'. Distinct from skill_grammatical_range_and_accuracy_gra " +
      "(which is the LLM-judged transcript score from IELTS-MEASURE-001 " +
      "— the authoritative GRA score). The vendor cannot reliably score " +
      "grammar from audio features alone; this row is an audio-feature " +
      "approximation only, confidence 0.7. NOT consumed by " +
      "IELTS-MEASURE-001 — kept for completeness + forensics.",
    sectionId: "prosody",
    domainGroup: "voice",
    scaleType: "0-1",
    directionality: "positive",
    computedBy: "prosody-vendor",
  },
];

export async function seedProsodyParameters(prisma: PrismaClient): Promise<{
  created: number;
  updated: number;
}> {
  let created = 0;
  let updated = 0;

  for (const param of PROSODY_PARAMETERS) {
    const existing = await prisma.parameter.findUnique({
      where: { parameterId: param.parameterId },
    });

    const data = {
      parameterId: param.parameterId,
      name: param.name,
      definition: param.definition,
      sectionId: param.sectionId,
      domainGroup: param.domainGroup,
      scaleType: param.scaleType,
      directionality: param.directionality,
      computedBy: param.computedBy,
      parameterType: "STATE" as const,
      isAdjustable: false,
    };

    if (existing) {
      await prisma.parameter.update({
        where: { parameterId: param.parameterId },
        data,
      });
      updated++;
    } else {
      await prisma.parameter.create({ data });
      created++;
    }
  }

  return { created, updated };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedProsodyParameters(prisma)
    .then(async (result) => {
      console.log(
        `  ✓ Prosody parameters: ${result.created} created, ${result.updated} updated`,
      );
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

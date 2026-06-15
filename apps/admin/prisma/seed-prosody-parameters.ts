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
 * Note on values today: the vendor adapter at
 * `lib/pipeline/prosody-runner.ts:367-373` hardcodes `paceWpm: 0` and
 * `hesitationRate: 0` because the SpeechAce / SpeechSuper response shape
 * for general-mode signals isn't yet plumbed through. So `prosody_pace_wpm`
 * and `prosody_hesitation_rate` will receive 0-scored CallScore rows until
 * the adapter extension lands (see follow-on story for vendor extraction).
 * The split is still correct: the zeros are now isolated to their own
 * parameter slot, not polluting the AI-judged `CONV_PACE` value.
 *
 * Idempotent — uses `findUnique → update | create`. Re-running is a no-op
 * when the rows already exist with the same shape.
 *
 * @see prisma/seed-tolerance-parameters.ts — template for this shape
 * @see lib/pipeline/prosody-consumer.ts::GENERAL_PARAM_IDS — the constants
 *      that route the writes
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

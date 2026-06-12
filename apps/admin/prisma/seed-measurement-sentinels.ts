/**
 * Seeds the three SYSTEM-scope sentinel `AnalysisSpec` rows that non-LLM
 * writers stamp onto `CallScore.analysisSpecId` so the spec-lineage
 * column is never NULL (#1539). Idempotent — uses `upsert` keyed by `id`.
 *
 *   PROSODY-SCORE-V1   — used by `lib/pipeline/prosody-consumer.ts`
 *                        (IELTS sub-band + general voice signals).
 *   MOCK-MEASURE-V1    — used by the mock engine branch in `runBatchedCallerAnalysis`
 *                        (deterministic 0.4-0.8 scores for synthetic transcripts).
 *   ADAPT-DELTA-V1     — used by the ADAPT stage delta-deriver as the
 *                        fallback when the parent score has no spec
 *                        lineage (first-call delta has no predecessor).
 *
 * Each row carries an honest `promptTemplate` field documenting what
 * produced the score. The row is NOT used as an LLM rubric — it exists
 * solely as a structural anchor for the FK.
 *
 * Run from the seed orchestrator (see `seed-clean.ts`) or directly:
 *   npx tsx prisma/seed-measurement-sentinels.ts
 */

import { PrismaClient } from "@prisma/client";

import { MEASUREMENT_SENTINEL_SPEC_IDS } from "../lib/measurement/write-call-score";

const prisma = new PrismaClient();

interface SentinelDef {
  id: string;
  slug: string;
  name: string;
  description: string;
  promptTemplate: string;
}

const SENTINELS: SentinelDef[] = [
  {
    id: MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY,
    slug: "PROSODY-SCORE-V1",
    name: "PROSODY adapter — IELTS sub-band + general voice signals",
    description:
      "Structural sentinel for #1539. Stamped on every CallScore row written by lib/pipeline/prosody-consumer.ts. The row's score is produced deterministically from VOICE_PROSODY_V1 envelope content (no LLM call); promptTemplate is non-NULL so the spec-lineage contract is observable but the field is for documentation only.",
    promptTemplate:
      "PROSODY adapter scoring. Source: Call.voiceProsody envelope. " +
      "IELTS mode: row.band / 9 → normalised 0-1. General mode: paceWpm " +
      "linearly mapped 60-200 → 0-1; hesitationRate inverted 0-1. No LLM " +
      "rubric — this template documents the deterministic adapter only.",
  },
  {
    id: MEASUREMENT_SENTINEL_SPEC_IDS.MOCK,
    slug: "MOCK-MEASURE-V1",
    name: "Mock engine — synthetic 0.4–0.8 random scoring",
    description:
      "Structural sentinel for #1539. Stamped on every CallScore row written by the engine=mock branch of runBatchedCallerAnalysis (mock-batched scorer used for harness sims and unit tests). The mock engine has no LLM reasoning; this row exists to satisfy the spec-lineage FK without misattributing the score to a real rubric.",
    promptTemplate:
      "Mock engine scoring. Returns 0.4 + Math.random() * 0.4 for every " +
      "parameter (range 0.4-0.8). Confidence pulled from guardrails.config " +
      "defaultConfidence. Mock writes carry hasLearnerEvidence/evidenceQuality " +
      "= null (legacy semantics). NEVER use this row to read scoring methodology.",
  },
  {
    id: MEASUREMENT_SENTINEL_SPEC_IDS.ADAPT_DELTA,
    slug: "ADAPT-DELTA-V1",
    name: "ADAPT stage — delta-derived score (current - previous)",
    description:
      "Structural sentinel for #1539. Stamped on ADAPT-stage <parameterId>-DELTA rows when the parent score's analysisSpecId is null (first-call delta with no predecessor lineage). When the parent score IS stamped (post-#1539), the delta inherits the parent's spec id instead.",
    promptTemplate:
      "ADAPT stage delta derivation. Score = (currentScore - previousScore + 1) / 2, " +
      "normalising the delta range -1..1 to 0..1. The delta tracks change " +
      "over time, not absolute mastery. confidence = 0.9. This row exists " +
      "to anchor the FK when the source CallScore has no lineage (legacy NULL " +
      "row); the preferred lineage is the parent parameter's MEASURE spec.",
  },
];

export async function seedMeasurementSentinels(): Promise<void> {
  for (const sentinel of SENTINELS) {
    await prisma.analysisSpec.upsert({
      where: { id: sentinel.id },
      update: {
        slug: sentinel.slug,
        name: sentinel.name,
        description: sentinel.description,
        promptTemplate: sentinel.promptTemplate,
        scope: "SYSTEM",
        outputType: "MEASURE",
        specType: "SYSTEM",
        specRole: "EXTRACT",
        isActive: true,
      },
      create: {
        id: sentinel.id,
        slug: sentinel.slug,
        name: sentinel.name,
        description: sentinel.description,
        promptTemplate: sentinel.promptTemplate,
        scope: "SYSTEM",
        outputType: "MEASURE",
        specType: "SYSTEM",
        specRole: "EXTRACT",
        priority: 0,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${sentinel.id} (${sentinel.slug})`);
  }
}

if (require.main === module) {
  seedMeasurementSentinels()
    .then(async () => {
      // eslint-disable-next-line no-console
      console.log(`Seeded ${SENTINELS.length} measurement sentinel spec(s).`);
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

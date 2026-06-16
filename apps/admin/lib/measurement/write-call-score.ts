/**
 * Canonical chokepoint for writing `CallScore` rows from the production
 * pipeline. Required: `analysisSpecId` — the `AnalysisSpec` whose
 * `promptTemplate` produced this score.
 *
 * ## Why this exists (#1539)
 *
 * Until 2026-06-12 every `CallScore` row was written with
 * `analysisSpecId = NULL` (verified live: 1125/1125 rows on hf_sandbox).
 * The column existed; no write code populated it. `runBatchedCallerAnalysis`
 * also dropped each spec's `promptTemplate` before building the LLM prompt
 * — see `build-batched-measure-prompt.ts` for that side of the gap.
 *
 * The ADR is `docs/decisions/2026-06-12-spec-driven-batched-measurement.md`.
 *
 * This helper is the SOLE PATH for writing `CallScore` rows. ESLint rule
 * `hf-measurement/no-bare-call-score-write` enforces (allow-list: this
 * helper, the legacy drain script, and the test fixture cleanup helpers).
 *
 * ## Idempotence
 *
 * `(callId, parameterId, moduleId)` is the unique key on `CallScore`. The
 * helper does `findFirst + create | update` (NOT Prisma `upsert`, because
 * Prisma's compound unique cannot accept `moduleId = null` in `where`).
 * Re-runs of EXTRACT against the same call replace the row in place; the
 * `evidence` array is overwritten, not appended.
 */

import { prisma } from "@/lib/prisma";

export interface WriteCallScoreInput {
  /** The call this score grades. Required. */
  callId: string;
  /** Denormalised caller link. Required to keep the (callerId, parameterId)
   *  hot path index (`#974`) populated. */
  callerId: string | null;
  /** The parameter (skill / behaviour dimension) being scored. */
  parameterId: string;
  /** **REQUIRED** — the `AnalysisSpec.id` whose rubric produced this score.
   *
   *  This is the structural fix for #1539. Empty string / undefined / null
   *  is rejected at runtime; the TypeScript signature also makes the
   *  field non-optional. Callers may pass a sentinel spec id (e.g.
   *  `"PROSODY-SCORE-V1"`) when the writer is not an LLM but still a
   *  spec-shaped boundary. */
  analysisSpecId: string;
  /** Module attribution. `null` for unbound calls; the `CurriculumModule.id`
   *  for module-bound calls (#491 Slice 1.2). */
  moduleId: string | null;
  /** Transcript-segment annotation (#1700 Theme 6, story #1702). The
   *  per-part Mock scorer passes the segment slug (e.g. `"part1"`) so the
   *  Results screen (Theme 13a) can render per-part criterion scores.
   *  Free-text, course-agnostic. `null` / omitted for whole-call and
   *  bound-module writes — zero behaviour change on non-Mock paths.
   *
   *  **NOT part of the `(callId, parameterId, moduleId)` idempotence key**
   *  (epic #1700 decision 1) — purely an annotation column. Widening the
   *  unique key would let one pass write multiple rows per criterion for
   *  the same module. */
  segmentKey?: string | null;
  /** 0-1 normalised score. NOT clamped here — clamp at the caller. */
  score: number;
  /** 0-1 confidence band. Defaults to 0.5 in the schema if omitted. */
  confidence: number;
  /** Evidence quotes / source markers (e.g. `["AI batched analysis"]`,
   *  `["prosody/ielts:band=7.0"]`, `["Segment: part1"]`). */
  evidence: string[];
  /** Free-text LLM reasoning. `null` for non-LLM writers (PROSODY, mock). */
  reasoning?: string | null;
  /** `"mock_batched_v1"`, `"claude_batched_v2"`, `"prosody_v1"`, etc. */
  scoredBy?: string | null;
  /** `true` when the scorer judged the learner produced scoreable
   *  evidence. `false` when the score came from tutor prose. `null` for
   *  legacy / mock writers (Boaz S1-S4 — see schema notes on the column). */
  hasLearnerEvidence?: boolean | null;
  /** 0-1 confidence in evidence QUANTITY (orthogonal to `confidence`).
   *  `null` for legacy / mock writers. */
  evidenceQuality?: number | null;
}

export interface WriteCallScoreResult {
  /** The persisted row id. */
  id: string;
  /** True when a new row was created; false when an existing row was updated. */
  created: boolean;
}

/**
 * Write a `CallScore` row. Idempotent against the
 * `(callId, parameterId, moduleId)` unique key.
 *
 * Throws `Error("writeCallScore: analysisSpecId is required")` when the
 * spec id is missing or empty — the structural guard #1539 exists to add.
 *
 * @see docs/decisions/2026-06-12-spec-driven-batched-measurement.md
 */
export async function writeCallScore(
  input: WriteCallScoreInput,
): Promise<WriteCallScoreResult> {
  if (!input.analysisSpecId || input.analysisSpecId.trim() === "") {
    throw new Error(
      "writeCallScore: analysisSpecId is required (#1539). Every CallScore " +
        "must carry the AnalysisSpec.id of the rubric that produced it. " +
        "If you are writing from a non-LLM path (PROSODY, mock), pass the " +
        "appropriate sentinel spec id.",
    );
  }

  const existing = await prisma.callScore.findFirst({
    where: {
      callId: input.callId,
      parameterId: input.parameterId,
      moduleId: input.moduleId,
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.callScore.update({
      where: { id: existing.id },
      data: {
        score: input.score,
        confidence: input.confidence,
        evidence: input.evidence,
        reasoning: input.reasoning ?? null,
        scoredBy: input.scoredBy ?? null,
        scoredAt: new Date(),
        analysisSpecId: input.analysisSpecId,
        hasLearnerEvidence: input.hasLearnerEvidence ?? null,
        evidenceQuality: input.evidenceQuality ?? null,
        segmentKey: input.segmentKey ?? null,
      },
    });
    return { id: existing.id, created: false };
  }

  const row = await prisma.callScore.create({
    data: {
      callId: input.callId,
      callerId: input.callerId,
      parameterId: input.parameterId,
      ...(input.moduleId ? { moduleId: input.moduleId } : {}),
      score: input.score,
      confidence: input.confidence,
      evidence: input.evidence,
      reasoning: input.reasoning ?? null,
      scoredBy: input.scoredBy ?? null,
      analysisSpecId: input.analysisSpecId,
      hasLearnerEvidence: input.hasLearnerEvidence ?? null,
      evidenceQuality: input.evidenceQuality ?? null,
      ...(input.segmentKey ? { segmentKey: input.segmentKey } : {}),
    },
    select: { id: true },
  });
  return { id: row.id, created: true };
}

/**
 * System-sentinel spec ids used by non-LLM writers. These are the legal
 * values to pass when the writer is structurally spec-shaped but not
 * backed by an `AnalysisSpec` row (PROSODY adapter scoring, the mock
 * engine, the ADAPT delta deriver).
 *
 * Each sentinel maps to a seeded `AnalysisSpec` row of the same id; the
 * seed lands in `prisma/seed-measurement-sentinels.ts` (#1539). The
 * sentinel rows carry `outputType = MEASURE`, `scope = SYSTEM`, and a
 * `promptTemplate` that documents what produced the score so historical
 * tracing is honest.
 */
export const MEASUREMENT_SENTINEL_SPEC_IDS = {
  /** PROSODY adapter (`lib/pipeline/prosody-consumer.ts`) writes against
   *  this sentinel when no IELTS/PROSODY analysis spec is linked to the
   *  parameter. */
  PROSODY: "PROSODY-SCORE-V1",
  /** Mock engine path (`engine === "mock"` branch). */
  MOCK: "MOCK-MEASURE-V1",
  /** ADAPT stage delta scores (`<parameterId>-DELTA` rows derived from
   *  current - previous). These inherit the parent parameter's spec id
   *  when available; this sentinel is the fallback when no parent
   *  attribution exists. */
  ADAPT_DELTA: "ADAPT-DELTA-V1",
} as const;

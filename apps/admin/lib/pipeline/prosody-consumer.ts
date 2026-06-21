/**
 * AGGREGATE consumer of VOICE_PROSODY_V1 envelopes (#1119, refactored #2138).
 *
 * Reads `Call.voiceProsody` (populated upstream by `prosody-runner.ts`)
 * and writes downstream rows:
 *
 *   mode === "ielts"        → up to 4 CallScore rows on `prosody_raw_*`
 *                             parameters (audio-feature signal, distinct
 *                             from the LLM-judged IELTS skill IDs owned
 *                             by IELTS-MEASURE-001 via SCORE_AGENT).
 *                             Normalised 0–9 → 0–1.
 *   mode === "general"      → CallScore deltas on `prosody_pace_wpm` and
 *                             `prosody_hesitation_rate` (the two
 *                             confirmed general-mode parameters).
 *                             `confidenceProxy` stays on the envelope
 *                             but has no parameter consumer.
 *   mode === "unavailable"  → skip silently (no rows written)
 *
 * #2138 (epic #2135 S3) — IELTS-mode writer refactor:
 *
 *   Pre-#2138, the IELTS-mode writer targeted the 4 IELTS skill parameter
 *   IDs (`skill_*`) directly. That was structurally wrong because (a) the
 *   vendor cannot reliably score LR or GRA from audio features alone —
 *   those need LLM judgment of transcript text content; and (b) the
 *   bespoke prosody writer bypassed the canonical MEASURE-spec path.
 *
 *   #2155 (S2) introduced IELTS-MEASURE-001 — an LLM transcript-judgment
 *   spec running via the canonical SCORE_AGENT path. It now writes the 4
 *   IELTS skill CallScore rows. S2 flag-gated the prosody-consumer's
 *   IELTS-skill writes to avoid a dual-writer race during transition.
 *
 *   S3 (this refactor) closes the transition by giving prosody its own
 *   `prosody_raw_*` parameter IDs. The two writers now target disjoint
 *   parameterId namespaces — no collision possible regardless of flag
 *   state. The IELTS-MEASURE-001 spec MAY optionally consume the
 *   prosody-raw rows via tool-use (post-MVP) to augment FC + P
 *   confidence. LR + GRA stay LLM-only forever.
 *
 * Idempotent — uses `upsert` on the CallScore `(callId, parameterId,
 * moduleId)` unique index. A repeat call with the same envelope produces
 * no new rows; a re-pipeline-run with a new envelope overwrites the
 * earlier values.
 *
 * Called from the AGGREGATE stage executor (route.ts) AFTER the
 * caller-scoped `runAggregateSpecs` finishes — that keeps the call-scoped
 * prosody consumption next to the rest of the call-scoped AGGREGATE work
 * without polluting the spec-driven caller aggregation.
 */

import { prisma } from "@/lib/prisma";
import {
  writeCallScore,
  MEASUREMENT_SENTINEL_SPEC_IDS,
} from "@/lib/measurement/write-call-score";

import type {
  GeneralSignals,
  IeltsScores,
  ProsodyPhaseEnvelope,
  VoiceProsodyFeatures,
} from "./prosody-types";

/**
 * #2138 (epic #2135 S3) — IELTS-mode prosody-raw parameter IDs.
 *
 * These are the SEPARATE namespace from the 4 IELTS skill parameter IDs
 * (`skill_fluency_and_coherence_fc`, `skill_pronunciation_p`,
 * `skill_lexical_resource_lr`, `skill_grammatical_range_and_accuracy_gra`)
 * which are owned by the IELTS-MEASURE-001 LLM spec via the canonical
 * SCORE_AGENT path (#2155).
 *
 * Confidence per row:
 *   - FC + P → 0.9 (audio fluency + phoneme features are vendor's strength)
 *   - LR + GRA → 0.7 (vendor cannot reliably score vocab/grammar from
 *                     audio — included for completeness; LR+GRA stay
 *                     LLM-only forever)
 *
 * Optionally consumed by IELTS-MEASURE-001 via tool-use (post-MVP) to
 * augment FC + P LLM judgment when vendor signal is present. LR + GRA
 * remain LLM-only regardless.
 */
const PROSODY_RAW_PARAM_IDS = {
  fluencyCoherence: "prosody_raw_fc",
  pronunciation: "prosody_raw_p",
  lexicalResource: "prosody_raw_lr",
  grammaticalRange: "prosody_raw_gra",
} as const;

/**
 * #2138 — Per-criterion confidence for the prosody-raw IELTS rows.
 *
 * FC + P are reasonably observable from vendor audio features. LR + GRA
 * are audio-feature approximations of text-content phenomena — the
 * vendor cannot score them reliably. The lower confidence flags this to
 * any future tool-use consumer (e.g. IELTS-MEASURE-001 reading these
 * rows to augment its LLM judgment).
 */
const PROSODY_RAW_CONFIDENCE: Record<
  keyof typeof PROSODY_RAW_PARAM_IDS,
  number
> = {
  fluencyCoherence: 0.9,
  pronunciation: 0.9,
  lexicalResource: 0.7,
  grammaticalRange: 0.7,
};

/** Parameter IDs targeted by the general-mode write.
 *
 *  Split from `CONV_PACE` / `pace_indicators` on 2026-06-15 — those slots
 *  are written by EXTRACT (AI-judged from transcript) and pre-split this
 *  consumer ran AFTER EXTRACT and overwrote them via
 *  `writeCallScore`'s `(callId, parameterId, moduleId)` idempotency.
 *  AI's qualitative pace judgment was silently destroyed by the vendor-
 *  derived zero. Separate parameter IDs keep both writers' surfaces
 *  alive; see `prisma/seed-prosody-parameters.ts` header for the full
 *  rationale.
 *
 *  Note: until the vendor adapter exposes real general-mode signals
 *  (`prosody-runner.ts:367-373` hardcodes 0), these slots receive
 *  0-scored CallScore rows. Isolated to their own params, not polluting
 *  CONV_PACE. */
const GENERAL_PARAM_IDS = {
  paceWpm: "prosody_pace_wpm",
  hesitationRate: "prosody_hesitation_rate",
} as const;

export interface ApplyProsodyResult {
  applied: boolean;
  mode: "ielts" | "general" | "unavailable" | "missing";
  scoresWritten: number;
}

/**
 * Read `Call.voiceProsody` and write the appropriate downstream rows.
 * Safe to call when the envelope is missing or `mode === "unavailable"`
 * — both no-op and return `{ applied: false }`.
 */
export async function applyProsodyContractToAggregate(
  callId: string,
  callerId: string | null,
): Promise<ApplyProsodyResult> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { voiceProsody: true },
  });
  if (!call?.voiceProsody) {
    return { applied: false, mode: "missing", scoresWritten: 0 };
  }

  const envelope = call.voiceProsody as unknown as VoiceProsodyFeatures;

  if (envelope.mode === "unavailable" && !envelope.bySegment) {
    return { applied: false, mode: "unavailable", scoresWritten: 0 };
  }

  // #1870 — segmented path. When `bySegment` is present, iterate it and
  // write per-phase CallScore rows with namespace-prefixed segmentKey
  // (`phase:<phaseKey>` per #1872 Option 2). The top-level mean
  // aggregate is ALSO written so existing whole-call readers keep
  // working — segmentKey null on the aggregate row to distinguish it
  // from per-phase rows in the unique-key collision-free namespace.
  if (envelope.bySegment) {
    let written = 0;
    for (const [phaseKey, phase] of Object.entries(envelope.bySegment)) {
      written += await writePhaseEnvelope(
        callId,
        callerId,
        phaseKey,
        phase,
      );
    }
    // Aggregate write — segmentKey null preserves the existing whole-call
    // row shape that AGGREGATE EMA + Snapshot read. Skip when top-level
    // is "unavailable" (every phase failed).
    if (envelope.mode === "ielts" && envelope.ieltsScores) {
      written += await writeProsodyRawCallScores(
        callId,
        callerId,
        envelope.ieltsScores,
      );
    } else if (envelope.mode === "general" && envelope.generalSignals) {
      written += await writeGeneralCallScores(
        callId,
        callerId,
        envelope.generalSignals,
      );
    }
    return { applied: true, mode: envelope.mode, scoresWritten: written };
  }

  if (envelope.mode === "ielts" && envelope.ieltsScores) {
    const written = await writeProsodyRawCallScores(
      callId,
      callerId,
      envelope.ieltsScores,
    );
    return { applied: true, mode: "ielts", scoresWritten: written };
  }

  if (envelope.mode === "general" && envelope.generalSignals) {
    const written = await writeGeneralCallScores(
      callId,
      callerId,
      envelope.generalSignals,
    );
    return { applied: true, mode: "general", scoresWritten: written };
  }

  return { applied: false, mode: envelope.mode, scoresWritten: 0 };
}

/**
 * Write per-phase CallScore rows for one phase's envelope. The
 * `segmentKey` carries the namespace-prefixed phaseKey
 * (`phase:<phaseKey>`) so the writes don't collide with the existing
 * text segmenter's `"part1"` / `"part2"` / `"part3"` keys (#1872
 * Option 2 namespace decision).
 *
 * "unavailable" phases are skipped silently — no row written.
 */
async function writePhaseEnvelope(
  callId: string,
  callerId: string | null,
  phaseKey: string,
  phase: ProsodyPhaseEnvelope,
): Promise<number> {
  if (phase.mode === "unavailable") return 0;
  if (phase.mode === "ielts") {
    return writeProsodyRawCallScores(callId, callerId, phase.ieltsScores, phaseKey);
  }
  return writeGeneralCallScores(callId, callerId, phase.generalSignals, phaseKey);
}

/**
 * #2138 (epic #2135 S3) — Write vendor-derived IELTS audio-feature signal
 * to the `prosody_raw_*` parameter slots.
 *
 * This used to target the 4 IELTS skill parameter IDs (`skill_*`) directly,
 * but those are now owned by the IELTS-MEASURE-001 LLM spec via the
 * canonical SCORE_AGENT path (#2155). Prosody writes its OWN namespace
 * (`prosody_raw_fc` / `_p` / `_lr` / `_gra`) so the two writers never
 * collide — no flag gating is needed because the parameterId namespaces
 * are disjoint.
 *
 * Per criterion: FC + P land at confidence 0.9 (vendor's strong suit —
 * audio fluency + phoneme features). LR + GRA land at confidence 0.7 —
 * vendor cannot reliably score vocab / grammar from audio features, but
 * the row is still recorded for forensics + completeness. The LLM is the
 * authoritative scorer for LR + GRA via IELTS-MEASURE-001.
 *
 * Per OPERATOR RULE (epic #2135): null / non-finite bands → no write
 * out. Never hardcode a score default to fill an empty row.
 */
async function writeProsodyRawCallScores(
  callId: string,
  callerId: string | null,
  ielts: IeltsScores,
  segmentKey?: string,
): Promise<number> {
  const rows: Array<{
    parameterId: string;
    band: number;
    confidence: number;
    criterion: keyof typeof PROSODY_RAW_PARAM_IDS;
  }> = [
    {
      parameterId: PROSODY_RAW_PARAM_IDS.fluencyCoherence,
      band: ielts.fluencyCoherence,
      confidence: PROSODY_RAW_CONFIDENCE.fluencyCoherence,
      criterion: "fluencyCoherence",
    },
    {
      parameterId: PROSODY_RAW_PARAM_IDS.pronunciation,
      band: ielts.pronunciation,
      confidence: PROSODY_RAW_CONFIDENCE.pronunciation,
      criterion: "pronunciation",
    },
    {
      parameterId: PROSODY_RAW_PARAM_IDS.lexicalResource,
      band: ielts.lexicalResource,
      confidence: PROSODY_RAW_CONFIDENCE.lexicalResource,
      criterion: "lexicalResource",
    },
    {
      parameterId: PROSODY_RAW_PARAM_IDS.grammaticalRange,
      band: ielts.grammaticalRange,
      confidence: PROSODY_RAW_CONFIDENCE.grammaticalRange,
      criterion: "grammaticalRange",
    },
  ];

  let written = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.band)) continue;
    const normalisedScore = clamp01(row.band / 9);
    // #1539 — stamp the PROSODY sentinel spec id. PROSODY is
    // structurally spec-shaped (deterministic adapter output) but not
    // backed by an AnalysisSpec.promptTemplate row. The sentinel
    // surfaces "produced by PROSODY, not LLM" lineage honestly.
    // #1870 — `segmentKey` carries the namespace-prefixed phaseKey
    // (`phase:<name>`) for per-phase rows; undefined for the
    // whole-call / aggregate row.
    await writeCallScore({
      callId,
      callerId,
      parameterId: row.parameterId,
      analysisSpecId: MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY,
      moduleId: null,
      segmentKey: segmentKey ?? null,
      score: normalisedScore,
      confidence: row.confidence,
      evidence: [`prosody/ielts:${row.criterion}:band=${row.band.toFixed(1)}`],
      reasoning:
        "PROSODY stage IELTS audio-feature signal (0-9 normalised to 0-1); " +
        "raw vendor signal, distinct from the LLM-judged skill_* IDs " +
        "owned by IELTS-MEASURE-001.",
      scoredBy: "prosody_v1",
    });
    written++;
  }
  return written;
}

async function writeGeneralCallScores(
  callId: string,
  callerId: string | null,
  signals: GeneralSignals,
  segmentKey?: string,
): Promise<number> {
  // Map the two confirmed general-mode signals to BehaviorParameter-id'd
  // CallScore rows. Score normalised to 0–1:
  //   paceWpm — 100–160 WPM is the natural conversation band. < 100 →
  //     low score (deliberate); > 160 → high score (rapid). Clamp.
  //   hesitationRate — already 0–1.
  const writes: Array<{ parameterId: string; score: number; evidence: string }> = [];

  if (Number.isFinite(signals.paceWpm)) {
    // Map 60..200 WPM linearly to 0..1; 130 WPM (mid-conversation) → ~0.5.
    const normalised = clamp01((signals.paceWpm - 60) / (200 - 60));
    writes.push({
      parameterId: GENERAL_PARAM_IDS.paceWpm,
      score: normalised,
      evidence: `prosody/general:paceWpm=${signals.paceWpm.toFixed(0)}`,
    });
  }

  if (Number.isFinite(signals.hesitationRate)) {
    // Lower hesitation = higher score (fewer pauses = better fluency).
    const normalised = clamp01(1 - signals.hesitationRate);
    writes.push({
      parameterId: GENERAL_PARAM_IDS.hesitationRate,
      score: normalised,
      evidence: `prosody/general:hesitationRate=${signals.hesitationRate.toFixed(2)}`,
    });
  }

  // confidenceProxy intentionally NOT written — no BehaviorParameter
  // consumer in #1119. Stays on the contract envelope for ADAPT/COMPOSE
  // to read if they want it.

  let written = 0;
  for (const w of writes) {
    // #1539 — same PROSODY sentinel for the general-mode writes.
    // #1870 — `segmentKey` carries the namespace-prefixed phaseKey
    // (`phase:<name>`) for per-phase rows; undefined for the
    // whole-call / aggregate row.
    await writeCallScore({
      callId,
      callerId,
      parameterId: w.parameterId,
      analysisSpecId: MEASUREMENT_SENTINEL_SPEC_IDS.PROSODY,
      moduleId: null,
      segmentKey: segmentKey ?? null,
      score: w.score,
      confidence: 0.7,
      evidence: [w.evidence],
      reasoning: "PROSODY stage general voice signal",
      scoredBy: "prosody_v1",
    });
    written++;
  }
  return written;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

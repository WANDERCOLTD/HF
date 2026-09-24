/**
 * write-count-logger.ts (#1622 / Epic #1618 Slice 1)
 *
 * Per-call per-stage write-count emitter. Pipes structured counts into
 * `AppLog` via the canonical `log()` writer so a downstream detector
 * can flag "writer code present in the runtime path, runs without
 * crashing, but produces no rows over a 24h window" — the silent-writer
 * gap class the 2026-06-14 audit found four examples of (#1608 / #1609
 * / #1614 / #1615).
 *
 * Pre-#1622 the pipeline stage executors logged per-stage counts to the
 * in-memory `PipelineLogger` (which decays at end-of-request) but
 * nothing was persisted in a queryable shape. This module persists a
 * single row per (callId, stage) with the count per writable table that
 * stage touches. Cron / SQL view can roll up the rows into a 24h window
 * and fire when MAX(count) over the window equals 0.
 *
 * Contract is intentionally permissive: every count field is optional.
 * Stage executors only fill the counts that their stage actually
 * writes (EXTRACT fills `callerMemory`, `personalityObservation`;
 * SCORE_AGENT fills `behaviorMeasurement`; etc). A field being absent
 * means "this stage doesn't write that table" — distinct from "this
 * stage tried to write and got 0 rows" (count: 0). The detector
 * distinguishes these via `field IS NULL` vs `field = 0`.
 *
 * The stage field uses subject `pipeline.stage.write_counts:<stage>`
 * so AppLog scans can grep stably. Lower-case stage name for grep
 * convenience.
 */

import { log } from "@/lib/logger";

/**
 * Possible writable tables touched by the pipeline. Each stage fills
 * only the subset it actually writes. Unset → "this stage does not
 * write this table"; explicit `0` → "this stage tried + wrote nothing".
 *
 * When a new pipeline writer lands, add the corresponding key here so
 * the detector can roll up its 24h window without losing the writer in
 * a free-form metadata blob.
 */
export interface PipelineStageWriteCounts {
  /** SCORE_AGENT, per-segment scoring */
  behaviorMeasurement?: number;
  /** AGGREGATE, per-call score row */
  callScore?: number;
  /** AGGREGATE, EMA-decayed running score per skill / behavior parameter */
  callerTarget?: number;
  /** AGGREGATE, monotonic per-LO mastery ratchet (curriculum:{spec}:lo_mastery:{module}:{lo}) */
  callerAttribute_lo_mastery?: number;
  /** ADAPT, per-session learner-facing emphasis label (session_focus:next_{moduleSlug}) — #2154 / epic #2145 */
  callerAttribute_session_focus?: number;
  /** AGGREGATE, per-module rolled-up mastery (structured courses only) */
  callerModuleProgress?: number;
  /** REWARD, overall call quality */
  rewardScore?: number;
  /** ADAPT, goal extraction + tracking */
  goal?: number;
  /** ADAPT, per-call adaptation targets */
  callTarget?: number;
  /** EXTRACT, memory facts */
  callerMemory?: number;
  /** EXTRACT, personality trait observations */
  personalityObservation?: number;
  /** ADAPT, homework / next-call actions */
  callAction?: number;
  /** EXTRACT / ADAPT, conversation artifacts (quote-worthy lines) */
  conversationArtifact?: number;
  /** ADAPT, failure adaptation signal */
  failureLog?: number;
  /** COMPOSE, next-call assembled prompt */
  composedPrompt?: number;
}

/**
 * AppLog subject prefix for write-count rows. Detector queries should
 * filter `stage LIKE 'pipeline.stage.write_counts:%'` (note the
 * lowercase-stage suffix used at write time).
 */
export const WRITE_COUNT_STAGE_PREFIX = "pipeline.stage.write_counts:";

/**
 * AppLog subject for silent-writer alarm rows emitted by the detector.
 */
export const SILENT_WRITER_ALARM_STAGE = "pipeline.stage.silent_writer";

/**
 * Emit one AppLog row recording how many rows each table received during
 * a pipeline stage run. Fire-and-forget — the underlying `log()` writes
 * are non-blocking and any failure to persist is logged to stderr (the
 * adaptive-loop must not stall because telemetry choked).
 *
 * Caller responsibilities:
 *   - pass the canonical stage name (`"EXTRACT"`, `"SCORE_AGENT"`,
 *     `"AGGREGATE"`, `"REWARD"`, `"ADAPT"`, `"SUPERVISE"`, `"COMPOSE"`)
 *   - fill only fields the stage actually wrote (omit absent ones)
 *   - count rows that actually landed (post-DB success), not rows
 *     proposed pre-write — the detector's whole job is to surface "we
 *     proposed N writes and 0 succeeded"
 */
export function logStageWriteCounts(args: {
  stage: string;
  callId: string;
  callerId?: string;
  playbookId?: string;
  writeCounts: PipelineStageWriteCounts;
  durationMs?: number;
}): void {
  const { stage, callId, callerId, playbookId, writeCounts, durationMs } = args;
  const totalWrites = Object.values(writeCounts).reduce<number>(
    (sum, n) => sum + (typeof n === "number" ? n : 0),
    0,
  );
  log("system", `${WRITE_COUNT_STAGE_PREFIX}${stage.toLowerCase()}`, {
    message: `${stage} write counts`,
    level: totalWrites === 0 ? "warn" : "info",
    stage,
    callId,
    callerId,
    playbookId,
    writeCounts,
    totalWrites,
    durationMs,
  });
}

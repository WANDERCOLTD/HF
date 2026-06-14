/**
 * Adaptive Loop invariants — observability foundation for epic #1510.
 *
 * @invariant: I-AL1 — memory presence on real-engine EXTRACT
 * @invariant: I-AL2 — skill score aggregation reaches CallerTarget.currentScore
 * @invariant: I-AL3 — spec config sourcing observability (default-fallback signal)
 * @invariant: I-AL4 — PROSODY-skip observability
 * @invariant: I-AL5 — SCORE_AGENT zero-targets observability
 * @invariant: I-AL6 — CallScore.analysisSpecId stamped post-EXTRACT (#1539)
 *
 * All invariants are NON-BLOCKING and WARN-only (I-AL3 is INFO; I-AL5 ERROR-escalates
 * when the cascade root is empty). Violations are written fire-and-forget to AppLog
 * with `stage = "pipeline.invariant.i-al<n>"` and surfaced on `/x/help/pipeline-health`.
 *
 * See `docs/CHAIN-CONTRACTS.md` §6 for the full per-invariant contract (producer,
 * consumer, data shape, detection rule, severity, audit counter, underlying fix).
 *
 * Story: #1511 (Slice 1 of #1510). Sibling slices wire emits at the stage runners
 * for I-AL3 / I-AL4 / I-AL5; this module is the single chokepoint they all route
 * through (recordInvariantViolation).
 */

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import { checkWriterCompletenessAfterPipeline } from "@/lib/pipeline/writer-completeness-invariant";

// ── Public types ──────────────────────────────────────────

export type InvariantId =
  | "I-AL1"
  | "I-AL2"
  | "I-AL3"
  | "I-AL4"
  | "I-AL5"
  | "I-AL6"
  // #1620 / #1621 — Writer-Completeness invariant (Epic #1618 Slices 3+4).
  // I-WC1 fires when a registered per-call writer left its field NULL on
  // a real (non-mock) call. See `writer-completeness-invariant.ts`.
  | "I-WC1";

export type InvariantSeverity = "info" | "warn" | "error";

export interface InvariantViolation {
  invariant: InvariantId;
  severity: InvariantSeverity;
  callerId?: string;
  callId?: string;
  playbookId?: string;
  parameterId?: string;
  context: Record<string, unknown>;
  observedAt: Date;
}

// ── Constants ─────────────────────────────────────────────

/**
 * I-AL1 fires only on real-engine extraction. Mock-engine intentionally suppresses
 * CallerMemory writes (route.ts:1029-1031); the G9 audit (#1158) already added the
 * WARN there. We do not want to double-count.
 */
const REAL_ENGINE = "claude" as const;

/**
 * I-AL1 threshold — sub-200-char transcripts are too short to reliably produce
 * memories. Below this the absence of a memory is not necessarily a contract break.
 */
export const I_AL1_TRANSCRIPT_MIN_CHARS = 200;

/**
 * I-AL2 fresh-window — if the last CallScore for a (callerId, parameterId) tuple
 * landed inside this window AND CallerTarget.currentScore is still null, the
 * AGGREGATE EMA cascade has silently failed.
 */
export const I_AL2_FRESH_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * I-AL2 24h look-back — we only consider CallScore rows from the last 24h when
 * checking for the gap. Older rows belong to a drained / migration window and
 * shouldn't trigger the invariant.
 */
const I_AL2_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const APPLOG_STAGE_PREFIX = "pipeline.invariant";

// ── Severity helpers ──────────────────────────────────────

const DEFAULT_SEVERITY: Record<InvariantId, InvariantSeverity> = {
  "I-AL1": "warn",
  "I-AL2": "warn",
  "I-AL3": "info",
  "I-AL4": "warn",
  "I-AL5": "warn",
  // #1539 — lands as `warn`. Will promote to `error` once the drain
  // script reports `unresolvable = 0` and the column is migrated to
  // NOT NULL (per ADR's migration plan).
  "I-AL6": "warn",
  // #1620 / #1621 — soft-mode default. Promotion to `error` (which
  // would halt the pipeline under `STRICT_PIPELINE_INVARIANTS=1`)
  // happens after the silent-writer detector (Slice 1) confirms a
  // steady-state of zero violations over a multi-week window.
  "I-WC1": "warn",
};

export function defaultSeverityFor(invariant: InvariantId): InvariantSeverity {
  return DEFAULT_SEVERITY[invariant];
}

// ── Public API ────────────────────────────────────────────

/**
 * Single chokepoint for writing an invariant violation. Calls log() (so the row
 * lands in /x/logs) AND writes a directly-queryable AppLog row with a stable
 * `stage` prefix that the dashboard can `LIKE 'pipeline.invariant.%'` against.
 *
 * Swallows all errors — must not throw, must not block the caller.
 */
export async function recordInvariantViolation(
  v: InvariantViolation,
): Promise<void> {
  try {
    const stage = `${APPLOG_STAGE_PREFIX}.${v.invariant.toLowerCase()}`;
    const event = `${v.invariant}-${invariantEventTag(v.invariant)}`;

    // logger.log() does its own AppLog write (with metadata) AND, in
    // production, mirrors to stdout. We pass the structured context as
    // top-level fields so the existing log filter UI surfaces them.
    log("system", stage, {
      level: v.severity,
      event,
      invariant: v.invariant,
      callerId: v.callerId,
      callId: v.callId,
      playbookId: v.playbookId,
      parameterId: v.parameterId,
      observedAt: v.observedAt.toISOString(),
      ...v.context,
    });
  } catch {
    // The single contract this module enforces: never throw. The pipeline
    // does not care about observability writes — if the DB is gone, it's
    // gone. The structural pipeline writes upstream of us handle their own
    // durability.
  }
}

/**
 * Post-pipeline derived checks. Reads CallerMemory + CallScore + CallerTarget
 * state to derive I-AL1 + I-AL2 verdicts; emits violations via
 * recordInvariantViolation; returns the list (also for caller-side tests).
 *
 * I-AL3 / I-AL4 / I-AL5 are NOT derived here — they fire at the stage that
 * silently skips. This function is the runtime-state observer for the two
 * invariants that need a cross-table SELECT to detect.
 *
 * NON-BLOCKING. Swallows all errors. Always returns (possibly empty) array.
 */
export async function checkInvariantsAfterPipeline(
  callId: string,
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const observedAt = new Date();

  try {
    // Load just enough context to drive the derived checks.
    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: {
        id: true,
        callerId: true,
        playbookId: true,
        transcript: true,
        createdAt: true,
      },
    });

    if (!call || !call.callerId) {
      return violations;
    }

    // I-AL1 — memory presence on real-engine EXTRACT
    const al1 = await deriveIAL1Violation(
      {
        id: call.id,
        callerId: call.callerId,
        transcript: call.transcript,
        createdAt: call.createdAt,
      },
      observedAt,
    );
    if (al1) {
      violations.push(al1);
      await recordInvariantViolation(al1);
    }

    // I-AL2 — skill score aggregation reaches CallerTarget.currentScore
    const al2List = await deriveIAL2Violations(call.callerId, observedAt);
    for (const v of al2List) {
      violations.push(v);
      await recordInvariantViolation(v);
    }

    // I-AL6 — every CallScore row created/updated against this call
    // must carry `analysisSpecId`. The structural fix #1539 lands the
    // helper + ESLint rule that make NULL writes impossible going
    // forward; this invariant is the runtime observer that catches
    // (a) any allow-listed bypass that drifts past the helper and
    // (b) historical NULL rows that survived the drain.
    const al6 = await deriveIAL6Violation(call.id, observedAt);
    if (al6) {
      violations.push(al6);
      await recordInvariantViolation(al6);
    }

    // I-WC1 — writer-completeness per-call invariant. For each
    // registered per-call writer (WRITER_REGISTRY), check that this
    // specific call's row has its expected field populated. Records
    // one AppLog row per silent field; promotion to halt-the-pipeline
    // happens after Slice 1's 24h detector confirms steady-state zero.
    // #1620 / #1621 — Epic #1618 Slices 3+4.
    let courseStyle: "structured" | "continuous" = "continuous";
    if (call.playbookId) {
      const pb = await prisma.playbook.findUnique({
        where: { id: call.playbookId },
        select: { config: true },
      });
      const pbConfig = (pb?.config ?? null) as { lessonPlanMode?: string } | null;
      if (pbConfig?.lessonPlanMode === "structured") courseStyle = "structured";
    }
    const wcFindings = await checkWriterCompletenessAfterPipeline({
      callId: call.id,
      callerId: call.callerId,
      playbookId: call.playbookId,
      courseStyle,
      // The Call schema doesn't currently store the engine choice; the
      // invariant defaults to "claude" (real engine) and the mock-engine
      // filter inside writer-completeness-invariant.ts is therefore
      // currently a no-op. Test fixtures stay correct because mock
      // fixtures don't land on production Call rows.
      engine: "claude",
    });
    for (const f of wcFindings) {
      if (f.populated || f.skipReason) continue;
      const v: InvariantViolation = {
        invariant: "I-WC1",
        severity: defaultSeverityFor("I-WC1"),
        callId: call.id,
        callerId: call.callerId,
        playbookId: call.playbookId ?? undefined,
        context: { field: f.field, stage: f.stage, writer: f.writer },
        observedAt,
      };
      violations.push(v);
      // checkWriterCompletenessAfterPipeline already logged the AppLog
      // row directly; recordInvariantViolation would double-log.
    }
  } catch {
    // Invariant runner never blocks. A genuine pipeline failure has already
    // been logged via stageErrors / route.ts; we don't re-log here.
  }

  return violations;
}

// ── I-AL1 derivation ──────────────────────────────────────

interface CallStateForI_AL1 {
  id: string;
  callerId: string;
  transcript: string | null;
  createdAt: Date;
}

async function deriveIAL1Violation(
  call: CallStateForI_AL1,
  observedAt: Date,
): Promise<InvariantViolation | null> {
  const transcriptLength = call.transcript?.length ?? 0;
  if (transcriptLength < I_AL1_TRANSCRIPT_MIN_CHARS) return null;

  // Engine detection — CallScore.scoredBy is the only persisted carrier of
  // the engine identity. Mock writes `mock_batched_v1`; real engines write
  // `${engine}_segment_v1` / `${engine}_batched_v2` where engine ∈
  // {claude, openai}. If we can't classify (no CallScore rows yet, or only
  // ADAPT-stage scores from `adapt_v1`), we err on the side of NOT firing.
  const engine = await classifyCallEngine(call.id);
  if (engine !== "real") return null;

  // Memory writes happen during EXTRACT — bracket by call createdAt.
  const memoriesCreated = await prisma.callerMemory.count({
    where: {
      callerId: call.callerId,
      createdAt: { gte: call.createdAt },
    },
  });

  if (memoriesCreated > 0) return null;

  return {
    invariant: "I-AL1",
    severity: "warn",
    callerId: call.callerId,
    callId: call.id,
    context: {
      transcriptLength,
      memoriesCreated: 0,
      engine: REAL_ENGINE,
      reason: "real-engine call with substantive transcript produced zero CallerMemory rows",
    },
    observedAt,
  };
}

/**
 * Classifies a call by inspecting the `scoredBy` markers on its CallScore rows.
 *
 *   "real"    — at least one EXTRACT/SCORE_AGENT row was written by a non-mock
 *               engine (`claude_*`, `openai_*`, or any non-`mock_*` / non-`adapt_*` prefix)
 *   "mock"    — only mock-prefixed scoredBy rows present
 *   "unknown" — no decisive marker (no CallScore rows at all, or only ADAPT-stage
 *               `adapt_v1` rows). The invariant treats unknown as excluded —
 *               we'd rather under-fire than false-positive on backfilled or
 *               partial-pipeline rows.
 *
 * Defensive — swallows DB errors and returns "unknown".
 */
async function classifyCallEngine(
  callId: string,
): Promise<"real" | "mock" | "unknown"> {
  try {
    const rows = await prisma.callScore.findMany({
      where: { callId },
      select: { scoredBy: true },
      take: 50,
    });
    if (rows.length === 0) return "unknown";

    let hasReal = false;
    let hasMock = false;
    for (const row of rows) {
      const sb = (row.scoredBy ?? "").toLowerCase();
      if (sb.startsWith("mock_")) hasMock = true;
      else if (sb.startsWith("adapt_")) {
        // ADAPT rows are engine-agnostic markers; ignore for classification.
        continue;
      } else if (sb.length > 0) hasReal = true;
    }
    if (hasReal) return "real";
    if (hasMock) return "mock";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ── I-AL2 derivation ──────────────────────────────────────

async function deriveIAL2Violations(
  callerId: string,
  observedAt: Date,
): Promise<InvariantViolation[]> {
  const since = new Date(Date.now() - I_AL2_LOOKBACK_MS);
  const freshCutoff = new Date(observedAt.getTime() - I_AL2_FRESH_WINDOW_MS);

  // Group CallScore by parameterId for this caller in the last 24h. Use raw
  // SQL because Prisma's `groupBy` can't traverse the Call relation cleanly
  // and we need MAX(scoredAt) for the fresh-window check.
  type SkillScoreSummary = {
    parameterId: string;
    callScoreCount: bigint;
    lastScoredAt: Date;
  };

  let summaries: SkillScoreSummary[] = [];
  try {
    summaries = await prisma.$queryRaw<SkillScoreSummary[]>`
      SELECT cs."parameterId" AS "parameterId",
             COUNT(*)::bigint AS "callScoreCount",
             MAX(cs."scoredAt") AS "lastScoredAt"
      FROM "CallScore" cs
      JOIN "Call" c ON c.id = cs."callId"
      WHERE c."callerId" = ${callerId}
        AND cs."parameterId" LIKE 'skill_%'
        AND cs."scoredAt" >= ${since}
      GROUP BY cs."parameterId"
    `;
  } catch {
    // No CallScore rows is the most common error here (schema mismatch in
    // a fresh test DB). Return empty — the invariant means nothing without
    // data to check against.
    return [];
  }

  if (summaries.length === 0) return [];

  const violations: InvariantViolation[] = [];
  for (const row of summaries) {
    // Old CallScore (>6h) — drained or migration window; not a violation.
    if (row.lastScoredAt.getTime() < freshCutoff.getTime()) continue;

    const target = await prisma.callerTarget.findUnique({
      where: {
        callerId_parameterId: {
          callerId,
          parameterId: row.parameterId,
        },
      },
      select: { currentScore: true, lastScoredAt: true },
    });

    if (target?.currentScore !== null && target?.currentScore !== undefined) {
      continue;
    }

    violations.push({
      invariant: "I-AL2",
      severity: "warn",
      callerId,
      parameterId: row.parameterId,
      context: {
        callScoreCount: Number(row.callScoreCount),
        lastCallScoreAt: row.lastScoredAt.toISOString(),
        callerTargetScore: null,
        reason: "skill_* CallScore rows landed in the fresh window but CallerTarget.currentScore is null",
      },
      observedAt,
    });
  }

  return violations;
}

// ── I-AL6 derivation ──────────────────────────────────────

async function deriveIAL6Violation(
  callId: string,
  observedAt: Date,
): Promise<InvariantViolation | null> {
  // Count CallScore rows for this call that landed without an
  // AnalysisSpec lineage. Pre-#1539 this was every row in the system;
  // post-drain it should be zero. The invariant fires on the FIRST
  // unspecced row — one signal per call is enough.
  let unspeccedCount = 0;
  try {
    unspeccedCount = await prisma.callScore.count({
      where: { callId, analysisSpecId: null },
    });
  } catch {
    return null;
  }

  if (unspeccedCount === 0) return null;

  return {
    invariant: "I-AL6",
    severity: DEFAULT_SEVERITY["I-AL6"],
    callId,
    context: {
      unspeccedCallScoreCount: unspeccedCount,
      reason:
        "CallScore row(s) written without analysisSpecId — bypass of the writeCallScore chokepoint (#1539) or unfilled legacy row",
    },
    observedAt,
  };
}

// ── Event tag helper ──────────────────────────────────────

function invariantEventTag(invariant: InvariantId): string {
  switch (invariant) {
    case "I-AL1":
      return "violation";
    case "I-AL2":
      return "violation";
    case "I-AL3":
      return "default-fallback";
    case "I-AL4":
      return "prosody-skipped";
    case "I-AL5":
      return "zero-targets";
    case "I-AL6":
      return "unspecced-callscore";
    case "I-WC1":
      return "writer-completeness";
  }
}

// ── Sibling-slice helpers ─────────────────────────────────

/**
 * I-AL3 emit helper — called by `aggregate-runner.ts` when SKILL_DEFAULTS fires
 * after every override layer has been checked. INFO-only — never blocks.
 *
 * Wired by Slice 3 (#1513). Exposed here so all paths route through the same
 * AppLog stage convention.
 */
export async function recordIAL3DefaultFallback(args: {
  callerId?: string;
  parameterId?: string;
  source: string;
}): Promise<void> {
  await recordInvariantViolation({
    invariant: "I-AL3",
    severity: "info",
    callerId: args.callerId,
    parameterId: args.parameterId,
    context: { source: args.source },
    observedAt: new Date(),
  });
}

/**
 * I-AL4 emit helper — called by `prosody-runner.ts` at each skip site. The
 * `existing-envelope` cache-hit reason emits INFO not WARN (normal operation).
 *
 * Wired by Slice 2 (#1512). Exposed here so the AppLog row shape is identical
 * across slices.
 */
export async function recordIAL4ProsodySkip(args: {
  callId: string;
  callerId?: string;
  reason: "existing-envelope" | "no-stereoUrl" | "no-tierPreset" | "no-provider";
}): Promise<void> {
  const severity: InvariantSeverity =
    args.reason === "existing-envelope" ? "info" : "warn";
  await recordInvariantViolation({
    invariant: "I-AL4",
    severity,
    callId: args.callId,
    callerId: args.callerId,
    context: { reason: args.reason },
    observedAt: new Date(),
  });
}

/**
 * I-AL5 emit helper — called by SCORE_AGENT when BehaviorTarget(scope=PLAYBOOK)
 * returns zero rows. Escalates to ERROR when even SYSTEM defaults are empty
 * (the cascade has no root).
 *
 * Wired by Slice 3 (#1513). Exposed here for consistent AppLog shape.
 */
export async function recordIAL5ZeroTargets(args: {
  playbookId: string;
  callerId?: string;
  callId?: string;
  systemDefaultsEmpty: boolean;
}): Promise<void> {
  const severity: InvariantSeverity = args.systemDefaultsEmpty ? "error" : "warn";
  await recordInvariantViolation({
    invariant: "I-AL5",
    severity,
    callId: args.callId,
    callerId: args.callerId,
    playbookId: args.playbookId,
    context: {
      scope: "PLAYBOOK",
      systemDefaultsEmpty: args.systemDefaultsEmpty,
    },
    observedAt: new Date(),
  });
}

// ── Re-export for the dashboard ───────────────────────────

/**
 * AppLog stage filter used by the dashboard + scanner. Matches every invariant
 * row written via `recordInvariantViolation`.
 */
export const APPLOG_STAGE_FILTER = `${APPLOG_STAGE_PREFIX}.`;

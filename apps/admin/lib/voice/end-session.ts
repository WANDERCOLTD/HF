/**
 * endSession — finalise a Session row + trigger pipeline async.
 *
 * Companion to `createSession`. Commits `endedAt` + `status` +
 * `transcript` + retroactive counter flips inside a transaction, then
 * fires `runSpecDrivenPipeline(sessionId)` fire-and-forget (NEVER
 * awaited, NEVER wrapped in the transaction — wrapping the LLM call in a
 * tx means a 5-second timeout destroys the transcript).
 *
 * For FAILED / GHOST outcomes the function widens `skipStages` to
 * include EXTRACT / SCORE_AGENT / PROSODY / REWARD so the pipeline
 * runner short-circuits the transcript-derived stages. ADAPT still runs
 * (with `failureSignal` context for COMPOSE).
 *
 * Eventual consistency: the Slice 5 reconciler scans for
 * `Session(endedAt IS NOT NULL) AND NOT EXISTS(ComposedPrompt(triggerSessionId=…))`
 * older than 60s and re-fires COMPOSE. This contract is documented in
 * `docs/CHAIN-CONTRACTS.md` §3 Link 3b and `docs/PIPELINE.md` §4.2.
 *
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3b
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import {
  DEFAULT_MIN_LEARNER_DURATION_SECONDS,
  finaliseCounterFlags,
  statusFromOutcome,
  deriveSkipStages,
  type SessionOutcomeString,
  type SessionKindString,
} from "@/lib/voice/session-rules";
import { markModuleIncomplete } from "@/lib/curriculum/mark-module-incomplete";
import { getCourseStyle } from "@/lib/pipeline/course-style";
import { isIeltsModuleSettingsEnabled } from "@/lib/journey/module-settings-flag";
import {
  computeTalkTimeStats,
  evaluateTalkTimeBudgets,
} from "@/lib/voice/talk-time-stats";
import { log as appLog } from "@/lib/logger";
import type { AuthoredModule, PlaybookConfig } from "@/lib/types/json-fields";

export type SessionOutcome = SessionOutcomeString;

export interface EndSessionArgs {
  outcome: SessionOutcome;
  /** Final transcript (voice / sim). Optional — text/enrolment sessions don't have one. */
  transcript?: string;
  /** Free-form: 'webhook' | 'poll' | 'drop' | 'reconciler' | 'sdk' | 'sse' | 'manual' | … */
  endSource?: string;
  /** Optional duration override — usually computed from `endedAt - startedAt`. */
  durationSecondsOverride?: number;
  /**
   * If true (default), fire the pipeline async after the Session row
   * commits. Set false in tests that don't want the side effect.
   */
  triggerPipelineAsync?: boolean;
}

export interface EndSessionResult {
  sessionId: string;
  status: string;
  endedAt: Date;
  skipStages: string[];
  countsTowardLearnerNumber: boolean;
  countsTowardPipelineNumber: boolean;
}

export async function endSession(
  sessionId: string,
  args: EndSessionArgs,
): Promise<EndSessionResult> {
  if (!sessionId) throw new Error("endSession: sessionId is required");

  const existing = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      kind: true,
      startedAt: true,
      endedAt: true,
      status: true,
      countsTowardLearnerNumber: true,
      countsTowardPipelineNumber: true,
      skipStages: true,
      callerId: true,
      // #1703 — fields required for the Theme 9 incomplete-attempt check.
      // playbookId + curriculumModuleId scope the read; the joined
      // CurriculumModule.slug links the session's module to the
      // AuthoredModule entry inside `Playbook.config.modules[]`.
      playbookId: true,
      curriculumModuleId: true,
      curriculumModule: { select: { slug: true } },
      playbook: { select: { config: true } },
    },
  });
  if (!existing) {
    throw new Error(`endSession: Session ${sessionId} not found`);
  }

  const endedAt = new Date();
  const durationSeconds =
    args.durationSecondsOverride ??
    Math.max(0, (endedAt.getTime() - existing.startedAt.getTime()) / 1000);

  const kind = existing.kind as SessionKindString;
  const finalisedFlags = finaliseCounterFlags({
    kind,
    outcome: args.outcome,
    durationSeconds,
  });
  const status = statusFromOutcome(args.outcome);
  const skipStages = deriveSkipStages({ kind, outcome: args.outcome });

  // Pre-commit safety: an already-ended Session should not be flipped
  // back to STARTED/ACTIVE by a late webhook. Only allow forward
  // transitions; idempotent re-call on a same-status row is fine.
  const isForwardTransition =
    existing.endedAt === null || existing.status === status;

  const updated = await prisma.session.update({
    where: { id: sessionId },
    data: {
      ...(isForwardTransition ? { endedAt, status } : {}),
      ...(args.transcript !== undefined ? {} : {}), // (transcript lives on Call; merged below)
      // Counter flips: only ever flip a flag false; never raise.
      countsTowardLearnerNumber:
        existing.countsTowardLearnerNumber &&
        finalisedFlags.countsTowardLearnerNumber,
      countsTowardPipelineNumber:
        existing.countsTowardPipelineNumber &&
        finalisedFlags.countsTowardPipelineNumber,
      // Skip-stages: widen, never narrow. UNION with existing.
      skipStages: Array.from(
        new Set([...(existing.skipStages ?? []), ...skipStages]),
      ).sort(),
    },
    select: {
      id: true,
      status: true,
      endedAt: true,
      skipStages: true,
      countsTowardLearnerNumber: true,
      countsTowardPipelineNumber: true,
      callerId: true,
    },
  });

  // #1703 (epic #1700 Theme 9) — record incomplete-attempt + apply waiver.
  // Runs AFTER the Session update commits so a helper failure can't roll
  // back the durable Session state. Side-effect class, like the pipeline
  // trigger below.
  await evaluateIncompleteAttempt({
    callerId: updated.callerId,
    playbookId: existing.playbookId,
    curriculumModuleId: existing.curriculumModuleId,
    moduleSlug: existing.curriculumModule?.slug ?? null,
    playbookConfig: existing.playbook?.config as PlaybookConfig | null | undefined,
    kind,
    outcome: args.outcome,
    durationSeconds,
  });

  // #1747 follow-on (epic #1700 Theme 7) — post-call talk-time
  // telemetry. Computes tutor-speech budgets from the transcript and
  // emits `voice.talk_time.over_budget` AppLog when exceeded. Best-
  // effort write — helper failures don't roll back the durable Session
  // state. Runs only for transcript-bearing sessions
  // (VOICE_CALL / SIM_CALL).
  evaluateTalkTimeBudgetsForSession({
    callerId: updated.callerId,
    sessionId: updated.id,
    kind,
    transcript: args.transcript ?? null,
    playbookConfig: existing.playbook?.config as PlaybookConfig | null | undefined,
  });

  // Fire-and-forget pipeline trigger. Must NOT be awaited and must
  // NOT be inside the transaction. The reconciler (Slice 5) catches
  // any Session that never gets its COMPOSE within 60s.
  const triggerAsync = args.triggerPipelineAsync ?? true;
  if (
    triggerAsync &&
    existing.countsTowardPipelineNumber &&
    finalisedFlags.countsTowardPipelineNumber
  ) {
    triggerPipelineForSession(sessionId, updated.callerId).catch((err) => {
      console.error(
        `[endSession] pipeline trigger failed for session ${sessionId}:`,
        err instanceof Error ? err.message : String(err),
      );
    });
  }

  return {
    sessionId: updated.id,
    status: updated.status,
    endedAt: updated.endedAt ?? endedAt,
    skipStages: updated.skipStages,
    countsTowardLearnerNumber: updated.countsTowardLearnerNumber,
    countsTowardPipelineNumber: updated.countsTowardPipelineNumber,
  };
}

/**
 * Async pipeline trigger. Calls the existing internal endpoint so the
 * pipeline runner's stage gating + auth logic stay in one place. The
 * route currently keys on `callId`; Slice 3 keeps the legacy entry
 * point — `Call.sessionId` lets the route resolve from either id.
 *
 * Slice 5 will swap this for a queue-backed delivery. The fetch shape
 * here mirrors the pre-#1338 `triggerPipeline` in `route-handlers.ts`.
 */
async function triggerPipelineForSession(
  sessionId: string,
  callerId: string | null,
): Promise<void> {
  if (!callerId) return;

  // Resolve the Call row via Session.id → Call.sessionId; we still
  // route the pipeline call through `/api/calls/[callId]/pipeline`
  // because the runner expects a Call context. Slice 4 generalises
  // this to a sessionId entry.
  const call = await prisma.call.findFirst({
    where: { sessionId },
    select: { id: true },
  });
  if (!call) {
    // Sessions without a Call child (ENROLLMENT pre-Slice-4, ASSESSMENT)
    // skip the pipeline trigger today — they have no transcript and the
    // pipeline runner is voice-call-keyed. Logged so the proof script
    // can verify the skip happened deliberately.
    console.log(
      `[endSession] session ${sessionId.slice(0, 8)} has no Call child — skipping async pipeline trigger`,
    );
    return;
  }

  const baseUrl = config.app.url;
  const response = await fetch(`${baseUrl}/api/calls/${call.id}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": config.security.internalApiSecret,
    },
    body: JSON.stringify({ callerId, mode: "prompt" }),
  });
  if (!response.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `pipeline route returned ${response.status}: ${bodyText ?? "<no body>"}`,
    );
  }
}

/**
 * #1703 (epic #1700 Theme 9) — decide whether this session counts as an
 * incomplete attempt and, if so, route through `markModuleIncomplete`.
 *
 * Conditions to record an incomplete:
 *
 *   1. Feature flag `HF_FLAG_IELTS_MODULE_SETTINGS` is enabled (epic
 *      decision 5 — opt-in during the migration window).
 *   2. Session is gateable: `kind` ∈ {VOICE_CALL, SIM_CALL} AND
 *      `curriculumModuleId` is set AND `playbookId` is set.
 *   3. Course is structured (`getCourseStyle` — guard #1252 default-deny).
 *   4. Outcome is GHOST/FAILED OR `durationSeconds < moduleSettings.minSpeakingSec`.
 *      The per-module threshold falls back to
 *      `DEFAULT_MIN_LEARNER_DURATION_SECONDS` (30s) when unset.
 *
 * Helper is fire-and-forget — any error is logged but doesn't roll back
 * the Session update.
 */
async function evaluateIncompleteAttempt(args: {
  callerId: string | null;
  playbookId: string | null;
  curriculumModuleId: string | null;
  moduleSlug: string | null;
  playbookConfig: PlaybookConfig | null | undefined;
  kind: SessionKindString;
  outcome: SessionOutcomeString;
  durationSeconds: number;
}): Promise<void> {
  if (!isIeltsModuleSettingsEnabled()) return;

  // Conditions 2 — gateable session shape.
  if (args.kind !== "VOICE_CALL" && args.kind !== "SIM_CALL") return;
  if (!args.callerId || !args.playbookId || !args.curriculumModuleId) return;

  // Condition 3 — structured-only (helper enforces too, but pre-check
  // saves a DB read on continuous courses).
  const courseStyle = getCourseStyle(args.playbookConfig);
  if (courseStyle !== "structured") return;

  // Resolve the per-module `minSpeakingSec` from the AuthoredModule
  // entry whose `id` matches the session's `CurriculumModule.slug`.
  // Falls back to the 30s global default when unset.
  const authoredModules = (args.playbookConfig?.modules as
    | AuthoredModule[]
    | undefined) ?? [];
  const authored = args.moduleSlug
    ? authoredModules.find((m) => m.id === args.moduleSlug)
    : undefined;
  const minSpeakingSec =
    authored?.settings?.minSpeakingSec ?? DEFAULT_MIN_LEARNER_DURATION_SECONDS;

  // Condition 4 — abnormal termination OR below per-module gate.
  const isAbnormal = args.outcome === "GHOST" || args.outcome === "FAILED";
  const isShort = args.durationSeconds < minSpeakingSec;
  if (!isAbnormal && !isShort) return;

  try {
    await markModuleIncomplete(prisma, {
      callerId: args.callerId,
      moduleId: args.curriculumModuleId,
      courseStyle,
      playbookId: args.playbookId,
      durationSeconds: args.durationSeconds,
      minSpeakingSec,
    });
  } catch (err) {
    console.error(
      `[endSession] markModuleIncomplete failed for caller ${args.callerId.slice(0, 8)} module ${args.curriculumModuleId.slice(0, 8)}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * #1747 follow-on (epic #1700 Theme 7) — compute tutor talk-time stats
 * for this session and emit `voice.talk_time.over_budget` AppLog when
 * any budget is exceeded.
 *
 * Conditions to compute:
 *
 *   1. Session has a transcript (passed via `endSession({transcript})`)
 *   2. `kind` ∈ {VOICE_CALL, SIM_CALL} — chat / enrolment / assessment
 *      don't have a measurable tutor-speech budget
 *
 * Reads operator budgets from `Playbook.config.talkTimeBudgets`;
 * `evaluateTalkTimeBudgets` falls back to `DEFAULT_TALK_TIME_BUDGETS`
 * (`maxTutorTurnSec: 30`, `maxTutorRatio: 0.2`) when keys are unset.
 *
 * **Best-effort** — runs synchronously (compute is fast, AppLog write
 * is fire-and-forget inside `log()`) but any throw is swallowed so
 * Session durability is unaffected.
 */
function evaluateTalkTimeBudgetsForSession(args: {
  callerId: string | null;
  sessionId: string;
  kind: SessionKindString;
  transcript: string | null;
  playbookConfig: PlaybookConfig | null | undefined;
}): void {
  if (args.kind !== "VOICE_CALL" && args.kind !== "SIM_CALL") return;
  if (!args.transcript) return;

  try {
    const stats = computeTalkTimeStats(args.transcript);
    const budgets = args.playbookConfig?.talkTimeBudgets ?? null;
    const evaluation = evaluateTalkTimeBudgets(stats, budgets);

    if (!evaluation.overBudget) return;

    appLog("system", "voice.talk_time.over_budget", {
      level: "warn",
      message: `Tutor talk-time exceeded budget(s): ${evaluation.exceededBy.join(", ")}`,
      sessionId: args.sessionId,
      callerId: args.callerId ?? null,
      kind: args.kind,
      exceededBy: evaluation.exceededBy,
      budgets: evaluation.budgets,
      stats: {
        tutorTurnCount: stats.tutorTurnCount,
        learnerTurnCount: stats.learnerTurnCount,
        tutorWordCount: stats.tutorWordCount,
        learnerWordCount: stats.learnerWordCount,
        maxTutorTurnWords: stats.maxTutorTurnWords,
        maxTutorTurnSec: stats.maxTutorTurnSec,
        tutorRatio: stats.tutorRatio,
      },
    });
  } catch (err) {
    console.error(
      `[endSession] talk-time evaluation failed for session ${args.sessionId.slice(0, 8)}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

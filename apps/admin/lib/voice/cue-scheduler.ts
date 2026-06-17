/**
 * Cue scheduler — restart-safe orchestrator for `VoiceProvider.sayMessage()`
 * (#1742).
 *
 * Responsibilities:
 *
 *   1. **`scheduleCue`** — persist a `CueScheduleEntry` row pinned to an
 *      `externalCallId` + `scheduledFor` timestamp. Callable from anywhere
 *      (e.g. Theme 2b's session-start path registers Part 2 cues from
 *      `moduleScheduledCues`).
 *   2. **`cancelCuesForCall`** — mark every pending cue for an
 *      `externalCallId` as cancelled. Called at end-of-call.
 *   3. **`drainDueCues`** — pull every row where `scheduledFor <= NOW()`,
 *      `status === "pending"`, dispatch each via the matching adapter's
 *      `sayMessage()`, stamp `firedAt` + `status`. Designed to be called
 *      from a short-interval tick loop (production runner) OR directly
 *      from tests.
 *
 * Restart safety: rows live in the DB, not in memory. A server restart
 * between `scheduleCue` and `scheduledFor` does not lose the cue — the
 * tick loop picks it up on resume.
 *
 * Tick interval: production runner ticks at 100ms (configurable). Combined
 * with the VAPI control-URL POST latency (~50–150ms), this gives a ±200ms
 * p99 budget. See ADR.
 *
 * Capability-flag gate: providers that declare
 * `getCapabilities().supportsProactiveSpeech === false` (e.g. Retell
 * pre-LLM-WSS-handler) skip with `status: "skipped"` and emit
 * `voice.cue_scheduler.skipped_no_capability` AppLog instead of failing.
 *
 * See docs/decisions/2026-06-16-voice-say-message-primitive.md.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import { getVoiceProvider } from "./provider-factory";
import { appendPhaseTransition } from "./phase-boundaries";
import type { SayMessageOptions } from "./types";

const CUE_STATUS = {
  pending: "pending",
  fired: "fired",
  failed: "failed",
  cancelled: "cancelled",
  skipped: "skipped",
} as const;

export type CueStatus = (typeof CUE_STATUS)[keyof typeof CUE_STATUS];

export interface ScheduleCueArgs {
  externalCallId: string;
  callId?: string | null;
  scheduledFor: Date;
  content: string;
  noInterruption?: boolean;
  queueOnly?: boolean;
  traceId?: string;
  /**
   * #1762 Story C — when set, dispatching this cue records a phase
   * transition in `Session.metadata.phaseBoundaries` via
   * `appendPhaseTransition`. Non-empty string is treated as the phase
   * name; falsy / missing means "no phase boundary side-effect".
   */
  phase?: string;
}

export interface ScheduledCue {
  id: string;
  externalCallId: string;
  callId: string | null;
  scheduledFor: Date;
  content: string;
  status: CueStatus;
}

/**
 * Persist a new cue. Returns the created row's id so callers can hold it
 * for individual cancellation.
 */
export async function scheduleCue(args: ScheduleCueArgs): Promise<ScheduledCue> {
  if (!args.externalCallId) {
    throw new Error("scheduleCue: externalCallId is required");
  }
  if (!args.content || typeof args.content !== "string") {
    throw new Error("scheduleCue: content must be a non-empty string");
  }
  const row = await prisma.cueScheduleEntry.create({
    data: {
      externalCallId: args.externalCallId,
      callId: args.callId ?? null,
      scheduledFor: args.scheduledFor,
      content: args.content,
      options: serialiseOptions(args) as Prisma.InputJsonValue,
      status: CUE_STATUS.pending,
      traceId: args.traceId ?? null,
    },
    select: {
      id: true,
      externalCallId: true,
      callId: true,
      scheduledFor: true,
      content: true,
      status: true,
    },
  });
  log("system", "voice.cue_scheduler.registered", {
    externalCallId: args.externalCallId,
    cueId: row.id,
    scheduledFor: args.scheduledFor.toISOString(),
    traceId: args.traceId,
  });
  return { ...row, status: row.status as CueStatus };
}

/**
 * Mark every pending cue for a call as cancelled. Idempotent: cues
 * already in a terminal state are left alone.
 */
export async function cancelCuesForCall(externalCallId: string): Promise<number> {
  const result = await prisma.cueScheduleEntry.updateMany({
    where: { externalCallId, status: CUE_STATUS.pending },
    data: { status: CUE_STATUS.cancelled, cancelledAt: new Date() },
  });
  if (result.count > 0) {
    log("system", "voice.cue_scheduler.cancelled", {
      externalCallId,
      count: result.count,
    });
  }
  return result.count;
}

export interface DrainDueCuesOptions {
  /** Provider slug → instance lookup. Defaults to the production factory;
   *  tests inject a deterministic stub. */
  getProvider?: (slug: string) => Promise<{
    slug: string;
    getCapabilities: () => { supportsProactiveSpeech: boolean };
    sayMessage?: (
      externalCallId: string,
      options: SayMessageOptions,
    ) => Promise<{ status: "spoken" | "queued" | "skipped" | "failed" }>;
  } | null>;
  /** Override "now" for tests. Defaults to `new Date()`. */
  now?: () => Date;
  /** Per-tick batch cap — prevents one tick from dispatching thousands of
   *  cues in pathological cases. Default 32. */
  batchLimit?: number;
  /**
   * For multi-provider routing: rows store `externalCallId` but not the
   * provider slug. Resolve it from `Call.source` via the local DB. The
   * caller can override (tests) to bypass the DB.
   */
  resolveSlug?: (externalCallId: string) => Promise<string | null>;
}

interface DrainResult {
  fired: number;
  failed: number;
  skipped: number;
}

/**
 * Drain every pending cue whose `scheduledFor` is in the past. Returns
 * a count breakdown by terminal status.
 */
export async function drainDueCues(
  options: DrainDueCuesOptions = {},
): Promise<DrainResult> {
  const now = (options.now ?? (() => new Date()))();
  const batchLimit = options.batchLimit ?? 32;
  const getProvider = options.getProvider ?? defaultGetProvider;
  const resolveSlug = options.resolveSlug ?? defaultResolveSlug;

  const dueRows = await prisma.cueScheduleEntry.findMany({
    where: { status: CUE_STATUS.pending, scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: batchLimit,
  });

  let fired = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of dueRows) {
    const slug = await resolveSlug(row.externalCallId);
    if (!slug) {
      await markCueTerminal(row.id, CUE_STATUS.skipped, "no_call_row");
      skipped += 1;
      continue;
    }

    const provider = await getProvider(slug);
    if (!provider) {
      await markCueTerminal(row.id, CUE_STATUS.skipped, "no_provider");
      skipped += 1;
      continue;
    }

    const caps = provider.getCapabilities();
    if (!caps.supportsProactiveSpeech || !provider.sayMessage) {
      log("system", "voice.cue_scheduler.skipped_no_capability", {
        externalCallId: row.externalCallId,
        cueId: row.id,
        slug,
      });
      await markCueTerminal(row.id, CUE_STATUS.skipped, "no_capability");
      skipped += 1;
      continue;
    }

    const opts = deserialiseOptions(row.options, row.content, row.traceId);
    const result = await provider.sayMessage(row.externalCallId, opts);

    if (result.status === "spoken" || result.status === "queued") {
      const lagMs = now.getTime() - row.scheduledFor.getTime();
      if (lagMs > 500) {
        log("system", "voice.cue_scheduler.late", {
          externalCallId: row.externalCallId,
          cueId: row.id,
          lagMs,
        });
      }
      log("system", "voice.cue_scheduler.fired", {
        externalCallId: row.externalCallId,
        cueId: row.id,
        slug,
        outcome: result.status,
      });
      await markCueTerminal(row.id, CUE_STATUS.fired, result.status);
      // #1762 Story C — phase-boundary side-effect. Only fires for
      // cues that carry a `phase` tag; speech-only cues stay zero-cost.
      // Helper catches its own errors + logs; we await it so the loop
      // is deterministic for tests, but we NEVER throw out of this
      // block on persistence failure (the helper returns false, we
      // continue the drain).
      const phase = extractPhase(row.options);
      if (phase && row.callId) {
        await tryPersistPhaseBoundary({
          callId: row.callId,
          phase,
          scheduledFor: row.scheduledFor,
        });
      }
      fired += 1;
    } else if (result.status === "skipped") {
      await markCueTerminal(row.id, CUE_STATUS.skipped, "provider_skipped");
      skipped += 1;
    } else {
      await markCueTerminal(row.id, CUE_STATUS.failed, "provider_failed");
      failed += 1;
    }
  }

  return { fired, failed, skipped };
}

async function markCueTerminal(
  id: string,
  status: CueStatus,
  reason: string,
): Promise<void> {
  const now = new Date();
  await prisma.cueScheduleEntry.update({
    where: { id },
    data: {
      status,
      firedAt: status === CUE_STATUS.fired ? now : undefined,
      cancelledAt: status === CUE_STATUS.cancelled ? now : undefined,
    },
  });
  if (status !== CUE_STATUS.fired) {
    log("system", `voice.cue_scheduler.${status}`, {
      cueId: id,
      reason,
    });
  }
}

async function defaultResolveSlug(externalCallId: string): Promise<string | null> {
  const row = await prisma.call.findFirst({
    where: { externalId: externalCallId },
    select: { source: true },
  });
  return row?.source ?? null;
}

async function defaultGetProvider(slug: string) {
  try {
    const provider = await getVoiceProvider(slug);
    return provider;
  } catch {
    return null;
  }
}

function serialiseOptions(args: ScheduleCueArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (args.noInterruption !== undefined) out.noInterruption = args.noInterruption;
  if (args.queueOnly !== undefined) out.queueOnly = args.queueOnly;
  if (args.traceId !== undefined) out.traceId = args.traceId;
  if (typeof args.phase === "string" && args.phase.trim().length > 0) {
    out.phase = args.phase;
  }
  return out;
}

/**
 * Extract the optional phase tag from a persisted cue's options blob.
 * Returns null when the row carries no phase (the normal speech-only
 * case).
 */
function extractPhase(options: unknown): string | null {
  if (!options || typeof options !== "object") return null;
  const phase = (options as Record<string, unknown>).phase;
  if (typeof phase !== "string" || phase.trim().length === 0) return null;
  return phase;
}

/**
 * #1762 Story C — best-effort phase-boundary persistence. Looks up
 * the Session attached to the Call (Call.sessionId, from epic #1338
 * Session model), computes `startSec` from
 * `(scheduledFor - Session.startedAt) / 1000`, and appends. Failures
 * are caught + logged inside `appendPhaseTransition`; this wrapper
 * adds a second guard to swallow lookup errors (e.g. Call row gone)
 * so the cue-scheduler drain loop is never derailed.
 */
async function tryPersistPhaseBoundary(args: {
  callId: string;
  phase: string;
  scheduledFor: Date;
}): Promise<void> {
  try {
    const call = await prisma.call.findUnique({
      where: { id: args.callId },
      select: {
        sessionId: true,
        session: { select: { startedAt: true } },
      },
    });
    if (!call?.sessionId || !call.session) {
      log("system", "voice.cue.phase_boundary_persist_failed", {
        level: "warn",
        callId: args.callId,
        phase: args.phase,
        reason: "no_session_for_call",
      });
      return;
    }
    const startedAtMs = call.session.startedAt.getTime();
    const scheduledMs = args.scheduledFor.getTime();
    const startSec = Math.max(0, (scheduledMs - startedAtMs) / 1000);
    await appendPhaseTransition(call.sessionId, {
      phase: args.phase,
      startSec,
      // Open boundary — the NEXT phase-tagged cue closes it.
      endSec: startSec,
    });
  } catch (err) {
    log("system", "voice.cue.phase_boundary_persist_failed", {
      level: "warn",
      callId: args.callId,
      phase: args.phase,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function deserialiseOptions(
  options: unknown,
  content: string,
  traceId: string | null,
): SayMessageOptions {
  const raw = (options ?? {}) as Record<string, unknown>;
  return {
    content,
    noInterruption: typeof raw.noInterruption === "boolean" ? raw.noInterruption : undefined,
    queueOnly: typeof raw.queueOnly === "boolean" ? raw.queueOnly : undefined,
    traceId: traceId ?? undefined,
  };
}

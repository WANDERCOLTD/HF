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
  return out;
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

/**
 * createSession — canonical builder for every learner Session row.
 *
 * Single chokepoint for the unified Session model shipped in epic #1338.
 * Every code path that records a learner interaction (voice call, sim,
 * text chat, enrolment intake, assessment) routes through here so:
 *
 *   - `sequenceNumber` is race-safe (atomic UPDATE on
 *     `CallerSequenceCounter`, row-level lock serialises concurrent
 *     webhooks),
 *   - voice config is snapshotted at session-start (forensics +
 *     reproducibility — live config can drift),
 *   - carry-through prompt (`usedPromptId`) follows the I-CT2 cascade,
 *   - sim drops do not inflate the learner-facing `(call #N)` counter,
 *   - FAILED / GHOST sessions carry `skipStages` for the pipeline
 *     router to read.
 *
 * The companion `endSession` finaliser commits `endedAt` + `status` +
 * fires the pipeline async (fire-and-forget — Slice 5 reconciler
 * enforces eventual consistency).
 *
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3b (Session boundary, I-CT1 +
 *      I-CT2 invariants)
 * @see github.com/.../issues/1338 (epic)
 * @see github.com/.../issues/1342 (this slice)
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { resolveActivePlaybookId } from "@/lib/caller/resolve-active-playbook";
import {
  resolveCurriculumIdForPlaybook,
  resolveModuleByLogicalId,
} from "@/lib/curriculum/resolve-module";
import { resolveDefaultModuleForCaller } from "@/lib/curriculum/resolve-default-module";
import { loadResolvedVoiceConfig } from "@/lib/voice/load-voice-config";
import { resolveUsedPromptId } from "@/lib/voice/resolve-used-prompt";
import {
  initialCounterFlags,
  deriveSkipStages,
  type SessionKindString,
} from "@/lib/voice/session-rules";

export type SessionKind = SessionKindString;

export interface CreateSessionArgs {
  callerId: string;
  kind: SessionKind;
  /** Free-form source tag (e.g. `vapi`, `webrtc`, `sim`, `harness`). */
  source?: string;
  /** Provider slug. NULL for non-voice sessions. */
  voiceProvider?: string | null;
  /** Explicit module pick from picker / URL. Wins over `Caller.lastSelectedModuleId`. */
  requestedModuleId?: string;
  /** ENROLLMENT only — links the new Session to its IntakeEvent chain. */
  intentId?: string;
}

export interface CreateSessionResult {
  session: {
    id: string;
    sequenceNumber: number;
    learnerFacingNumber: number | null;
    kind: SessionKind;
  };
  playbookId: string | null;
  requestedModuleId: string | null;
  curriculumModuleId: string | null;
  usedPromptId: string | null;
  voiceConfigSnapshot: Prisma.JsonValue | null;
  countsTowardLearnerNumber: boolean;
  countsTowardPipelineNumber: boolean;
  skipStages: string[];
}

const LEARNER_FACING_COUNTER_KIND = "learnerFacing";

/**
 * Resolve every FK + counter, then write the Session row inside a
 * single `$transaction`. The transaction holds for the duration of the
 * counter UPDATE → INSERT chain — no external I/O inside.
 *
 * The voice-config snapshot and used-prompt cascade are computed OUTSIDE
 * the transaction (read-only Prisma queries; safe to run concurrently
 * with the eventual write).
 */
export async function createSession(
  args: CreateSessionArgs,
): Promise<CreateSessionResult> {
  if (!args.callerId) {
    throw new Error("createSession: callerId is required");
  }

  // Pre-transaction resolution — none of these are racing the counter
  // update; they read snapshots and pure config.

  // (1) Playbook attribution — nullable; ENROLLMENT may precede.
  const playbookId = await resolveActivePlaybookId(args.callerId);

  // (2) Module hint cascade.
  let requestedModuleId: string | null = args.requestedModuleId ?? null;
  if (!requestedModuleId) {
    const caller = await prisma.caller.findUnique({
      where: { id: args.callerId },
      select: { lastSelectedModuleId: true },
    });
    if (caller?.lastSelectedModuleId) {
      requestedModuleId = caller.lastSelectedModuleId;
    }
  }

  // (3) CurriculumModule FK resolution. AI-to-db-guard: ALWAYS scope by
  // curriculumId before any slug lookup. Slugs are per-curriculum unique,
  // not global (#407).
  let curriculumModuleId: string | null = null;
  let resolvedRequestedSlug: string | null = requestedModuleId;
  if (playbookId) {
    const curriculumId = await resolveCurriculumIdForPlaybook(playbookId);
    if (curriculumId && requestedModuleId) {
      const mod = await resolveModuleByLogicalId(curriculumId, requestedModuleId);
      if (mod) curriculumModuleId = mod.id;
    }
    if (!curriculumModuleId) {
      const fallback = await resolveDefaultModuleForCaller(args.callerId, playbookId);
      if (fallback) {
        curriculumModuleId = fallback.curriculumModuleId;
        if (!resolvedRequestedSlug) resolvedRequestedSlug = fallback.moduleSlug;
      }
    }
  }

  // (4) usedPromptId — I-CT2 cascade. May be null on a brand-new caller.
  const promptResolution = await resolveUsedPromptId({ callerId: args.callerId });

  // (5) voiceConfigSnapshot — only meaningful for VOICE_CALL / SIM_CALL.
  //     Snapshot, not embed: stored as Json so the live config can drift.
  let voiceConfigSnapshot: Prisma.JsonValue | null = null;
  if (args.kind === "VOICE_CALL" || args.kind === "SIM_CALL") {
    try {
      const resolved = await loadResolvedVoiceConfig({
        callerId: args.callerId,
        playbookId,
      });
      voiceConfigSnapshot = resolved as unknown as Prisma.JsonValue;
    } catch (err) {
      // Voice config resolution is best-effort. If the provider config
      // is broken at start-time we still want the Session row to land —
      // the missing snapshot will show up in the proof script.
      console.warn(
        `[createSession] voice-config snapshot failed for caller=${args.callerId.slice(0, 8)}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const initial = initialCounterFlags(args.kind);
  const skipStages = deriveSkipStages({ kind: args.kind });

  // Transactional write — counter increment + (optional) learner-facing
  // counter + Session insert.
  return await prisma.$transaction(async (tx) => {
    // Per-(callerId, kind) sequence assignment. Postgres row-level lock
    // on the counter row serialises concurrent webhooks; the
    // `UPDATE ... RETURNING` pattern returns the assigned value
    // atomically.
    //
    // Upsert flow: try update first, fall back to create when no row
    // yet exists. Same pattern as ensure-primary-playbook-link.ts —
    // idempotent and concurrency-safe (Prisma's upsert wraps an
    // `INSERT ... ON CONFLICT DO UPDATE` via the unique key).
    const counter = await tx.callerSequenceCounter.upsert({
      where: { callerId_kind: { callerId: args.callerId, kind: args.kind } },
      create: { callerId: args.callerId, kind: args.kind, nextSeq: 2 },
      update: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    });
    // Returned `nextSeq` is the POST-increment value. The Session row
    // takes the PRE-increment value. For brand-new counters created in
    // this same call the `create` branch wrote nextSeq=2 (next caller
    // gets 2; this session is 1).
    const assignedSeq = counter.nextSeq - 1;

    // Per-caller learner-facing counter. ONLY incremented when the
    // session class qualifies (`countsTowardLearnerNumber`). Separate
    // CallerSequenceCounter row keyed on (callerId, 'learnerFacing').
    let learnerFacingNumber: number | null = null;
    if (initial.countsTowardLearnerNumber) {
      const lf = await tx.callerSequenceCounter.upsert({
        where: {
          callerId_kind: {
            callerId: args.callerId,
            kind: LEARNER_FACING_COUNTER_KIND,
          },
        },
        create: {
          callerId: args.callerId,
          kind: LEARNER_FACING_COUNTER_KIND,
          nextSeq: 2,
        },
        update: { nextSeq: { increment: 1 } },
        select: { nextSeq: true },
      });
      learnerFacingNumber = lf.nextSeq - 1;
    }

    const session = await tx.session.create({
      data: {
        callerId: args.callerId,
        kind: args.kind,
        sequenceNumber: assignedSeq,
        learnerFacingNumber,
        countsTowardLearnerNumber: initial.countsTowardLearnerNumber,
        countsTowardPipelineNumber: initial.countsTowardPipelineNumber,
        skipStages,
        status: "STARTED",
        ...(playbookId ? { playbookId } : {}),
        ...(resolvedRequestedSlug ? { requestedModuleId: resolvedRequestedSlug } : {}),
        ...(curriculumModuleId ? { curriculumModuleId } : {}),
        ...(args.voiceProvider !== undefined && args.voiceProvider !== null
          ? { voiceProvider: args.voiceProvider }
          : {}),
        ...(args.intentId ? { intentId: args.intentId } : {}),
        ...(voiceConfigSnapshot !== null
          ? { voiceConfigSnapshot: voiceConfigSnapshot as Prisma.InputJsonValue }
          : {}),
        ...(promptResolution.usedPromptId
          ? { usedPromptId: promptResolution.usedPromptId }
          : {}),
      },
      select: {
        id: true,
        sequenceNumber: true,
        learnerFacingNumber: true,
        kind: true,
      },
    });

    return {
      session: {
        id: session.id,
        sequenceNumber: session.sequenceNumber,
        learnerFacingNumber: session.learnerFacingNumber,
        kind: session.kind as SessionKind,
      },
      playbookId,
      requestedModuleId: resolvedRequestedSlug,
      curriculumModuleId,
      usedPromptId: promptResolution.usedPromptId,
      voiceConfigSnapshot,
      countsTowardLearnerNumber: initial.countsTowardLearnerNumber,
      countsTowardPipelineNumber: initial.countsTowardPipelineNumber,
      skipStages,
    };
  });
}

/**
 * Phase-boundary persistence helper (#1762 Story C).
 *
 * Persists phase transitions into `Session.metadata.phaseBoundaries` as
 * an append-only list of `{phase, startSec, endSec}` rows. Reader:
 * `lib/voice/audio-slice.ts` (Story D) uses the boundaries to pick
 * start/end timestamps for an audio slice.
 *
 * Boundary semantics:
 *   - First call writes `[{phase: P1, startSec: T1, endSec: T1}]` —
 *     `endSec === startSec` signals an **open** boundary (phase still
 *     in flight).
 *   - Second call (different phase) closes the previous boundary by
 *     setting its `endSec` to the new `startSec`, then appends the new
 *     open boundary.
 *   - A second call with the SAME phase name as the last open boundary
 *     is a no-op (idempotent — duplicate webhook delivery / re-fired
 *     cue won't double-close or duplicate the row).
 *
 * Lattice survey notes — `Session.metadata` siblings:
 *   - `pinnedCard` (Theme 3 / `create-session.ts:241`) — written ONCE at
 *     session-start; not racing with us.
 *   - `segmentLabels` (Theme 6) — written by compose/section-loaders.
 *   - `scoreDeltas`, `overallBand` (Theme 11) — written by pipeline
 *     post-write.
 *   None overlap with our `phaseBoundaries` key. We always merge into
 *   the existing object — never replace.
 *
 * Concurrency: the helper is best-effort. Two concurrent cue-fires
 * could observe the same `metadata` snapshot and race; the second
 * write wins and may drop one boundary. This is acceptable for Story
 * C — audio slicing is forensic, not runtime-critical. A future hard
 * variant would use a `WHERE jsonb @> '{boundariesVersion: N}'`
 * row-lock; out of scope today.
 *
 * Error handling: prisma failures are caught + logged via AppLog
 * subject `voice.cue.phase_boundary_persist_failed`. Caller (the
 * cue-scheduler drain loop) keeps running.
 *
 * See `docs/decisions/2026-06-16-voice-say-message-primitive.md` for
 * the parent ADR and `lib/voice/transcript-detailed.ts` for the Story
 * B sibling `{startSec, endSec}` shape.
 */

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/logger";
import type { PhaseBoundary, SessionMetadata } from "@/lib/types/json-fields";

export interface AppendPhaseTransitionArgs {
  /** Required — non-empty phase name (e.g. `"p1"`, `"p2_prep"`). */
  phase: string;
  /** Seconds from session start. Non-negative finite number. */
  startSec: number;
  /**
   * Seconds from session start for the END of the new phase. When
   * unknown at append time, callers pass the same value as `startSec`
   * (open boundary — to be closed by the next transition).
   */
  endSec: number;
}

/**
 * Append a phase transition to `Session.metadata.phaseBoundaries`.
 *
 * Returns `true` when the metadata was written (or the call was a
 * no-op same-phase idempotence absorption — both signal "we handled
 * it without error"). Returns `false` when validation or persistence
 * failed; the cue-scheduler MUST NOT throw on a false return.
 */
export async function appendPhaseTransition(
  sessionId: string,
  args: AppendPhaseTransitionArgs,
): Promise<boolean> {
  // Conservative input validation. The cue-scheduler calls us with
  // values it stitched from JSON columns + wall-clock arithmetic —
  // garbage in must not corrupt the metadata bag.
  if (!sessionId || typeof sessionId !== "string") return false;
  if (!args.phase || typeof args.phase !== "string" || args.phase.trim().length === 0) {
    return false;
  }
  if (typeof args.startSec !== "number" || !Number.isFinite(args.startSec) || args.startSec < 0) {
    return false;
  }
  if (typeof args.endSec !== "number" || !Number.isFinite(args.endSec) || args.endSec < args.startSec) {
    return false;
  }

  try {
    const row = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    if (!row) {
      log("system", "voice.cue.phase_boundary_persist_failed", {
        level: "warn",
        sessionId,
        reason: "session_not_found",
      });
      return false;
    }

    const existing = (row.metadata ?? {}) as SessionMetadata;
    const boundaries: PhaseBoundary[] = Array.isArray(existing.phaseBoundaries)
      ? [...existing.phaseBoundaries]
      : [];
    const last = boundaries.length > 0 ? boundaries[boundaries.length - 1] : null;

    // Idempotence: re-firing the same phase doesn't double-append.
    // The cue-scheduler's at-least-once dispatch (combined with the
    // cue-scheduler-runner overlap guard) can re-enter this helper
    // for the same logical transition.
    if (last && last.phase === args.phase) {
      return true;
    }

    // Close the previous open boundary by stamping its endSec at the
    // new boundary's startSec. The previous row's startSec is
    // preserved.
    if (last) {
      boundaries[boundaries.length - 1] = {
        ...last,
        endSec: args.startSec,
      };
    }

    boundaries.push({
      phase: args.phase,
      startSec: args.startSec,
      endSec: args.endSec,
    });

    const nextMetadata: SessionMetadata = {
      ...existing,
      phaseBoundaries: boundaries,
    };

    await prisma.session.update({
      where: { id: sessionId },
      // Cast: the SessionMetadata interface is structural; Prisma's
      // generated Json type accepts plain objects but TS doesn't
      // recognise our SessionMetadata as a structural subtype until
      // the generated client is regenerated. Same pattern as
      // create-session.ts:241.
      data: { metadata: nextMetadata as unknown as object },
    });

    return true;
  } catch (err) {
    log("system", "voice.cue.phase_boundary_persist_failed", {
      level: "warn",
      sessionId,
      phase: args.phase,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

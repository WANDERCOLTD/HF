/**
 * Pure rules for Session classification (epic #1338 §"Two counters with
 * explicit rules"). All inputs in, all outputs out — no Prisma, no I/O.
 *
 * These exist so the `createSession` builder, the `endSession` finaliser,
 * and the future Slice 4 compose-header reader all agree on what counts.
 * If a routing rule changes, edit it here once.
 *
 * Class-rule table (mirrors epic body):
 *
 *   | kind / status              | learnerFacing | pipeline |
 *   |----------------------------|---------------|----------|
 *   | VOICE_CALL ≥ 30s           | true          | true     |
 *   | VOICE_CALL < 30s           | false         | true     |
 *   | SIM_CALL drop (<30s)       | false         | true     |
 *   | SIM_CALL completed         | false         | true     | (sim is a harness)
 *   | Session(status=GHOST)      | false         | false    |
 *   | ENROLLMENT                 | false         | true     |
 *   | ASSESSMENT                 | false         | true     |
 *   | TEXT_CHAT                  | false         | true     |
 *   | Aborted < 30s (any kind)   | false         | true     |
 *
 * At session-start time the duration is unknown — we set provisional
 * counters from `kind` alone, and the `endSession` finaliser may flip
 * `countsTowardLearnerNumber` to false retroactively when:
 *
 *   - outcome === GHOST  (status flips to GHOST, both counters → false)
 *   - duration < minDurationForLearnerCountSeconds (learner flips → false)
 *
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3b (Session boundary invariants)
 */

// Mirror of the Prisma enums — kept as a string union so this file has no
// Prisma import (it's pure logic, called by the builder + tests + reader).
export type SessionKindString =
  | "ENROLLMENT"
  | "ASSESSMENT"
  | "VOICE_CALL"
  | "SIM_CALL"
  | "TEXT_CHAT";

export type SessionOutcomeString = "COMPLETED" | "FAILED" | "GHOST" | "ABORTED";

export type SessionStatusString =
  | "STARTED"
  | "ACTIVE"
  | "COMPLETED"
  | "FAILED"
  | "GHOST";

/**
 * Minimum call length in seconds to count toward the learner-facing
 * "(call #N)" counter. Configurable per course in Slice 4 via
 * `Playbook.config.session.minDurationForLearnerCountSeconds`; for now
 * the default lives here. 30s mirrors the epic body recommendation.
 */
export const DEFAULT_MIN_LEARNER_DURATION_SECONDS = 30;

export interface SessionCounterFlags {
  countsTowardLearnerNumber: boolean;
  countsTowardPipelineNumber: boolean;
}

/**
 * Provisional class-flags at session-start. Treats VOICE_CALL as
 * learner-facing by default; `finaliseCounterFlags` retroactively flips
 * the learner flag if the session ended up too short / ghosted.
 */
export function initialCounterFlags(kind: SessionKindString): SessionCounterFlags {
  switch (kind) {
    case "VOICE_CALL":
      return { countsTowardLearnerNumber: true, countsTowardPipelineNumber: true };
    case "SIM_CALL":
      // Sim is a harness — completed or dropped, both don't count as
      // user-visible Calls. Pipeline still runs (it's how the harness
      // exercises ADAPT/COMPOSE).
      return { countsTowardLearnerNumber: false, countsTowardPipelineNumber: true };
    case "ENROLLMENT":
    case "ASSESSMENT":
    case "TEXT_CHAT":
      return { countsTowardLearnerNumber: false, countsTowardPipelineNumber: true };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Recompute the counter flags at session-end given the outcome and
 * duration. Only ever flips a flag to `false` — never raises one. So a
 * VOICE_CALL that ran < 30s flips learner→false; a GHOST flips both →
 * false.
 */
export function finaliseCounterFlags(args: {
  kind: SessionKindString;
  outcome: SessionOutcomeString;
  durationSeconds: number | null;
  minDurationSeconds?: number;
}): SessionCounterFlags {
  const initial = initialCounterFlags(args.kind);
  const min = args.minDurationSeconds ?? DEFAULT_MIN_LEARNER_DURATION_SECONDS;

  if (args.outcome === "GHOST") {
    return { countsTowardLearnerNumber: false, countsTowardPipelineNumber: false };
  }

  if (args.kind === "VOICE_CALL") {
    const short =
      args.durationSeconds !== null && args.durationSeconds < min;
    if (short || args.outcome === "ABORTED") {
      return {
        countsTowardLearnerNumber: false,
        countsTowardPipelineNumber: initial.countsTowardPipelineNumber,
      };
    }
  }

  return initial;
}

/**
 * Map an `endSession` outcome to the persisted `Session.status` enum
 * value. Centralised so the builder + reconciler agree.
 */
export function statusFromOutcome(outcome: SessionOutcomeString): SessionStatusString {
  switch (outcome) {
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "GHOST":
      return "GHOST";
    case "ABORTED":
      return "FAILED";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/**
 * Pipeline stages to skip given a kind + outcome. ENROLLMENT and
 * ASSESSMENT sessions skip the transcript-derived stages (EXTRACT,
 * SCORE_AGENT, PROSODY); FAILED/GHOST sessions skip those plus REWARD
 * (no usable transcript). ADAPT + SUPERVISE + COMPOSE always run —
 * ADAPT reads `failureSignal` when the transcript is empty (epic §
 * "Pipeline-on-failure").
 *
 * Returns a sorted, de-duplicated string[].
 */
export function deriveSkipStages(args: {
  kind: SessionKindString;
  outcome?: SessionOutcomeString;
}): string[] {
  const skip = new Set<string>();
  if (args.kind === "ENROLLMENT" || args.kind === "ASSESSMENT") {
    skip.add("EXTRACT");
    skip.add("SCORE_AGENT");
    skip.add("PROSODY");
  }
  if (args.outcome === "FAILED" || args.outcome === "GHOST") {
    skip.add("EXTRACT");
    skip.add("SCORE_AGENT");
    skip.add("PROSODY");
    skip.add("REWARD");
  }
  return Array.from(skip).sort();
}

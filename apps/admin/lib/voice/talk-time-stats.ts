/**
 * Talk-time stats — #1747 (epic #1700 Theme 7).
 *
 * Pure post-call telemetry helpers. Reads the standard `User:` /
 * `Assistant:` transcript format produced by every Call writer
 * (sim-drive-call.ts, voice webhook, manual ingestion — same format
 * consumed by `lib/pipeline/evidence-prefilter.ts::extractLearnerText`)
 * and computes turn counts, word counts, and approximated talk-time.
 *
 * No timestamps in the canonical transcript, so duration is
 * approximated from word count × a fixed speech-rate constant
 * (`DEFAULT_WORDS_PER_SECOND = 2.5` ≈ 150 WPM, the standard adult
 * conversational rate). Operators can override the WPM via options
 * when tuning to a faster/slower learner cohort, but the budget chip
 * is "yellow telemetry" — millisecond accuracy is not the point.
 *
 * Pure functions only — no DB reads, no AppLog writes. The caller
 * (typically endSession's post-update side-effect block) emits the
 * AppLog `voice.talk_time.over_budget` when the evaluation flags an
 * over-budget condition.
 *
 * Runtime intervention is explicitly deferred per the gap-analysis
 * risk register — this layer measures only.
 *
 * @see lib/pipeline/evidence-prefilter.ts (sibling parser)
 * @see docs/draft-issues/ielts-pre-voice-gap-analysis.md (Theme 7 row)
 */

/** Output of `computeTalkTimeStats`. All fields are zero-default-safe. */
export interface TalkTimeStats {
  /** Number of `Assistant:` turns in the transcript. */
  tutorTurnCount: number;
  /** Number of `User:` turns in the transcript. */
  learnerTurnCount: number;
  /** Cumulative word count across all `Assistant:` turns. */
  tutorWordCount: number;
  /** Cumulative word count across all `User:` turns. */
  learnerWordCount: number;
  /** Longest `Assistant:` turn measured in words. Proxy for "max
   *  continuous tutor speech" until we have per-turn timestamps. */
  maxTutorTurnWords: number;
  /** Time approximation of `maxTutorTurnWords` via `wordsPerSecond`. */
  maxTutorTurnSec: number;
  /** `tutorWordCount / (tutorWordCount + learnerWordCount)`. 0 when
   *  the transcript has no words. */
  tutorRatio: number;
  /** Words-per-second constant used for the approximation. */
  wordsPerSecond: number;
}

/** Operator-configurable thresholds, stored at `Playbook.config.talkTimeBudgets`. */
export interface TalkTimeBudgets {
  /** Over-budget when `maxTutorTurnSec > this`. Default 30s (≈ 75 words at 150 WPM). */
  maxTutorTurnSec?: number;
  /** Over-budget when `tutorRatio > this`. Default 0.2 (tutor speaks ≤ 20% of session). */
  maxTutorRatio?: number;
}

export const DEFAULT_TALK_TIME_BUDGETS: Required<TalkTimeBudgets> = {
  maxTutorTurnSec: 30,
  maxTutorRatio: 0.2,
};

/** Adult conversational rate (≈ 150 WPM). Used for word → second
 *  approximations until per-turn timestamps land on the transcript. */
export const DEFAULT_WORDS_PER_SECOND = 2.5;

/**
 * Parse a transcript in the canonical `User:` / `Assistant:` format and
 * return per-side turn + word stats + a time-approximated longest-tutor-
 * turn measurement.
 *
 * Empty / null / undefined transcripts return zero-default stats so
 * callers don't need to guard.
 */
export function computeTalkTimeStats(
  transcript: string | null | undefined,
  options: { wordsPerSecond?: number } = {},
): TalkTimeStats {
  const wps = options.wordsPerSecond ?? DEFAULT_WORDS_PER_SECOND;
  const zero: TalkTimeStats = {
    tutorTurnCount: 0,
    learnerTurnCount: 0,
    tutorWordCount: 0,
    learnerWordCount: 0,
    maxTutorTurnWords: 0,
    maxTutorTurnSec: 0,
    tutorRatio: 0,
    wordsPerSecond: wps,
  };
  if (!transcript) return zero;

  const lines = transcript.split(/\r?\n+/);
  let currentRole: "tutor" | "learner" | "other" = "other";
  let currentTurnWords = 0;
  let tutorTurnCount = 0;
  let learnerTurnCount = 0;
  let tutorWordCount = 0;
  let learnerWordCount = 0;
  let maxTutorTurnWords = 0;

  const flushTurn = () => {
    if (currentRole === "tutor") {
      tutorWordCount += currentTurnWords;
      if (currentTurnWords > maxTutorTurnWords) {
        maxTutorTurnWords = currentTurnWords;
      }
    } else if (currentRole === "learner") {
      learnerWordCount += currentTurnWords;
    }
    currentTurnWords = 0;
  };

  for (const line of lines) {
    const tutorMatch = /^\s*Assistant\s*:\s*(.*)$/i.exec(line);
    if (tutorMatch) {
      flushTurn();
      currentRole = "tutor";
      tutorTurnCount += 1;
      currentTurnWords = countWords(tutorMatch[1]);
      continue;
    }
    const learnerMatch = /^\s*User\s*:\s*(.*)$/i.exec(line);
    if (learnerMatch) {
      flushTurn();
      currentRole = "learner";
      learnerTurnCount += 1;
      currentTurnWords = countWords(learnerMatch[1]);
      continue;
    }
    if (currentRole !== "other") {
      // Continuation line under the current speaker.
      currentTurnWords += countWords(line);
    }
  }
  flushTurn();

  const totalWords = tutorWordCount + learnerWordCount;
  return {
    tutorTurnCount,
    learnerTurnCount,
    tutorWordCount,
    learnerWordCount,
    maxTutorTurnWords,
    maxTutorTurnSec: maxTutorTurnWords / wps,
    tutorRatio: totalWords > 0 ? tutorWordCount / totalWords : 0,
    wordsPerSecond: wps,
  };
}

/** Result of `evaluateTalkTimeBudgets` — which budget(s) tripped, if any. */
export interface TalkTimeEvaluation {
  overBudget: boolean;
  /** Names of the budgets that were exceeded (empty when `overBudget = false`). */
  exceededBy: Array<"maxTutorTurnSec" | "maxTutorRatio">;
  /** The effective budgets used for the evaluation (defaults merged in). */
  budgets: Required<TalkTimeBudgets>;
}

/**
 * Compare stats against the operator's budgets. Missing budget keys
 * fall back to `DEFAULT_TALK_TIME_BUDGETS`. Returns `overBudget = true`
 * when ANY budget was exceeded.
 */
export function evaluateTalkTimeBudgets(
  stats: TalkTimeStats,
  budgets: TalkTimeBudgets | null | undefined = null,
): TalkTimeEvaluation {
  const effective: Required<TalkTimeBudgets> = {
    maxTutorTurnSec:
      budgets?.maxTutorTurnSec ?? DEFAULT_TALK_TIME_BUDGETS.maxTutorTurnSec,
    maxTutorRatio:
      budgets?.maxTutorRatio ?? DEFAULT_TALK_TIME_BUDGETS.maxTutorRatio,
  };
  const exceededBy: TalkTimeEvaluation["exceededBy"] = [];
  if (stats.maxTutorTurnSec > effective.maxTutorTurnSec) {
    exceededBy.push("maxTutorTurnSec");
  }
  if (stats.tutorRatio > effective.maxTutorRatio) {
    exceededBy.push("maxTutorRatio");
  }
  return {
    overBudget: exceededBy.length > 0,
    exceededBy,
    budgets: effective,
  };
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

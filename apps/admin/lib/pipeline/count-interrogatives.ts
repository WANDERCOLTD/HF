/**
 * Interrogative-count helper — #1748 (epic #1700 Theme 8).
 *
 * Counts tutor-asked questions in a transcript. A "question" is any
 * `Assistant:` turn whose last sentence ends in `?`. Reads the canonical
 * `User:` / `Assistant:` transcript format (same parser shape as
 * `lib/voice/talk-time-stats.ts` and `lib/pipeline/evidence-prefilter.ts`).
 *
 * Filters obvious rhetorical question patterns out of the count
 * (configurable via `rhetoricalPhrases` — operators can extend the
 * skip-list per-course later if needed). Default list covers the most
 * common false positives ("right?", "okay?", "you know?", "isn't it?").
 *
 * Pure function — no DB reads, no AppLog. Caller (typically endSession's
 * post-update side-effect block) compares against `moduleQuestionTarget.min`
 * and fires `markModuleIncomplete` + AppLog when below threshold.
 *
 * @see lib/voice/talk-time-stats.ts (sibling transcript parser)
 * @see docs/draft-issues/ielts-pre-voice-gap-analysis.md (Theme 8)
 */

const DEFAULT_RHETORICAL_PHRASES: readonly string[] = [
  "right?",
  "okay?",
  "ok?",
  "yeah?",
  "you know?",
  "isn't it?",
  "isnt it?",
  "is that ok?",
  "is that okay?",
  "make sense?",
  "got it?",
];

export interface InterrogativeCountOptions {
  /**
   * Phrases that end a turn and SHOULD NOT count as a real question.
   * Match is suffix + case-insensitive against the trimmed turn text.
   * Default covers common conversational tags.
   */
  rhetoricalPhrases?: readonly string[];
}

export interface InterrogativeCountResult {
  /** Number of tutor turns ending in `?` that survive the rhetorical filter. */
  count: number;
  /** Total tutor turns (for ratio diagnostics). */
  tutorTurnCount: number;
  /** Number of tutor turns ending in `?` BEFORE the rhetorical filter. */
  rawCount: number;
  /** How many turns the rhetorical filter dropped. */
  rhetoricalFiltered: number;
}

/**
 * Count tutor-asked questions in a transcript.
 *
 * Returns zero counts on empty/null/undefined input.
 */
export function countInterrogatives(
  transcript: string | null | undefined,
  options: InterrogativeCountOptions = {},
): InterrogativeCountResult {
  const zero: InterrogativeCountResult = {
    count: 0,
    tutorTurnCount: 0,
    rawCount: 0,
    rhetoricalFiltered: 0,
  };
  if (!transcript) return zero;

  const rhetorical = (options.rhetoricalPhrases ?? DEFAULT_RHETORICAL_PHRASES).map(
    (p) => p.trim().toLowerCase(),
  );

  const lines = transcript.split(/\r?\n+/);
  let currentRole: "tutor" | "learner" | "other" = "other";
  let currentTurn = "";
  let tutorTurnCount = 0;
  let rawCount = 0;
  let rhetoricalFiltered = 0;

  const flushTurn = () => {
    if (currentRole !== "tutor") {
      currentTurn = "";
      return;
    }
    const trimmed = currentTurn.trim();
    if (trimmed.endsWith("?")) {
      rawCount += 1;
      const lowered = trimmed.toLowerCase();
      if (rhetorical.some((phrase) => lowered.endsWith(phrase))) {
        rhetoricalFiltered += 1;
      }
    }
    currentTurn = "";
  };

  for (const line of lines) {
    const tutorMatch = /^\s*Assistant\s*:\s*(.*)$/i.exec(line);
    if (tutorMatch) {
      flushTurn();
      currentRole = "tutor";
      tutorTurnCount += 1;
      currentTurn = tutorMatch[1];
      continue;
    }
    const learnerMatch = /^\s*User\s*:\s*(.*)$/i.exec(line);
    if (learnerMatch) {
      flushTurn();
      currentRole = "learner";
      currentTurn = learnerMatch[1];
      continue;
    }
    if (currentRole !== "other") {
      currentTurn += `\n${line}`;
    }
  }
  flushTurn();

  return {
    count: rawCount - rhetoricalFiltered,
    tutorTurnCount,
    rawCount,
    rhetoricalFiltered,
  };
}

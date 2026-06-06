/**
 * Learning Outcome Validator (G10 / #1160)
 *
 * Defends `Goal.type = "LEARN"` rows from tutor-briefing pollution.
 *
 * Audit context: the IELTS V1.0 playbook (`eb6bc79e`) accumulated 280
 * `Goal.type=LEARN` rows (audit 2026-06-06). 160 were legitimate
 * `lo_rollup` outcomes mapped to `LearningObjective` (OUT-01..OUT-08).
 * The other 120 were tutor-briefing directives — text the wizard
 * author dropped into the `learningOutcomes[]` field that was meant
 * for the COMPOSE prompt's `criticalRules` section, not as learner-
 * facing Goal rows. Examples:
 *
 *   "Call 1 is a topic-led warm-up only with special rules that differ from subsequent calls"
 *   "On Call 1 the tutor scores silently in the background"
 *   "FC is the most visible criterion — poor fluency masks good vocabulary and grammar"
 *   "The four criteria below must NOT be named, listed, or explained on Call 1"
 *
 * These polluted Goal rows (a) loaded `trackGoalProgress` with 360 noise
 * rows per pipeline run on IELTS V1.0 callers, (b) corrupted the
 * "what is this learner trying to achieve?" semantics that ADAPT and
 * COMPOSE both depend on.
 *
 * This validator is heuristic-based — strings that look like tutor
 * briefings rather than learner-intent statements get rejected at
 * `course-setup.ts` ingest time. `validate(entry).ok === false` means
 * the entry is dropped from `learningOutcomes[]` with a warn log
 * carrying the rejection reason.
 *
 * Companion to existing issue #307 (which stops a different bleed path
 * in the same surface — see TL #1160 review).
 */

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Tutor-briefing red flags. Each pattern is a fragment of common
 * tutor-instruction language that has no place in a learner-outcome
 * statement. Order independent.
 *
 * Some patterns are intentionally narrow ("Call 1 is", "On Call 1")
 * to avoid false positives on legitimate outcomes that reference
 * calls (e.g. "Complete 5 practice calls on Part 2 within 4 weeks"
 * passes — "Complete N calls" is a learner outcome).
 */
const TUTOR_BRIEFING_FRAGMENTS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bCall\s+\d+\s+is\b/i, reason: "rule-of-engagement statement ('Call N is …')" },
  { pattern: /\bOn\s+Call\s+\d+\b/i, reason: "tutor-direction statement ('On Call N …')" },
  { pattern: /\bfrom\s+Call\s+\d+\s+onwards\b/i, reason: "tutor-direction statement ('From Call N onwards …')" },
  { pattern: /\bthe\s+tutor\s+(scores|coach(es|ing)?|grades|notes|silently)/i, reason: "tutor-action statement ('the tutor scores/coaches …')" },
  { pattern: /\bthe\s+(four|three|five)\s+criteria\b/i, reason: "rubric-reference statement ('the four criteria …')" },
  { pattern: /\bMUST\s+NOT\b/, reason: "prohibition statement ('MUST NOT …')" },
  { pattern: /\bmust\s+not\s+be\s+(named|listed|explained|mentioned)\b/i, reason: "prohibition statement ('must not be named …')" },
  { pattern: /\bis\s+the\s+most\s+visible\s+criterion\b/i, reason: "rubric-criterion statement ('… is the most visible criterion …')" },
  { pattern: /\bpartially\s+independent\b.*\b(vocabulary|grammar|pronunciation|fluency)\b/i, reason: "rubric-relationship statement" },
  { pattern: /\bin\s+the\s+background\b/i, reason: "behind-the-scenes-mechanic statement" },
  { pattern: /\bthe\s+rubric\b/i, reason: "rubric-reference statement" },
  { pattern: /\bsilently\s+(scor|grad|not|coach)/i, reason: "background-scoring statement" },
];

/**
 * Minimum-length floor: a one- or two-word entry is unlikely to be a
 * real learner outcome (real outcomes specify a measurable behaviour
 * or competence). Allow 3+ tokens.
 */
const MIN_TOKENS = 3;

export function validateLearningOutcomeEntry(raw: string): ValidationResult {
  const entry = (raw ?? "").trim();
  if (!entry) return { ok: false, reason: "empty string" };

  const tokens = entry.split(/\s+/).filter(Boolean);
  if (tokens.length < MIN_TOKENS) {
    return { ok: false, reason: `too short (${tokens.length} tokens; min ${MIN_TOKENS})` };
  }

  for (const { pattern, reason } of TUTOR_BRIEFING_FRAGMENTS) {
    if (pattern.test(entry)) {
      return { ok: false, reason: `tutor-briefing fragment: ${reason}` };
    }
  }

  return { ok: true };
}

/**
 * Bulk filter — returns only the entries that pass validation. Rejected
 * entries are reported via the optional `onReject` callback so callers
 * (e.g. course-setup.ts) can warn-log without surfacing duplicates.
 */
export function filterLearningOutcomes(
  raw: ReadonlyArray<string>,
  onReject?: (entry: string, reason: string) => void,
): string[] {
  const passed: string[] = [];
  for (const entry of raw) {
    const result = validateLearningOutcomeEntry(entry);
    if (result.ok) {
      passed.push(entry);
    } else {
      onReject?.(entry, result.reason);
    }
  }
  return passed;
}

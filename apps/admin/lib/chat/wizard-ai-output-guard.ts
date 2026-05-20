/**
 * wizard-ai-output-guard.ts
 *
 * Pure validators applied between AI output and DB write in the wizard's
 * `create_course` tool handler. Follows the AI-to-DB guard pattern documented
 * in `.claude/rules/ai-to-db-guard.md` — "Never let AI output directly drive
 * entity creation."
 *
 * Scope: bare LEARN goal templates that the wizard maps from
 * `input.learningOutcomes` / `setupData.learningOutcomes` at
 * `wizard-tool-executor.ts:~1357-1374`.
 *
 * Why this exists (#447):
 * - When the educator uploads a course-reference doc whose materials
 *   include an assessor rubric (e.g. IELTS Speaking), the AI agent
 *   reads it during setup and returns rubric band-descriptor lines as
 *   "learning outcomes" — they LOOK learner-facing ("Band 4 LR: Uses a
 *   limited range of vocabulary…") and pass the AI's smell test.
 * - The wizard then writes them as bare LEARN templates with no
 *   `ref` and no `sourceContentId`.
 * - `applyProjection()` runs separately, writes legitimate `OUT-NN`
 *   LEARN templates with `ref` set, and leaves the wizard's rows alone
 *   (it only diffs templates that carry `sourceContentId`).
 * - Net: every IELTS-style course accumulates 4-6 rogue LEARN goals
 *   visible on the learner's What tab.
 *
 * Two layers:
 *
 *   1. Hard regex filter — drops any LO matching obvious rubric
 *      calibration shapes. Logs each drop so we have audit trail.
 *
 *   2. Soft gate — when the playbook already has projection-authoritative
 *      LEARN templates (OUT-NN refs, or templates carrying
 *      `sourceContentId`), the wizard's AI-LO extraction is skipped
 *      entirely. Projection owns LEARN goals for this playbook.
 */

import type { GoalTemplate } from "@/lib/types/json-fields";

/**
 * Patterns matching non-outcome content that AI agents sometimes return as
 * "learning outcomes". Anchored to start-of-string to minimise false positives
 * on legitimate outcomes that happen to mention test vocabulary mid-sentence.
 *
 * Two shape families:
 *
 * Rubric calibration (#447):
 * - IELTS Speaking band-descriptor lines, both shapes:
 *     - abbreviated:  "Band 2 LR: Only produces…"
 *     - full prose:   "Band 8 Lexical Resource: Wide vocabulary…"
 * - Explicit calibration commentary: "A candidate can legitimately…"
 * - Tier-name colon prose: "Approaching: …", "Developing: …"
 *
 * Test-format facts (#555):
 * - Part-segment timing/structure: "Part 1 lasts 4–5 minutes…", "Part 2 involves…"
 * - Examiner / candidate behaviour: "In Part 3, the examiner asks…",
 *   "In Part 2, candidates get 1 minute…"
 * - Test-overview sentences: "The IELTS Speaking test is…", "The same test is
 *   administered to…", "The test is a face-to-face interview…"
 *
 * Facts about test format describe constraints, not learner capability — they
 * belong on Playbook.config.constraints, not as LEARN goal templates.
 */
const RUBRIC_PATTERNS: ReadonlyArray<RegExp> = [
  // #447 — rubric calibration
  // Anchored: a learning outcome that starts with "Band <digit>" is rubric
  // calibration, never a legitimate top-level capability. Covers both
  // "Band 2 LR: …" (abbreviated) and "Band 8 Lexical Resource: …" (prose).
  /^Band\s+\d+\b/i,
  /^A candidate can legitimately/i,
  /^(Approaching(?:\s+Emerging)?|Emerging|Developing|Secure)\s*[:.]/i,
  // #555 — test-format facts
  // "Part N lasts/involves/takes/is …" — observed in IELTS course-ref as
  // category=fact assertions about each test segment's timing and structure.
  /^Part\s+\d+\s+(lasts|involves|takes|is)\b/i,
  // "In Part N, the examiner …" / "In Part N, candidates …" — examiner-side
  // behaviour or candidate procedure, not learner capability. Allows optional
  // "the" + singular/plural to catch both the AI's stylings.
  /^In\s+Part\s+\d+,?\s+(the\s+)?(examiner|candidate)s?\b/i,
  // "The [<qualifier>[ <qualifier>]] test|exam|speaking is …" — test overview
  // sentence. Covers "The test is", "The same test is", "The IELTS Speaking
  // test is". The {0,2} bounds the qualifier word(s) to keep the pattern
  // anchored and avoid runaway matches on unrelated prose.
  /^The\s+(\w+\s+){0,2}(test|exam|speaking)\s+is\b/i,
];

export interface GuardResult {
  /** Cleaned list of learning-outcome strings to persist as LEARN templates. */
  accepted: string[];
  /** LOs dropped by the regex filter, with the matching pattern. */
  filtered: Array<{ value: string; pattern: string }>;
  /** True when the soft gate fired and `accepted` is forced to []. */
  skippedByGate: boolean;
  /** Why the soft gate fired, for logging. Empty when not skipped. */
  gateReason: string;
}

/**
 * Returns true when the playbook already has projection-authoritative
 * LEARN templates. When this is true, the wizard's AI-LO extraction
 * must be skipped — projection owns LEARN goals for this playbook and
 * the AI-extracted strings would duplicate or contradict it.
 */
function isProjectionAuthoritative(existing: ReadonlyArray<GoalTemplate>): {
  authoritative: boolean;
  reason: string;
} {
  if (!existing || existing.length === 0) {
    return { authoritative: false, reason: "" };
  }

  const hasOutRef = existing.some(
    (t) => t.type === "LEARN" && typeof t.ref === "string" && /^OUT-\d+$/i.test(t.ref),
  );
  if (hasOutRef) {
    return { authoritative: true, reason: "playbook has OUT-NN LEARN templates" };
  }

  const hasSourceContentId = existing.some(
    (t) => t.type === "LEARN" && typeof t.sourceContentId === "string" && t.sourceContentId.length > 0,
  );
  if (hasSourceContentId) {
    return {
      authoritative: true,
      reason: "playbook has LEARN templates with sourceContentId (projection-written)",
    };
  }

  return { authoritative: false, reason: "" };
}

/**
 * Apply the two-layer guard to an array of AI-suggested learning
 * outcomes. Pure function — caller is responsible for logging and
 * persisting the result.
 */
export function guardAILearningOutcomes(
  rawLOs: ReadonlyArray<string>,
  existing: ReadonlyArray<GoalTemplate>,
): GuardResult {
  const gate = isProjectionAuthoritative(existing);
  if (gate.authoritative) {
    return {
      accepted: [],
      filtered: [],
      skippedByGate: true,
      gateReason: gate.reason,
    };
  }

  const accepted: string[] = [];
  const filtered: GuardResult["filtered"] = [];

  for (const raw of rawLOs) {
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    const matched = RUBRIC_PATTERNS.find((p) => p.test(raw.trim()));
    if (matched) {
      filtered.push({ value: raw, pattern: matched.source });
    } else {
      accepted.push(raw);
    }
  }

  return { accepted, filtered, skippedByGate: false, gateReason: "" };
}

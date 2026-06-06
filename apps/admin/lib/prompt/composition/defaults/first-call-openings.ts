/**
 * First-call opening template defaults (#1195).
 *
 * The `quickstart.ts::first_line` transform synthesises the literal
 * opening line the AI speaks on `isFirstCall === true`. The cascade
 * is documented at `transforms/quickstart.ts` and walks the same
 * onboarding-phases sources as `pedagogy.ts::computeSessionPedagogy`
 * (PR #1195 follow-up to the #1196 source-attribution work).
 *
 * Phase 0's `goals[]` are EDUCATOR INSTRUCTIONS ("Greet the caller
 * warmly"), NOT sentence fragments to copy verbatim. This module
 * provides:
 *
 *   1. `classifyFirstPhaseIntent` — classifies the FIRST goal in
 *      phase 0 by intent (greet / introduce / set-expectations /
 *      discover / understand-goals / assess-knowledge).
 *   2. `renderFirstCallOpening` — emits a fixed template per intent,
 *      seeded with the caller name + subjectRef. ≤2 sentences, ≤140
 *      chars per template.
 *   3. `RETURNING_USER_HEURISTIC_PATTERNS` — regex set for the
 *      `welcomeMessage` rewrite path (when no phases are configured
 *      but the educator-authored welcomeMessage assumes a returning
 *      user — the textual "Welcome back" trap from the live incident).
 *   4. `rewriteReturningUserPhrasing` — applies a first-call-
 *      appropriate replacement using subjectRef.
 *
 * Per PROMPT-COMPOSITION.md §9 L10, behavioural default strings live
 * here, NOT inline in `transforms/`. Add new templates to this file
 * when course-setup grows new intent buckets.
 *
 * Pure functions. Deterministic templating. No LLM calls.
 */

export type FirstPhaseIntent =
  | "greet"
  | "introduce"
  | "set-expectations"
  | "discover"
  | "understand-goals"
  | "assess-knowledge"
  | "unclassified";

/** Case-insensitive intent classification from the FIRST goal string
 *  in onboarding phase 0. Picks the first pattern that matches; falls
 *  through to `"unclassified"` so the caller can decide whether to
 *  emit a fully-generic opening or skip the phase-derived path. */
export function classifyFirstPhaseIntent(
  firstGoal: string | undefined | null,
): FirstPhaseIntent {
  if (!firstGoal) return "unclassified";
  const normalized = firstGoal.toLowerCase();
  if (/\bgreet|\bsay hello|\bwelcome\b/.test(normalized)) return "greet";
  if (/\bintroduce (yourself|the )|\bmeet the\b/.test(normalized))
    return "introduce";
  if (/\bset expectation|\bsession frame|\bexplain what|\bwhat to expect/.test(normalized))
    return "set-expectations";
  if (/\bdiscover|\bunderstand (their|the) background|\blearn about (the|their)/.test(normalized))
    return "discover";
  if (/\bunderstand (their|the) goals?|\blearn (their|the) goals?|\bmotivation/.test(normalized))
    return "understand-goals";
  if (/\bknowledge level|\bassess(ment)?\b|\bcheck understanding|\bprior knowledge/.test(normalized))
    return "assess-knowledge";
  return "unclassified";
}

export interface FirstCallOpeningInput {
  intent: FirstPhaseIntent;
  /** Caller's display name, when known. */
  callerName: string | null | undefined;
  /** Subject discipline (e.g. "The CIO/CTO Standard"). */
  subjectRef: string | null | undefined;
  /** Module title when available, for orientation when intent is
   *  greet / introduce. */
  moduleTitle?: string | null;
}

/** Render the first_line for a first call. Returns a 1–2 sentence
 *  opening seeded by intent, name, and subject. Length cap ~140 chars
 *  (per the AC) so the AI doesn't read a paragraph. */
export function renderFirstCallOpening(input: FirstCallOpeningInput): string {
  const namePart = input.callerName ? `, ${input.callerName}` : "";
  const subjectPart = input.subjectRef
    ? ` on ${input.subjectRef}`
    : "";
  const subjectStandalone = input.subjectRef ?? "today's session";
  const modulePart = input.moduleTitle
    ? ` We'll be looking at ${input.moduleTitle} today.`
    : "";

  switch (input.intent) {
    case "greet":
      return cap(
        `Hi${namePart}! Good to meet you${subjectPart}.${modulePart}`.trim(),
      );
    case "introduce":
      return cap(
        `Hi${namePart}! I'm your tutor for ${subjectStandalone}.${modulePart}`.trim(),
      );
    case "set-expectations":
      return cap(
        `Hi${namePart}! Glad you're here. Let me set the frame for how we'll work together on ${subjectStandalone}.`,
      );
    case "discover":
      return cap(
        `Hi${namePart}! Before we dive in, I'd love to hear a little about you and what brings you to ${subjectStandalone}.`,
      );
    case "understand-goals":
      return cap(
        `Hi${namePart}! Let's start with what you're hoping to get from working on ${subjectStandalone}.`,
      );
    case "assess-knowledge":
      return cap(
        `Hi${namePart}! To pitch this right, can I ask what you already know about ${subjectStandalone}?`,
      );
    case "unclassified":
    default:
      return cap(
        `Hi${namePart}! Good to have you here. Let's ease into ${subjectStandalone}.`,
      );
  }
}

/** Returning-user phrasing patterns. Narrow — must NOT fire on benign
 *  first-call welcomes like "Welcome! Glad you're here." */
export const RETURNING_USER_HEURISTIC_PATTERNS: readonly RegExp[] = [
  /welcome\s+back/i,
  /let'?s revise/i,
  /pick up where we left off/i,
  /last (time|session)/i,
  /you'?ve covered/i,
];

/** True when the message contains returning-user phrasing AND would
 *  confuse a brand-new caller. */
export function hasReturningUserPhrasing(msg: string): boolean {
  return RETURNING_USER_HEURISTIC_PATTERNS.some((rx) => rx.test(msg));
}

/** Replace a returning-user-assumed welcomeMessage with a first-call-
 *  appropriate opening. Conservative — only fires when
 *  `hasReturningUserPhrasing` returns true (caller's responsibility
 *  to gate on isFirstCall). */
export function rewriteReturningUserPhrasing(input: {
  callerName: string | null | undefined;
  subjectRef: string | null | undefined;
}): string {
  const namePart = input.callerName ? `, ${input.callerName}` : "";
  const subjectStandalone = input.subjectRef ?? "today's session";
  return cap(
    `Hi${namePart}! Good to have you here. Let's ease into ${subjectStandalone}.`,
  );
}

function cap(s: string, max = 160): string {
  if (s.length <= max) return s;
  // Trim to last sentence boundary before max.
  const truncated = s.slice(0, max);
  const lastDot = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?"),
  );
  return lastDot > 0 ? truncated.slice(0, lastDot + 1) : truncated;
}

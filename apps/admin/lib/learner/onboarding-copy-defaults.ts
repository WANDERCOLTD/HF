/**
 * Default learner-facing onboarding copy.
 *
 * Single source of truth for the strings that were hardcoded in
 * `hooks/useJourneyChat.ts` + `components/student/WelcomeSurveyFlow.tsx`
 * before PR #2266 lifted them to the cascade. Both consumers fall back
 * to these defaults when `Playbook.config.<field>` is null.
 *
 * The shared module also deduplicates the 3 strings that were duplicated
 * verbatim across the two consumers pre-#2266 (aboutYouIntro,
 * preTestIntro, preTestClosing).
 *
 * Token convention: `{subject}` + `{teacherName}` + `{questionCount}`.
 * `applyCopyTokens` does the substitution.
 */

export const ONBOARDING_COPY_DEFAULTS = {
  /** FOH onboarding welcome bubble — when both Playbook + Domain + Institution layers are null. */
  welcomeMessage:
    "Welcome! I'm your AI study partner — ready to help you learn through conversation.",
  /** Onboarding closing CTA tail. */
  onboardingClosingLine: "We'll adapt as we go. Let's get started!",
  /** Goals preamble above the bullet list. */
  goalsPreamble: "Here's what we'll work on:",
  /** About-You / personality survey greeting. */
  aboutYouIntro:
    "Hey! I'm your AI study partner for {subject}. {teacherName} Before we dive in, I'd love to learn a bit about you.",
  /** Pre-test intro. */
  preTestIntro:
    "Now let's do a quick knowledge check on {subject} — just {questionCount} questions. Don't worry about getting them right, this just helps me understand where you're starting from.",
  /** Pre-test closing before the first practice session. */
  preTestClosing:
    "Brilliant! I've got everything I need. Let's start your first practice session — you're going to do great.",
  /** Post-test intro at journey end. */
  postTestIntro:
    "One last thing — let's see how much your {subject} comprehension has grown. {questionCount} questions, same skills we've been working on.",
  /** Post-test closing before the exit survey. */
  postTestClosing: "Brilliant! Let's wrap up with some quick feedback.",
  /** Journey-exit intro before the final survey. */
  journeyExitIntro:
    "You've finished all your sessions — amazing work! Before you go, I'd love to hear how it went.",
  /** Journey-exit thank-you. Last learner-facing touchpoint. */
  journeyExitClosing:
    "Thanks so much for your feedback! You've been brilliant. Good luck with everything!",
} as const;

export interface CopyTokens {
  subject?: string;
  teacherName?: string;
  questionCount?: number;
}

/**
 * Substitute `{subject}` / `{teacherName}` / `{questionCount}` tokens in
 * a copy string. The `{teacherName}` token additionally swallows the
 * surrounding "{teacherName} set this up for you. " phrasing when
 * teacherName is empty — matches the pre-cascade behaviour where the
 * literal was assembled with a conditional template.
 */
export function applyCopyTokens(template: string, tokens: CopyTokens): string {
  const teacherSegment = tokens.teacherName
    ? `${tokens.teacherName} set this up for you.`
    : "";
  return template
    .replace(/\{subject\}/g, tokens.subject ?? "")
    .replace(/\{teacherName\}/g, teacherSegment)
    .replace(/\{questionCount\}/g, String(tokens.questionCount ?? 0))
    // Collapse the double-space that `{teacherName}` produces when the
    // teacher segment is empty (e.g. "for Maths.  Before we dive in" →
    // "for Maths. Before we dive in").
    .replace(/  +/g, " ");
}

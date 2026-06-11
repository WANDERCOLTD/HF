/**
 * Token substitution for educator-authored greeting strings (#1403).
 *
 * The Greeting lens lets educators author two literal AI utterances:
 *   - `Playbook.config.welcomeMessage` — first-call opener
 *   - `Playbook.config.firstCallCourseIntro` — course intro turn
 *
 * Both fields support a TIGHTLY-SCOPED token set: `{firstName}` and
 * `{courseName}`. This helper performs the substitution server-side
 * before the strings reach the AI, with three properties enforced:
 *
 *   1. **Only the two whitelisted tokens are substituted.** Any other
 *      `{...}` sequence in the template is left verbatim (no surprise
 *      expansion of operator-typed strings — protects against a curious
 *      educator pasting `{password}` and getting an evaluated identifier).
 *   2. **Empty / null values fall back to safe defaults**: `{firstName}`
 *      → "there" (so "Hi there, …" reads correctly with no name on file);
 *      `{courseName}` → "this course".
 *   3. **All token markers are stripped** even when the value is empty —
 *      no literal "Hi {firstName}!" reaches the AI when the cascade can't
 *      resolve a name.
 *
 * Used by `transforms/quickstart.ts::first_line` and by the Preview lens
 * (`PreviewLens.tsx::buildTranscript`) so educator + AI see the same
 * resolved string.
 *
 * Lives under `lib/prompt/composition/defaults/` per the
 * `no-hardcoded-greeting-in-composition` rule's allow-list — this is the
 * canonical home for behavioural default templates.
 *
 * Pure function. Deterministic. No LLM calls.
 */

export interface SubstituteGreetingTokensInput {
  /** Educator-authored template, possibly empty / null. */
  template: string | null | undefined;
  /** Caller's first name (display-time). */
  firstName?: string | null;
  /** Course name to substitute into `{courseName}`. */
  courseName?: string | null;
}

/** Default fragment used when `{firstName}` resolves to no value. */
export const DEFAULT_FIRST_NAME = "there";

/** Default fragment used when `{courseName}` resolves to no value. */
export const DEFAULT_COURSE_NAME = "this course";

/** Tightly-scoped supported tokens. Adding a new token requires:
 *  (a) an entry here, (b) a unit test, (c) educator-visible hint copy. */
export const SUPPORTED_GREETING_TOKENS = ["firstName", "courseName"] as const;
export type SupportedGreetingToken = (typeof SUPPORTED_GREETING_TOKENS)[number];

/**
 * Substitute `{firstName}` and `{courseName}` in a greeting template.
 * Returns the empty string when the template itself is null / undefined
 * / blank — callers should treat that as "no template configured".
 *
 * Arbitrary `{...}` markers (e.g. `{phone}`, `{level}`) are NOT
 * substituted; they are left in the output verbatim. This is by design —
 * the AI doesn't need them, and silently expanding them would create a
 * security surface for whatever happens to be in scope.
 */
export function substituteGreetingTokens(input: SubstituteGreetingTokensInput): string {
  const raw = input.template;
  if (raw == null) return "";
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";

  const firstName = (input.firstName ?? "").trim() || DEFAULT_FIRST_NAME;
  const courseName = (input.courseName ?? "").trim() || DEFAULT_COURSE_NAME;

  // Only substitute the two whitelisted tokens. Use a single pass over a
  // narrow regex so an educator typing `{phone}` doesn't accidentally
  // pull in arbitrary scope.
  return trimmed.replace(/\{(firstName|courseName)\}/g, (_, token: SupportedGreetingToken) => {
    if (token === "firstName") return firstName;
    if (token === "courseName") return courseName;
    return _;
  });
}

/** True when the template contains at least one supported token marker.
 *  Used by the Preview lens to show a "Token preview" row only when one
 *  of the supported markers is actually present. */
export function templateContainsSupportedToken(template: string | null | undefined): boolean {
  if (!template) return false;
  return /\{(firstName|courseName)\}/.test(template);
}

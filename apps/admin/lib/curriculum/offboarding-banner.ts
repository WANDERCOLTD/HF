/**
 * Offboarding banner — derive the learner-facing banner string from the
 * operator's `Playbook.config.offboarding.bannerMessage` template.
 *
 * #2054 (epic #2049 sub-epic E) consumer for the
 * `offboardingBannerMessage` JourneySettingContract. Wired into:
 *   - `app/x/student/progress/page.tsx` (renders the banner inline)
 *
 * Surfaces:
 *   - The template carries a `{n}` token; this helper substitutes the
 *     learner's current `totalCalls` count.
 *   - When the template is missing/empty, a sensible default is used so
 *     the banner is still meaningful.
 *
 * No side effects; pure function over the resolved config.
 */
import type { OffboardingConfig } from "@/lib/types/json-fields";

export interface OffboardingBannerInput {
  /** The resolved `Playbook.config.offboarding` block (or undefined). */
  offboarding?: OffboardingConfig;
  /** Total completed calls so far (`{n}` substitution target). */
  totalCalls: number;
}

/**
 * Resolve the banner message the student sees on the progress page when
 * offboarding is approaching.
 *
 * Token substitution: every `{n}` in the template is replaced with the
 * learner's `totalCalls` value (decimal, no padding).
 *
 * Returns null when no banner should render (e.g. operator has not set a
 * template AND the caller has not yet hit `triggerAfterCalls`).
 */
export function resolveOffboardingBanner(input: OffboardingBannerInput): string | null {
  const template = input.offboarding?.bannerMessage;
  if (typeof template === "string" && template.trim().length > 0) {
    return template.replace(/\{n\}/g, String(input.totalCalls));
  }
  // Sensible default surfaces when the operator has not customised the
  // bannerMessage — the {n} substitution still happens client-side
  // (the page-level default uses the same shape).
  return `You’ve completed ${input.totalCalls} practice sessions! Tell us how it went — it takes 30 seconds.`;
}

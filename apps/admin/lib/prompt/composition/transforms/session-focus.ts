/**
 * session-focus.ts — #2145 Phase A (Generic SessionFocus substrate, S2).
 *
 * Compose-time reader for the **generic SessionFocus 4th layer**. Reads
 * `CallerAttribute(key = "session_focus:next_{moduleSlug}")` for the
 * locked module and projects the stored learner-facing label into BOTH
 * a tutor directive AND a `PinnedCardContent` for the SimChat banner.
 *
 * This transform is COURSE-AGNOSTIC. The mapping from "internal
 * weakness signal" → "learner-facing label" lives in the
 * `session-focus-policy` AnalysisSpec runner
 * (`lib/pipeline/runners/session-focus-policy.ts`) which writes the
 * CallerAttribute row at AGGREGATE / ADAPT time. This transform only
 * READS that row at compose-time — it never branches on course-specific
 * shapes or hardcodes label sets.
 *
 * Replaces the criterion-leaking shape PR #2134 / #1955 shipped: that
 * code path read `derive-focus-area.ts::IELTS_SKILL_LABELS` (criterion
 * names — internal-only) at compose-time and rendered them in both the
 * pin and the directive. The new shape reads ONLY the projected
 * learner-safe label.
 *
 * **Honest-empty-state**: when no `session_focus:next_*` row exists
 * for the locked module, this transform returns null and the renderer
 * pushes nothing. NO HARDCODED DEFAULTS — per
 * `~/.claude/projects/-Users-paulwander-projects-HF/memory/feedback_no_hardcoded_score_backfill.md`,
 * surfacing NULL is the honest answer when the projection runner
 * hasn't fired yet (first-ever session, fresh course, or no scoring
 * data yet on the input signals).
 *
 * Read site for the directive: `renderPromptSummary.ts` —
 * `parts.push(llmPrompt.instructions?.session_focus?.directive)`.
 *
 * @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
 * Producer↔consumer pairing sentinel — `composition-directive-needs-renderer`
 * ESLint rule + `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`
 * vitest enforce that every `directive: "…"` field below has a paired
 * push in renderPromptSummary.ts.
 */

import type {
  PinnedCardContent,
  PlaybookConfig,
} from "@/lib/types/json-fields";
import type { AssembledContext, CallerAttributeData } from "../types";

/**
 * Prefix for the CallerAttribute key the session-focus-policy runner
 * writes. The full key is `session_focus:next_{moduleSlug}`. Exposing
 * the prefix as a constant ensures the writer + reader can't drift —
 * the runner imports this same constant.
 */
export const SESSION_FOCUS_KEY_PREFIX = "session_focus:next_";

/**
 * Compose the key for a given module slug. Pure function — used by
 * both the writer (`session-focus-policy.ts`) and this reader.
 */
export function sessionFocusKeyFor(moduleSlug: string): string {
  return `${SESSION_FOCUS_KEY_PREFIX}${moduleSlug}`;
}

/**
 * Output shape — both the tutor directive and the pinned card content
 * the SimChat banner renders. `pinnedCard` is null when the directive
 * fires but the surface doesn't want a banner (e.g. operator opted out
 * via a future module toggle); today both are emitted together.
 */
export interface SessionFocusOutput {
  /** The learner-facing label projected by the policy runner. */
  label: string;
  /** Tutor directive to render into the composed prompt. */
  directive: string;
  /** Pinned card content for the SimChat banner. Null when no banner needed. */
  pinnedCard: PinnedCardContent | null;
  /** Module slug the focus applies to (echo of the lookup key suffix). */
  moduleSlug: string;
}

/**
 * Read the learner-facing session-focus label for the locked module
 * and project it to a tutor directive + pinned card.
 *
 * Returns null when:
 *   - No module is locked (continuous mode — no session-scoped focus).
 *   - No `session_focus:next_{moduleSlug}` CallerAttribute row exists
 *     (first-ever session, or the projection runner hasn't fired).
 *   - The CallerAttribute row has an empty `stringValue`.
 *
 * No hardcoded fallback. Honest empty state is the right behaviour
 * when input scores aren't yet present.
 */
export function resolveSessionFocus(
  _config: PlaybookConfig,
  context: AssembledContext,
): SessionFocusOutput | null {
  const lockedModule = context.sharedState.lockedModule;
  if (!lockedModule) return null;

  const moduleSlug = lockedModule.slug ?? lockedModule.id ?? "";
  if (!moduleSlug) return null;

  const targetKey = sessionFocusKeyFor(moduleSlug);

  const callerAttributes: CallerAttributeData[] =
    context.loadedData.callerAttributes ?? [];
  const row = callerAttributes.find((attr) => attr.key === targetKey);
  if (!row) return null;

  const label = row.stringValue?.trim();
  if (!label) return null;

  const directive = `Today's session focus: ${label}. Steer your questions and feedback toward developing this technique throughout the session. Use the focus as the through-line — when the learner gives a brief answer, prompt them to apply ${label} explicitly; when they do it well, name the technique back to them so they recognise the move.`;

  const pinnedCard: PinnedCardContent = {
    kind: "topicFocus",
    topic: "Today's focus",
    focusArea: label,
  };

  return {
    label,
    directive,
    pinnedCard,
    moduleSlug,
  };
}

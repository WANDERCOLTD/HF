/**
 * #1733 / #1744 (epic #1700 Theme 3) — pinned-card selector.
 *
 * Pure helper. Given a Playbook config, an authored-module slug, and the
 * Session's `sequenceNumber` (the learner-facing count), return the
 * `PinnedCardContent` that should be both:
 *
 *   - written into `Session.metadata.pinnedCard` at session-start so
 *     `<PinnedCardSlot>` can render it above SimChat for THIS session
 *   - matched, byte-for-byte, by `resolveModuleCueCard` inside
 *     `transforms/instructions.ts` (#1733 prompt-side consumer) — same
 *     selection policy (`(sequenceNumber - 1) % pool.length`) so the
 *     UI card the learner sees agrees with the cue card the model was
 *     prompted with.
 *
 * Selection policy is deliberately deterministic (modulo) rather than
 * random so Preview-lens previews + actual call composition agree
 * byte-for-byte (the contract `resolveModuleCueCard` already calls out).
 *
 * Returns `null` when:
 *   - no `moduleSlug` (caller in no-module / continuous mode)
 *   - no matching `AuthoredModule` in `config.modules`
 *   - empty `cueCardPool`
 *   - picked card is malformed (no topic, no valid bullets)
 *
 * #1955 / epic #2145 S4 — `selectTopicFocusCard` sibling resolves a
 * `kind: "topicFocus"` card by reading the `CallerAttribute` row written
 * by the `session-focus-policy` AnalysisSpec runner
 * (`lib/pipeline/runners/session-focus-policy.ts`). The runner writes
 * the LEARNER-FACING label (e.g. "structuring an argument" — never the
 * internal criterion name) to `CallerAttribute(key=session_focus:next_{slug})`
 * at the end of the prior call's ADAPT stage; this selector projects
 * that row onto the pin shape at next-session start. Same
 * `Session.metadata.pinnedCard` slot, different kind. Drift guard:
 * callers MUST NOT pass both into the same Session — `select-pinned-card.ts`
 * is the gate; the consumer (`create-session.ts`) asserts only ONE was
 * returned per session.
 *
 * Replaces the criterion-leaking shape PR #2134 / #1955 shipped: that
 * code path read `derive-focus-area.ts::IELTS_SKILL_LABELS` (criterion
 * names — internal-only) and rendered the criterion as `focusArea`.
 * Retired by epic #2145 S4 in favour of the spec-driven projection
 * runner which writes only LEARNER-SAFE labels.
 *
 * Flag handling: pure helper — does NOT read the
 * `HF_FLAG_IELTS_MODULE_SETTINGS` env var. Callers gate themselves so
 * tests can exercise the selector independently.
 */

import type {
  AuthoredModule,
  PinnedCardContent,
  PlaybookConfig,
} from "@/lib/types/json-fields";
import { SESSION_FOCUS_KEY_PREFIX } from "@/lib/prompt/composition/transforms/session-focus";

export interface SelectPinnedCardArgs {
  config: PlaybookConfig | null | undefined;
  moduleSlug: string | null | undefined;
  /** Session.sequenceNumber — 1-based learner-facing count. */
  sequenceNumber: number;
}

export function selectPinnedCardForModule(
  args: SelectPinnedCardArgs,
): PinnedCardContent | null {
  const { config, moduleSlug, sequenceNumber } = args;
  if (!config || !moduleSlug) return null;

  const modules: AuthoredModule[] = config.modules ?? [];
  const matched = modules.find((m) => m.id === moduleSlug);
  if (!matched) return null;

  const pool = matched.settings?.cueCardPool;
  if (!Array.isArray(pool) || pool.length === 0) return null;

  const safeSeq = Number.isFinite(sequenceNumber) && sequenceNumber > 0 ? sequenceNumber : 1;
  const index = (safeSeq - 1) % pool.length;
  const picked = pool[index];
  if (!picked || typeof picked.topic !== "string" || picked.topic.trim().length === 0) {
    return null;
  }
  const bullets = Array.isArray(picked.bullets)
    ? picked.bullets.filter((b) => typeof b === "string" && b.trim().length > 0)
    : [];
  if (bullets.length === 0) return null;

  return {
    kind: "cueCard",
    topic: picked.topic,
    bullets,
  };
}

/** Part-3-shape heuristic — same shape used by the session-focus-policy
 *  runner's `moduleScope.slugPattern` gate. */
function isPart3ShapedSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const s = slug.toLowerCase();
  return s.includes("part3") || s.includes("part-3") || s.includes("part_3") || s.includes("discussion");
}

/**
 * Minimal shape this selector needs from the caller's CallerAttribute
 * rows. Compatible with both the Prisma row and any caller-side fetch
 * that projects only what's read here.
 */
export interface CallerAttributeForFocus {
  key: string;
  stringValue?: string | null;
}

export interface SelectTopicFocusArgs {
  config: PlaybookConfig | null | undefined;
  moduleSlug: string | null | undefined;
  /**
   * The caller's `CallerAttribute` rows. The selector reads ONLY the one
   * with `key === session_focus:next_{moduleSlug}` — written by the
   * `session-focus-policy` AnalysisSpec runner at the end of the prior
   * call's ADAPT stage.
   */
  callerAttributes: ReadonlyArray<CallerAttributeForFocus>;
}

/**
 * #1955 / #2145 S4 — resolve the topicFocus pinned card from the
 * canonical CallerAttribute row written by the session-focus-policy
 * runner. Returns null when:
 *   - no module / no config / not a Part-3-shape module
 *   - the matching AuthoredModule has `pinFocusArea === false` (operator
 *     opted out via G8 toggle)
 *   - no `CallerAttribute(key=session_focus:next_{moduleSlug})` row
 *     exists (the runner hasn't written one — first-ever session, no
 *     scored input skills yet, etc.)
 *   - the row's `stringValue` is empty
 *
 * The label is rendered verbatim into `PinnedCardContent.focusArea`.
 * Per `Part3TechniqueFocus` in `lib/types/json-fields.ts`, every value
 * the runner can write is a learner-safe technique label — the leak
 * gate (`tests/lib/sim-chat/learner-ui-leak-coverage.test.ts`) pins
 * that contract structurally.
 */
export function selectTopicFocusCard(
  args: SelectTopicFocusArgs,
): PinnedCardContent | null {
  const { config, moduleSlug, callerAttributes } = args;
  if (!config || !moduleSlug) return null;
  if (!isPart3ShapedSlug(moduleSlug)) return null;

  const modules: AuthoredModule[] = config.modules ?? [];
  const matched = modules.find((m) => m.id === moduleSlug);
  const pinFocusArea = matched?.settings?.pinFocusArea;
  if (pinFocusArea === false) return null;

  const targetKey = `${SESSION_FOCUS_KEY_PREFIX}${moduleSlug}`;
  const row = callerAttributes.find((attr) => attr.key === targetKey);
  if (!row) return null;

  const label = row.stringValue?.trim();
  if (!label) return null;

  return {
    kind: "topicFocus",
    topic: "Today's focus",
    focusArea: label,
  };
}

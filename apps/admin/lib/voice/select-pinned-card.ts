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
 * #1955 (Boaz/Eldar pre-voice Unit 4.1 / 4.2) — `selectTopicFocusCard`
 * sibling resolves a `kind: "topicFocus"` card from `deriveFocusArea`
 * for Part-3-shape modules. Same `Session.metadata.pinnedCard` slot,
 * different kind. Drift guard: callers MUST NOT pass both into the
 * same Session — `select-pinned-card.ts` is the gate; the consumer
 * (`create-session.ts`) asserts only ONE was returned per session.
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
import {
  deriveFocusArea,
  type CallerTargetForFocus,
} from "@/lib/curriculum/derive-focus-area";

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

/** Part-3-shape heuristic — same as `transforms/part3-focus.ts`. */
function isPart3ShapedSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const s = slug.toLowerCase();
  return s.includes("part3") || s.includes("part-3") || s.includes("part_3") || s.includes("discussion");
}

export interface SelectTopicFocusArgs {
  config: PlaybookConfig | null | undefined;
  moduleSlug: string | null | undefined;
  callerTargets: ReadonlyArray<CallerTargetForFocus>;
}

/**
 * #1955 — resolve the topicFocus pinned card. Returns null when:
 *   - no module / no config / not a Part-3-shape module
 *   - the matching AuthoredModule has `pinFocusArea === false` (operator
 *     opted out via G8 toggle)
 *   - `deriveFocusArea()` returns null (no scoring history yet)
 */
export function selectTopicFocusCard(
  args: SelectTopicFocusArgs,
): PinnedCardContent | null {
  const { config, moduleSlug, callerTargets } = args;
  if (!config || !moduleSlug) return null;
  if (!isPart3ShapedSlug(moduleSlug)) return null;

  const modules: AuthoredModule[] = config.modules ?? [];
  const matched = modules.find((m) => m.id === moduleSlug);
  const pinFocusArea = matched?.settings?.pinFocusArea;
  if (pinFocusArea === false) return null;

  const focus = deriveFocusArea(callerTargets, moduleSlug);
  if (!focus) return null;

  return {
    kind: "topicFocus",
    topic: "Today's focus",
    focusArea: focus.label,
  };
}

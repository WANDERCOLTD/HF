/**
 * inspector-variants — mode-aware HOW-card variants for the Module
 * Inspector.
 *
 * Story #2205 (U4 of #2185). The map below is the declarative
 * AuthoredModuleMode → component dispatch. Adding a new mode literal
 * to `AuthoredModuleMode` MUST also land an entry here — the
 * `mode-ui-coverage` Lattice gate at
 * `apps/admin/tests/lib/sim-chat/mode-ui-coverage.test.ts` checks
 * adminUI consumers, and `getHowCardVariant` references the literal
 * via the `mode === "<value>"` shape the gate looks for.
 *
 * The map is data-driven by design (no nested if-else) so the
 * Lattice's "declarative mode dispatch" invariant holds — see
 * `.claude/rules/lattice-survey.md`.
 */

import type { FC } from "react";

import type { AuthoredModuleMode } from "@/lib/types/json-fields";

import { HowCardExaminer } from "./HowCardExaminer";
import { HowCardMixed } from "./HowCardMixed";
import { HowCardMockExam } from "./HowCardMockExam";
import { HowCardQuiz } from "./HowCardQuiz";
import { HowCardTutor } from "./HowCardTutor";
import type { HowCardVariantProps } from "./types";

export { HowCardExaminer } from "./HowCardExaminer";
export { HowCardMixed } from "./HowCardMixed";
export { HowCardMockExam } from "./HowCardMockExam";
export { HowCardQuiz } from "./HowCardQuiz";
export { HowCardTutor } from "./HowCardTutor";
export type { HowCardVariantProps } from "./types";
export { isAuthoredModuleMode } from "./types";

/**
 * Declarative dispatch table. Each AuthoredModuleMode value maps to a
 * variant component; no fallback branch in code — unknown modes hit
 * `getHowCardVariant`'s default arm (`HowCardTutor`) at runtime.
 */
const HOW_CARD_VARIANT_BY_MODE: Record<
  AuthoredModuleMode,
  FC<HowCardVariantProps>
> = {
  tutor: HowCardTutor,
  mixed: HowCardMixed,
  examiner: HowCardExaminer,
  quiz: HowCardQuiz,
  "mock-exam": HowCardMockExam,
};

/**
 * Resolve the HOW-card variant for a given mode. Unknown / undefined
 * modes fall back to `HowCardTutor` — matches the tutor-as-default
 * convention pinned by `mode-ui-coverage.test.ts` exempts.
 *
 * The mode comparator below is structured as an explicit equality
 * chain (`mode === "<value>"`) — NOT a switch, NOT an indexed lookup
 * — because the Lattice mode-ui-coverage gate scans adminUI source for
 * exactly this shape to mark a literal as a real consumer.
 */
export function getHowCardVariant(
  mode: AuthoredModuleMode | string | undefined | null,
): FC<HowCardVariantProps> {
  if (mode === "examiner") return HOW_CARD_VARIANT_BY_MODE.examiner;
  if (mode === "mixed") return HOW_CARD_VARIANT_BY_MODE.mixed;
  if (mode === "quiz") return HOW_CARD_VARIANT_BY_MODE.quiz;
  if (mode === "mock-exam") return HOW_CARD_VARIANT_BY_MODE["mock-exam"];
  // Default branch — also serves the canonical tutor value
  // (tutor-as-default convention per mode-ui-coverage exempts).
  return HOW_CARD_VARIANT_BY_MODE.tutor;
}

/**
 * part3-focus.ts — #1955 (Boaz/Eldar pre-voice gap analysis, Unit 4.1 / 4.2).
 *
 * Compose-time resolver. Reads the learner's CallerTarget rows + the
 * locked module's `pinFocusArea` toggle and returns a directive object
 * shaped like the other module-scoped directives in `instructions.ts`
 * (module_question_target, module_cue_card, …).
 *
 * Selection policy is delegated to `deriveFocusArea()`
 * (lib/curriculum/derive-focus-area.ts) — the pure helper used both
 * here and by the pinned-card writer in `select-pinned-card.ts` so the
 * directive the model sees and the on-screen banner the learner sees
 * agree byte-for-byte.
 *
 * Returns null when:
 *   - The IELTS module-settings flag is off (epic #1700 decision 5)
 *   - No module is locked (continuous mode)
 *   - The locked module isn't tagged Part-3-shaped
 *   - The module's `pinFocusArea` toggle is explicitly false
 *   - `deriveFocusArea()` returns null (no scoring data yet — first-ever
 *     session, the directive simply doesn't render)
 *
 * Read site for the directive: `renderPromptSummary.ts` —
 * `parts.push(llmPrompt.instructions?.module_focus_area?.directive)`.
 *
 * @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
 * Producer↔consumer pairing sentinel — `composition-directive-needs-renderer`
 * ESLint rule + `tests/lib/prompt/composition/coverage-producer-consumer.test.ts`
 * vitest enforce that every `directive: "…"` field below has a paired
 * push in renderPromptSummary.ts. Born of PR #1768 silently dropping
 * 5 consumer pushes; see `.claude/rules/lattice-survey.md`.
 */

import { deriveFocusArea } from "@/lib/curriculum/derive-focus-area";
import { isIeltsModuleSettingsEnabled } from "@/lib/journey/module-settings-flag";
import type {
  AuthoredModule,
  PlaybookConfig,
} from "@/lib/types/json-fields";
import type { AssembledContext } from "../types";

export interface Part3FocusOutput {
  parameterId: string;
  paramSlug: string;
  label: string;
  score: number;
  directive: string;
}

/**
 * Part-3-shape heuristic: slug equals "part3" OR contains "part-3" /
 * "part_3" / "discussion". Same shape the verify script and the
 * select-pinned-card sibling use.
 */
export function isPart3ShapedModule(
  module: { slug?: string | null; id?: string | null } | null | undefined,
): boolean {
  if (!module) return false;
  const slugHay = `${module.slug ?? ""} ${module.id ?? ""}`.toLowerCase();
  return (
    slugHay.includes("part3") ||
    slugHay.includes("part-3") ||
    slugHay.includes("part_3") ||
    slugHay.includes("discussion")
  );
}

export function resolveModuleFocusArea(
  config: PlaybookConfig,
  context: AssembledContext,
): Part3FocusOutput | null {
  if (!isIeltsModuleSettingsEnabled()) return null;

  const lockedModule = context.sharedState.lockedModule;
  if (!lockedModule) return null;

  if (!isPart3ShapedModule(lockedModule)) return null;

  // Match the AuthoredModule entry (same shape as other consumers).
  const authoredModules: AuthoredModule[] = config.modules ?? [];
  const matched = authoredModules.find(
    (m) => m.id === lockedModule.id || m.id === lockedModule.slug,
  );

  // G8 toggle gate. Default ON for Part-3 modules — when the field is
  // explicitly false the operator has opted out.
  const pinFocusArea = matched?.settings?.pinFocusArea;
  if (pinFocusArea === false) return null;

  const callerTargets = context.loadedData.callerTargets ?? [];
  const slug = lockedModule.slug ?? lockedModule.id ?? "";
  const focus = deriveFocusArea(callerTargets, slug);
  if (!focus) return null;

  return {
    parameterId: focus.parameterId,
    paramSlug: focus.paramSlug,
    label: focus.label,
    score: focus.score,
    directive: `Focus on ${focus.label} this session — direct your questions and feedback toward developing this criterion. The learner is currently weakest here (score ${focus.score.toFixed(2)}).`,
  };
}

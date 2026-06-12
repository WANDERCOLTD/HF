import type { WizardToolExec } from "../_shared/types";

export async function execute(
  input: Record<string, unknown>,
  _userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
  // #398 — reject "Create my course" / "Ready to launch" chip text while
  // progressionMode (a required graph field) is still missing. The AI has
  // repeatedly ignored rule 9 (HARD GATE) + the BLOCKED directive in
  // graph-evaluator and offered create-course chips with required fields
  // unset. This is the last server-side gate.
  const suggestions = input.suggestions as unknown;
  if (Array.isArray(suggestions) && setupData) {
    const progressionMissing =
      setupData.progressionMode === undefined ||
      setupData.progressionMode === null ||
      setupData.progressionMode === "";
    if (progressionMissing) {
      const CREATE_LIKE = /\b(create|launch|build|ready to (proceed|create|launch|go))\b/i;
      const offending = suggestions.filter(
        (s): s is string => typeof s === "string" && CREATE_LIKE.test(s),
      );
      if (offending.length > 0) {
        console.warn(
          `[wizard-tools] show_suggestions REJECTED — ${offending.length} create-course-style chip(s) (${offending.join(" / ")}) offered while progressionMode is missing. Surface show_options with dataKey:"progressionMode" instead.`,
        );
        return {
          content: JSON.stringify({
            ok: false,
            error:
              `Cannot offer "Create my course" / "Ready to launch" chips while required field progressionMode is missing. ` +
              `Call show_options with dataKey:"progressionMode" first — the educator's chip click writes the field directly. Once setupData.progressionMode is set, the launch chips become valid.`,
            rejectedSuggestions: offending,
          }),
          is_error: true,
        };
      }
    }
  }
  return { content: `Suggestion chips displayed to user. Wait for their response.` };
}

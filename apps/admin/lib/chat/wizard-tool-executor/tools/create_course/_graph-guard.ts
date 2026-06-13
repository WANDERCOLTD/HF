/**
 * Stage 1 of `create_course` — graph guard.
 *
 * Extracted from the monolithic `create_course.ts` per #1544. The graph
 * evaluator is the very first hard-fail check: if `evaluateGraph` reports
 * `canLaunch: false`, the tool returns an `is_error: true` payload with
 * the missing field labels so the AI can collect them and retry. No DB
 * writes occur on a failed guard.
 *
 * Behaviour-preserving: the return shape (content JSON + is_error: true)
 * is verbatim identical to the pre-extract code at `create_course.ts:13-35`.
 * The dispatcher tests at `tests/lib/chat/wizard-tool-executor-dispatcher.test.ts`
 * pin this guard via the "create_course hard-fails when graph is incomplete"
 * scenario — those tests must stay green after extraction.
 */

import type { WizardToolExec } from "../../_shared/types";

export interface GraphGuardResult {
  /** `null` means continue; a payload means early-return from the executor. */
  earlyReturn: WizardToolExec | null;
}

export async function runGraphGuard(
  setupData?: Record<string, unknown>,
): Promise<GraphGuardResult> {
  const { evaluateGraph } = await import("@/lib/wizard/graph-evaluator");
  const graphCheck = evaluateGraph(setupData ?? {});
  if (graphCheck.canLaunch) {
    return { earlyReturn: null };
  }

  const labels = graphCheck.missingRequired.map((n) => n.label);
  const keys = graphCheck.missingRequired.map((n) => n.key);
  console.log(
    `[wizard-tools] create_course BLOCKED — missing required: ${labels.join(", ")}`,
  );
  // #317 follow-up: previously this returned a soft ack — the chat AI
  // saw it as success and called mark_complete next, leaving the user
  // on a fake "course created" card. Hard-fail so the AI must collect
  // the missing fields and retry create_course.
  return {
    earlyReturn: {
      content: JSON.stringify({
        ok: false,
        error:
          `Cannot create course yet — still missing required fields: ${labels.join(", ")}. ` +
          `Collect these first, then call create_course again. Do NOT call mark_complete until create_course succeeds.`,
        missingKeys: keys,
        missingLabels: labels,
      }),
      is_error: true,
    },
  };
}

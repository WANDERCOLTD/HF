/**
 * Auto-compose a prompt for a newly enrolled caller.
 * On failure, persists a CallerAttribute flag so the error is visible in the UI.
 */

import { executeComposition, loadComposeConfig, persistComposedPrompt } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import { prisma } from "@/lib/prisma";

export async function autoComposeForCaller(callerId: string): Promise<void> {
  try {
    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({});
    const composition = await executeComposition(callerId, sections, fullSpecConfig);
    const promptSummary = renderPromptSummary(composition.llmPrompt);

    await persistComposedPrompt(composition, promptSummary, {
      callerId,
      playbookId: null,
      triggerType: "enrollment",
      triggerCallId: undefined,
      composeSpecSlug: specSlug,
      specConfig: fullSpecConfig,
    });

    // Clear any previous failure flag
    await prisma.callerAttribute.deleteMany({
      where: { callerId, key: "compose_error", scope: "SYSTEM" },
    }).catch(() => {});

    console.log(`[auto-compose] Composed prompt for caller ${callerId} on enrollment`);
  } catch (err: any) {
    // Persist the failure so it can be surfaced in the UI
    await prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key: "compose_error", scope: "SYSTEM" } },
      create: {
        callerId,
        key: "compose_error",
        scope: "SYSTEM",
        valueType: "STRING",
        stringValue: err.message || "unknown error",
        sourceSpecSlug: "enrollment",
      },
      update: {
        stringValue: err.message || "unknown error",
      },
    }).catch((persistErr: any) => {
      console.error(`[auto-compose] Failed to persist error flag for ${callerId}:`, persistErr.message);
    });

    // Re-throw so the caller's .catch() still fires
    throw err;
  }
}

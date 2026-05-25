/**
 * Auto-compose a prompt for a newly enrolled caller.
 * On failure, persists a CallerAttribute flag so the error is visible in the UI.
 *
 * #825 — Story 1: short-circuits via `isPromptStale` when called for a caller
 * who already has a fresh `ComposedPrompt` row for this playbook. First
 * enrollment has no cached prompt → `composedAt = null` → stale → recompose.
 * Out-of-band callers (settings save fan-out, manual recompose) see "fresh"
 * when no upstream timestamp has been bumped since the last compose. Until
 * Stories 2–8 land their writer migrations, every cached prompt evaluates
 * as fresh — output is byte-identical because compose is deterministic.
 */

import { executeComposition, loadComposeConfig, persistComposedPrompt } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import { prisma } from "@/lib/prisma";
import { isPromptStale } from "@/lib/compose/staleness";

export async function autoComposeForCaller(callerId: string, playbookId?: string | null): Promise<void> {
  try {
    // #825 — staleness short-circuit. Avoids redundant recomposes when
    // out-of-band callers (settings save fan-out, manual recompose) hit
    // a caller whose prompt is already fresh. First-enrollment path has
    // no cached row → composedAt = null → stale → proceeds normally.
    if (playbookId) {
      const cached = await prisma.composedPrompt.findFirst({
        where: { callerId, playbookId, status: "active" },
        select: { composedAt: true },
        orderBy: { composedAt: "desc" },
      });
      if (cached) {
        const caller = await prisma.caller.findUnique({
          where: { id: callerId },
          select: { domainId: true },
        });
        const stale = await isPromptStale({
          composedAt: cached.composedAt,
          playbookId,
          callerId,
          domainId: caller?.domainId ?? null,
        });
        if (!stale) {
          console.log(
            `[auto-compose] caller ${callerId} playbook ${playbookId}: prompt is fresh, skipping recompose`,
          );
          return;
        }
      }
    }

    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig({});
    const composition = await executeComposition(callerId, sections, fullSpecConfig);
    const promptSummary = renderPromptSummary(composition.llmPrompt);

    await persistComposedPrompt(composition, promptSummary, {
      callerId,
      playbookId: playbookId ?? null,
      triggerType: "enrollment",
      triggerCallId: undefined,
      composeSpecSlug: specSlug,
      specConfig: fullSpecConfig,
    });

    // Clear any previous failure flag
    await prisma.callerAttribute.deleteMany({
      where: { callerId, key: "compose_error", scope: "SYSTEM" },
    }).catch(() => {});

    console.log(`[auto-compose] Composed prompt for caller ${callerId} (playbook: ${playbookId || "none"}) on enrollment`);
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

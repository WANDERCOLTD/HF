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
import { stampEnrollmentSessionPrompt } from "@/lib/voice/stamp-enrollment-session-prompt";

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

    const persisted = await persistComposedPrompt(composition, promptSummary, {
      callerId,
      playbookId: playbookId ?? null,
      triggerType: "enrollment",
      // #1344 Slice 4 — enrollment compose has no Session trigger; the
      // ENROLLMENT Session (when one exists via the IntakeEvent path) is
      // not the trigger of the n+1 prompt — the enrolment event itself
      // is. Leave undefined.
      triggerSessionId: undefined,
      composeSpecSlug: specSlug,
      specConfig: fullSpecConfig,
    });

    // #1420 — repair I-CT2 step 3 (the ENROLLMENT bootstrap terminal
    // guarantee). Stamp the just-persisted prompt back onto the caller's
    // ENROLLMENT Session row so `resolveUsedPromptId` step 3 returns it
    // as a durable anchor for any future call that bypasses step 2 (e.g.
    // the active ComposedPrompt got superseded by an out-of-band recompose).
    // Best-effort: a stamp failure must not propagate and break the
    // fire-and-forget contract. Logs but does not throw.
    try {
      const stampResult = await stampEnrollmentSessionPrompt(callerId, persisted.id);
      if (stampResult.stamped) {
        console.log(
          `[auto-compose] Stamped enrollment session ${stampResult.sessionId?.slice(0, 8)} ` +
            `with composed prompt ${persisted.id.slice(0, 8)} for caller ${callerId.slice(0, 8)}`,
        );
      } else if (stampResult.noEnrollmentSession) {
        // V2 flag off when this caller enrolled, or session-create failed.
        // Not an error — the I-CT2 step 2 path (most-recent ACTIVE) still
        // works without step 3.
        console.log(
          `[auto-compose] No ENROLLMENT session to stamp for caller ${callerId.slice(0, 8)} ` +
            `(V2 flag off at enrol time, or session-create failed)`,
        );
      } else {
        // Session existed but producedComposedPromptId was already set —
        // a reconciler race beat us. The reconciler's write is just as
        // valid as ours; nothing to do.
        console.log(
          `[auto-compose] Enrollment session ${stampResult.sessionId?.slice(0, 8)} already had ` +
            `producedComposedPromptId set (race with reconciler); leaving untouched`,
        );
      }
    } catch (stampErr) {
      console.error(
        `[auto-compose] stampEnrollmentSessionPrompt failed for caller ${callerId.slice(0, 8)}:`,
        stampErr instanceof Error ? stampErr.message : String(stampErr),
      );
    }

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

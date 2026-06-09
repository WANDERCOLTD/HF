// KB: catalogued in docs/kb/guard-registry.md (Slice 5 of epic #1338 — minimal-mode COMPOSE fallback).
/**
 * carryThroughCompose — the minimal-mode COMPOSE fallback shared by both
 *   - the reconciler (`lib/voice/reconciler.ts`), and
 *   - the live pipeline (`app/api/calls/[callId]/pipeline/route.ts`)
 *     when invoked with `partialFailureMode: "minimal"`.
 *
 * Contract (Slice 5 of epic #1338):
 *   - Always produces a ComposedPrompt — never throws under normal DB
 *     conditions.
 *   - Skips EXTRACT/AGGREGATE/REWARD outputs (those may be missing for a
 *     partial-failure Session). Reads ONLY the I-CT2 cascade.
 *   - The produced ComposedPrompt carries the prior prompt's body forward
 *     so n+1 has a structurally valid surface to run with.
 *   - Stamps `inputs.partialFailureMode = "minimal"` so the Tune tab
 *     surfaces a "↻ reconciled" badge.
 *   - Atomically supersedes the prior ACTIVE for the (callerId, playbookId)
 *     pair so the active-prompt invariant holds.
 *   - Atomically flips the Session's `producedComposedPromptId` so the
 *     I-CT1 orphan query stops returning this Session.
 *
 * The only way this function fails is when the I-CT2 cascade returns null
 * (caller has zero prior ComposedPrompts in any cascade step). That's the
 * "brand-new caller with no ENROLLMENT bootstrap" edge case — the caller
 * propagates this as a thrown Error; the reconciler counts it as a `failed`
 * row and the live pipeline surfaces it as a stage error.
 *
 * @see lib/voice/resolve-used-prompt.ts (I-CT2 cascade)
 * @see lib/voice/reconciler.ts (cron caller)
 * @see github.com/.../issues/1346
 */

import { prisma } from "@/lib/prisma";
import { resolveUsedPromptId } from "@/lib/voice/resolve-used-prompt";

export interface CarryThroughComposeArgs {
  sessionId: string;
  callerId: string;
  playbookId?: string | null;
  /** Free-form attribution — "reconciler" | "pipeline-minimal-mode". */
  triggerType?: string;
}

export interface CarryThroughComposeResult {
  composedPromptId: string;
  carryForwardSource: "previous-session" | "active-composed-prompt" | "enrollment-bootstrap";
  carryForwardPromptId: string;
  /** True when an in-flight pipeline race beat us to the producedComposedPromptId flip. */
  raced: boolean;
}

export async function carryThroughCompose(
  args: CarryThroughComposeArgs,
): Promise<CarryThroughComposeResult> {
  const { sessionId, callerId } = args;
  const playbookId = args.playbookId ?? null;
  const triggerType = args.triggerType ?? "reconciler";

  if (!sessionId) throw new Error("carryThroughCompose: sessionId is required");
  if (!callerId) throw new Error("carryThroughCompose: callerId is required");

  // I-CT2 cascade — already implemented in Slice 3. Returns the right
  // carry-forward target whether the caller has prior Session history,
  // a stale ACTIVE prompt, or only an ENROLLMENT bootstrap.
  const cascade = await resolveUsedPromptId({ callerId });
  if (!cascade.usedPromptId || cascade.source === "none") {
    throw new Error(
      `I-CT2 cascade returned null for caller ${callerId.slice(0, 8)} — no prior prompt to carry forward. ` +
        `Minimal-mode COMPOSE cannot reconcile a Session for a caller with zero prompt history.`,
    );
  }

  // Read the carried prompt's body + structured llmPrompt so the new row
  // is fully self-contained (downstream readers expect a complete record).
  const carried = await prisma.composedPrompt.findUnique({
    where: { id: cascade.usedPromptId },
    select: {
      prompt: true,
      llmPrompt: true,
      model: true,
    },
  });
  if (!carried) {
    throw new Error(
      `I-CT2 cascade resolved to ComposedPrompt id=${cascade.usedPromptId} but the row could not be read back — race with a hard-delete?`,
    );
  }

  const reconciledAt = new Date();

  // All three writes (create new, flip Session, supersede prior active)
  // happen in one tx — a partial commit must not leave the Session
  // "almost-reconciled".
  return await prisma.$transaction(async (tx) => {
    const composedPrompt = await tx.composedPrompt.create({
      data: {
        callerId,
        playbookId,
        prompt: carried.prompt,
        llmPrompt: carried.llmPrompt ?? undefined,
        triggerType,
        triggerSessionId: sessionId,
        model: carried.model ?? "reconciler-minimal",
        status: "active",
        inputs: {
          partialFailureMode: "minimal",
          reconciledAt: reconciledAt.toISOString(),
          carryForwardSource: cascade.source,
          carryForwardPromptId: cascade.usedPromptId,
          carryForwardSessionId: sessionId,
        },
      },
      select: { id: true },
    });

    // Atomic: only flip the Session if it's still orphaned. A second
    // reconciler racing this one (or the live pipeline finishing late)
    // would have already set producedComposedPromptId — in that case our
    // updateMany returns count=0 and we drop the row we just created.
    const updated = await tx.session.updateMany({
      where: { id: sessionId, producedComposedPromptId: null },
      data: { producedComposedPromptId: composedPrompt.id },
    });
    if (updated.count === 0) {
      await tx.composedPrompt.delete({ where: { id: composedPrompt.id } });
      return {
        composedPromptId: cascade.usedPromptId!,
        carryForwardSource: cascade.source as
          | "previous-session"
          | "active-composed-prompt"
          | "enrollment-bootstrap",
        carryForwardPromptId: cascade.usedPromptId!,
        raced: true,
      };
    }

    // Supersede prior active prompts for this (callerId, playbookId) —
    // mirrors persistComposedPrompt's behaviour so the Tune tab readers
    // see exactly one ACTIVE row per (callerId, playbookId).
    await tx.composedPrompt.updateMany({
      where: {
        callerId,
        id: { not: composedPrompt.id },
        status: "active",
        ...(playbookId ? { playbookId } : { playbookId: null }),
      },
      data: { status: "superseded" },
    });

    return {
      composedPromptId: composedPrompt.id,
      carryForwardSource: cascade.source as
        | "previous-session"
        | "active-composed-prompt"
        | "enrollment-bootstrap",
      carryForwardPromptId: cascade.usedPromptId!,
      raced: false,
    };
  });
}

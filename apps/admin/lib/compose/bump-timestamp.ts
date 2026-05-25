/**
 * Atomic `composeInputsUpdatedAt` bump helpers — #830 (Story 6 of EPIC #832).
 *
 * Shared write primitives used by out-of-band compose-affecting writes
 * (BehaviorTarget, CallerTarget, ops-route CallerMemory, goal confirmation,
 * caller identity PATCH). Each helper is a single-column UPDATE — they do
 * NOT diff inputs and do NOT read related rows. Use only after a
 * successful upstream write; do NOT call them speculatively.
 *
 * ## When NOT to call these
 *
 * - **Inside the pipeline** (`/api/calls/[callId]/pipeline/route.ts`).
 *   The pipeline's COMPOSE stage runs at the end of every pipeline
 *   invocation, so any write made earlier in the same run is already
 *   followed by a fresh recompose. Bumping mid-pipeline would set a
 *   timestamp later than the upcoming `ComposedPrompt.composedAt`,
 *   producing a spurious "not stale" verdict on the NEXT call. The
 *   pipeline's CallerMemory / CallerAttribute / CallerTarget writes are
 *   in scope of this exclusion.
 *
 * - **From seed scripts or pre-enrolment paths** where no callers exist
 *   yet. Helpers don't crash on missing rows but the bump is wasted work.
 *
 * ## When to call these
 *
 * - `bumpPlaybookComposeTimestamp(playbookId)` — after a successful
 *   `writeBehaviorTarget` PLAYBOOK-scope write. Marks every caller in the
 *   playbook stale (lazy recompose on next call).
 *
 * - `bumpCallerComposeTimestamp(callerId)` — after a successful out-of-
 *   band per-caller write: `writeCallerBehaviorTarget` (CALLER-scope
 *   target), ops-route memory create/update, goal confirmation, caller
 *   name/identity PATCH.
 *
 * Both helpers swallow `P2025` (row not found) silently — the upstream
 * write would have already reported the error and we don't want a missing
 * row to mask the real failure.
 */

import { prisma } from "@/lib/prisma";

/**
 * Stamp `Playbook.composeInputsUpdatedAt = now`. Use after a successful
 * PLAYBOOK-scope BehaviorTarget write. Blast radius: every caller in this
 * playbook (lazy recompose on next call).
 */
export async function bumpPlaybookComposeTimestamp(
  playbookId: string,
): Promise<void> {
  if (!playbookId) return;
  try {
    await prisma.playbook.update({
      where: { id: playbookId },
      data: { composeInputsUpdatedAt: new Date() },
    });
  } catch (err: any) {
    if (err?.code !== "P2025") throw err;
  }
}

/**
 * Stamp `Caller.composeInputsUpdatedAt = now`. Use after a successful
 * out-of-band per-caller compose-affecting write. Blast radius: just this
 * caller (lazy recompose on their next call).
 */
export async function bumpCallerComposeTimestamp(
  callerId: string,
): Promise<void> {
  if (!callerId) return;
  try {
    await prisma.caller.update({
      where: { id: callerId },
      data: { composeInputsUpdatedAt: new Date() },
    });
  } catch (err: any) {
    if (err?.code !== "P2025") throw err;
  }
}

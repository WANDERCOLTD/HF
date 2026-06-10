// KB: catalogued in docs/kb/guard-registry.md (#1420 — bootstrap-compose at enrollment).
/**
 * stampEnrollmentSessionPrompt — single-purpose patch helper that links a
 * just-composed bootstrap ComposedPrompt back to the caller's ENROLLMENT
 * Session row, repairing the I-CT2 step 3 terminal guarantee.
 *
 * Why this lives in its own file (not `create-session.ts`):
 *   The stamp is a write-AFTER-compose action that happens minutes after
 *   the Session was created. `create-session.ts` is intentionally a pure
 *   "create" surface; mixing a separate retroactive-mutation responsibility
 *   in there would muddy the boundary. Per TL revision (#1420) we keep
 *   the two concerns in separate files.
 *
 * Behaviour:
 *   - Finds the caller's most-recent `Session(kind='ENROLLMENT')` row.
 *   - Stamps `producedComposedPromptId` ONLY when it's currently null
 *     (idempotent + race-safe — a concurrent reconciler write must not be
 *     clobbered). Uses `updateMany(where: { producedComposedPromptId: null })`
 *     so the flip is atomic.
 *   - Best-effort: returns false instead of throwing when no ENROLLMENT
 *     Session exists (HF_FLAG_SESSION_MODEL_V2 was off when the enrolment
 *     happened, or the session-create itself failed). The caller's
 *     fire-and-forget contract requires that a downstream stamp failure
 *     must not propagate to the enrolment HTTP response.
 *
 * @see lib/voice/resolve-used-prompt.ts step 3 (the cascade step this
 *   helper repairs)
 * @see docs/CHAIN-CONTRACTS.md §3 Link 3b (I-CT2 invariant)
 * @see github.com/.../issues/1420 (this story)
 */

import { prisma } from "@/lib/prisma";

export interface StampEnrollmentSessionPromptResult {
  /** True when the stamp was applied (row found + producedComposedPromptId was null). */
  stamped: boolean;
  /** True when no ENROLLMENT Session exists for this caller (V2 flag off / pre-#1342 caller). */
  noEnrollmentSession: boolean;
  /** Session row we stamped, when `stamped === true`. */
  sessionId?: string;
}

export async function stampEnrollmentSessionPrompt(
  callerId: string,
  composedPromptId: string,
): Promise<StampEnrollmentSessionPromptResult> {
  if (!callerId) {
    throw new Error("stampEnrollmentSessionPrompt: callerId is required");
  }
  if (!composedPromptId) {
    throw new Error("stampEnrollmentSessionPrompt: composedPromptId is required");
  }

  // Find the most-recent ENROLLMENT Session for this caller. There is
  // usually exactly one; we use `findFirst` (vs `findUnique`) because the
  // schema does not have a (callerId, kind) unique on Session — multiple
  // ENROLLMENT events are possible after a DROP→re-enrol cycle.
  const enrolmentSession = await prisma.session.findFirst({
    where: { callerId, kind: "ENROLLMENT" },
    orderBy: { startedAt: "desc" },
    select: { id: true, producedComposedPromptId: true },
  });

  if (!enrolmentSession) {
    return { stamped: false, noEnrollmentSession: true };
  }

  // Atomic guard: only flip if still null. A reconciler that beat us here
  // would have already written a producedComposedPromptId; we must not
  // clobber it.
  const updated = await prisma.session.updateMany({
    where: { id: enrolmentSession.id, producedComposedPromptId: null },
    data: { producedComposedPromptId: composedPromptId },
  });

  return {
    stamped: updated.count > 0,
    noEnrollmentSession: false,
    sessionId: enrolmentSession.id,
  };
}

/**
 * #734 — auto status transitions on ticket activity.
 *
 * Rules (conservative v1):
 *   - First comment from someone OTHER than the creator on an OPEN ticket
 *     → status becomes IN_PROGRESS, post internal "Auto: picked up by …" comment.
 *   - Any comment on a WAITING ticket
 *     → status becomes IN_PROGRESS, post internal "Auto: activity resumed by …" comment.
 *
 * Not in v1 (parked):
 *   - RESOLVED → CLOSED via reporter "verified" keyword (too fragile; the
 *     Verify Fixed button in #730 covers this).
 *   - RESOLVED → OPEN via reporter "still broken" keyword (same).
 *   - IN_PROGRESS → WAITING after N days stale (needs a cron).
 *
 * Implementation notes:
 *   - Runs inside the same prisma `$transaction` that creates the user's
 *     comment. If the status update fails, the comment insert rolls back too.
 *   - `where: { id, status: <prev> }` guard makes concurrent calls idempotent:
 *     if two operators comment on an OPEN ticket within ms of each other, only
 *     the first flips the status; the second is a no-op.
 *   - The auto-comment is `isInternal=true` so partners don't see it.
 *     Author = the human whose action triggered the transition (NOT a synthetic
 *     "system" user), so audit attribution is clear.
 *   - Audit log uses `lib/audit.ts` (string action, no Prisma enum needed).
 */

import type { Prisma, TicketStatus } from "@prisma/client";
import { auditLog } from "@/lib/audit";

// Audit string (mirrors the existing string-action pattern in lib/audit.ts —
// no Prisma enum / migration needed).
const AUTO_ACTION = "ticket_status_auto_changed" as const;

export interface AutoStatusInput {
  ticketId: string;
  /** Status the ticket had immediately BEFORE this comment was inserted. */
  ticketStatusBefore: TicketStatus;
  /** Creator of the ticket — used to detect self-comments (skip pickup rule). */
  ticketCreatorId: string;
  /** Author of the new comment — drives the rules + audit attribution. */
  commentAuthorId: string;
  commentAuthorName: string;
  /** The comment row that just got created — referenced from the audit metadata. */
  triggeredByCommentId: string;
  /** Transaction client — auto-status must run in the same tx as the comment. */
  tx: Prisma.TransactionClient;
}

export interface AutoStatusResult {
  transitioned: boolean;
  from?: TicketStatus;
  to?: TicketStatus;
  autoCommentId?: string;
}

export async function applyAutoStatusTransition(input: AutoStatusInput): Promise<AutoStatusResult> {
  const { ticketId, ticketStatusBefore, ticketCreatorId, commentAuthorId, commentAuthorName, triggeredByCommentId, tx } = input;

  let toStatus: TicketStatus | null = null;
  let autoBody: string | null = null;

  // Rule 1 — OPEN + non-creator first comment → IN_PROGRESS
  if (ticketStatusBefore === "OPEN" && commentAuthorId !== ticketCreatorId) {
    toStatus = "IN_PROGRESS";
    autoBody = `Auto: picked up by ${commentAuthorName}`;
  }
  // Rule 2 — WAITING + any comment → IN_PROGRESS
  else if (ticketStatusBefore === "WAITING") {
    toStatus = "IN_PROGRESS";
    autoBody = `Auto: activity resumed by ${commentAuthorName}`;
  }

  if (!toStatus || !autoBody) {
    return { transitioned: false };
  }

  // Conditional update: only flips if status is still what we expect. If a
  // racing call already flipped it, `update.count === 0` and we bail out.
  const updateResult = await tx.ticket.updateMany({
    where: { id: ticketId, status: ticketStatusBefore },
    data: { status: toStatus },
  });
  if (updateResult.count === 0) {
    return { transitioned: false };
  }

  // Post the internal audit comment in the same transaction.
  const autoComment = await tx.ticketComment.create({
    data: {
      ticketId,
      authorId: commentAuthorId,
      content: autoBody,
      isInternal: true,
    },
    select: { id: true },
  });

  // Audit log — non-blocking, never throws. Called outside the tx is fine; the
  // ticket+comment writes are already durable by the time we get here.
  // Note: auditLog itself checks the toggle and silently no-ops when disabled.
  auditLog({
    userId: commentAuthorId,
    action: AUTO_ACTION,
    entityType: "Ticket",
    entityId: ticketId,
    metadata: {
      from: ticketStatusBefore,
      to: toStatus,
      triggeredByCommentId,
      autoCommentId: autoComment.id,
      reason: ticketStatusBefore === "OPEN" ? "pickup" : "resume",
    },
  }).catch((err) => {
    console.warn("[auto-status] audit log failed (non-fatal):", err);
  });

  return {
    transitioned: true,
    from: ticketStatusBefore,
    to: toStatus,
    autoCommentId: autoComment.id,
  };
}

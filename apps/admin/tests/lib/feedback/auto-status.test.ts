/**
 * #734 — applyAutoStatusTransition()
 *
 * Rules under test:
 *   - OPEN + non-creator comment → IN_PROGRESS, autoBody = "Auto: picked up by …"
 *   - OPEN + creator's OWN comment → no transition
 *   - WAITING + any comment → IN_PROGRESS, autoBody = "Auto: activity resumed by …"
 *   - IN_PROGRESS / RESOLVED / CLOSED → no transition
 *   - Concurrent flip (status no longer matches) → no transition + no auto-comment
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { applyAutoStatusTransition } from "@/lib/feedback/auto-status";

// Audit module is fire-and-forget — stub so the test never hits a real DB.
vi.mock("@/lib/audit", () => ({
  AuditAction: {},
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

function makeTx(opts: { updateCount: number; autoCommentId?: string }): Prisma.TransactionClient {
  const updateMany = vi.fn().mockResolvedValue({ count: opts.updateCount });
  const create = vi.fn().mockResolvedValue({ id: opts.autoCommentId ?? "auto-1" });
  return {
    ticket: { updateMany },
    ticketComment: { create },
  } as unknown as Prisma.TransactionClient;
}

describe("applyAutoStatusTransition — pickup rule (OPEN + non-creator)", () => {
  it("transitions OPEN → IN_PROGRESS when a non-creator comments", async () => {
    const tx = makeTx({ updateCount: 1, autoCommentId: "auto-A" });
    const result = await applyAutoStatusTransition({
      ticketId: "t1",
      ticketStatusBefore: "OPEN",
      ticketCreatorId: "creator-x",
      commentAuthorId: "operator-y",
      commentAuthorName: "Ola",
      triggeredByCommentId: "human-1",
      tx,
    });
    expect(result.transitioned).toBe(true);
    expect(result.from).toBe("OPEN");
    expect(result.to).toBe("IN_PROGRESS");
    expect(result.autoCommentId).toBe("auto-A");
    // updateMany was guarded by current status
    const updateArgs = vi.mocked(tx.ticket.updateMany).mock.calls[0][0];
    expect(updateArgs).toEqual({ where: { id: "t1", status: "OPEN" }, data: { status: "IN_PROGRESS" } });
    // Auto-comment is internal, attributed to the human who acted
    const commentArgs = vi.mocked(tx.ticketComment.create).mock.calls[0][0];
    expect(commentArgs.data).toMatchObject({
      ticketId: "t1",
      authorId: "operator-y",
      isInternal: true,
    });
    expect(commentArgs.data.content).toContain("Auto: picked up by Ola");
  });

  it("does NOT transition when the creator comments on their own OPEN ticket", async () => {
    const tx = makeTx({ updateCount: 0 });
    const result = await applyAutoStatusTransition({
      ticketId: "t1",
      ticketStatusBefore: "OPEN",
      ticketCreatorId: "creator-x",
      commentAuthorId: "creator-x", // same as creator
      commentAuthorName: "Creator",
      triggeredByCommentId: "human-1",
      tx,
    });
    expect(result).toEqual({ transitioned: false });
    expect(tx.ticket.updateMany).not.toHaveBeenCalled();
    expect(tx.ticketComment.create).not.toHaveBeenCalled();
  });
});

describe("applyAutoStatusTransition — resume rule (WAITING + any comment)", () => {
  it("transitions WAITING → IN_PROGRESS on any comment (including creator's)", async () => {
    const tx = makeTx({ updateCount: 1, autoCommentId: "auto-B" });
    const result = await applyAutoStatusTransition({
      ticketId: "t1",
      ticketStatusBefore: "WAITING",
      ticketCreatorId: "creator-x",
      commentAuthorId: "creator-x",
      commentAuthorName: "Creator",
      triggeredByCommentId: "human-1",
      tx,
    });
    expect(result.transitioned).toBe(true);
    expect(result.from).toBe("WAITING");
    expect(result.to).toBe("IN_PROGRESS");
    const commentArgs = vi.mocked(tx.ticketComment.create).mock.calls[0][0];
    expect(commentArgs.data.content).toContain("Auto: activity resumed by Creator");
  });
});

describe("applyAutoStatusTransition — terminal / mid states", () => {
  for (const status of ["IN_PROGRESS", "RESOLVED", "CLOSED"] as const) {
    it(`no-op when status is ${status}`, async () => {
      const tx = makeTx({ updateCount: 0 });
      const result = await applyAutoStatusTransition({
        ticketId: "t1",
        ticketStatusBefore: status,
        ticketCreatorId: "creator-x",
        commentAuthorId: "operator-y",
        commentAuthorName: "Ola",
        triggeredByCommentId: "human-1",
        tx,
      });
      expect(result).toEqual({ transitioned: false });
      expect(tx.ticket.updateMany).not.toHaveBeenCalled();
      expect(tx.ticketComment.create).not.toHaveBeenCalled();
    });
  }
});

describe("applyAutoStatusTransition — concurrent flip", () => {
  it("returns transitioned=false when updateMany.count = 0 (another caller already flipped status)", async () => {
    const tx = makeTx({ updateCount: 0 }); // simulate the race-loser
    const result = await applyAutoStatusTransition({
      ticketId: "t1",
      ticketStatusBefore: "OPEN", // we *thought* it was OPEN but a concurrent comment already moved it
      ticketCreatorId: "creator-x",
      commentAuthorId: "operator-y",
      commentAuthorName: "Ola",
      triggeredByCommentId: "human-1",
      tx,
    });
    expect(result).toEqual({ transitioned: false });
    // We attempted the guarded update but didn't insert the auto-comment
    expect(tx.ticket.updateMany).toHaveBeenCalledOnce();
    expect(tx.ticketComment.create).not.toHaveBeenCalled();
  });
});

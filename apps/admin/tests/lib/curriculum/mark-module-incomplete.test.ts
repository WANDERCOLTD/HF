/**
 * Behavioural tests for `lib/curriculum/mark-module-incomplete.ts` (#1703).
 *
 * Pins:
 *   - First incomplete attempt records → {attempts: 1, waived: false},
 *     status untouched.
 *   - Second incomplete attempt waives → {attempts: 2, waived: true},
 *     status = "COMPLETED" + completedAt set.
 *   - Continuous course → short-circuit, no DB write, {attempts: 0, waived: false}.
 *   - Missing `CallerModuleProgress` row → loud-skip (AppLog), no write,
 *     {attempts: 0, waived: false}.
 *   - Increment uses Prisma `{ increment: 1 }` (atomic via row-level lock).
 *   - Throws on missing callerId / moduleId.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

import { markModuleIncomplete } from "@/lib/curriculum/mark-module-incomplete";
import { log } from "@/lib/logger";

interface TxMock {
  callerModuleProgress: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function makeTx(): TxMock {
  return {
    callerModuleProgress: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("markModuleIncomplete", () => {
  let tx: TxMock;

  beforeEach(() => {
    tx = makeTx();
    vi.clearAllMocks();
  });

  describe("first incomplete attempt", () => {
    it("records and returns {attempts: 1, waived: false} without touching status", async () => {
      tx.callerModuleProgress.findUnique.mockResolvedValue({
        incompleteAttempts: 0,
        status: "IN_PROGRESS",
      });
      tx.callerModuleProgress.update.mockResolvedValue({
        incompleteAttempts: 1,
      });

      const result = await markModuleIncomplete(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
        playbookId: "playbook-1",
        durationSeconds: 12,
        minSpeakingSec: 360,
      });

      expect(result).toEqual({ attempts: 1, waived: false });
      expect(tx.callerModuleProgress.update).toHaveBeenCalledTimes(1);
      const updateCall = tx.callerModuleProgress.update.mock.calls[0][0];
      expect(updateCall.data.incompleteAttempts).toEqual({ increment: 1 });
      // First attempt — status is NOT touched.
      expect(updateCall.data.status).toBeUndefined();
      expect(updateCall.data.completedAt).toBeUndefined();
      expect(log).toHaveBeenCalledWith(
        "system",
        "module.incomplete.recorded",
        expect.objectContaining({
          callerId: "caller-1",
          moduleId: "module-1",
          attempts: 1,
        }),
      );
    });
  });

  describe("second incomplete attempt (waiver)", () => {
    it("waives and returns {attempts: 2, waived: true}, sets status COMPLETED + completedAt", async () => {
      tx.callerModuleProgress.findUnique.mockResolvedValue({
        incompleteAttempts: 1,
        status: "IN_PROGRESS",
      });
      tx.callerModuleProgress.update.mockResolvedValue({
        incompleteAttempts: 2,
      });

      const result = await markModuleIncomplete(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });

      expect(result).toEqual({ attempts: 2, waived: true });
      const updateCall = tx.callerModuleProgress.update.mock.calls[0][0];
      expect(updateCall.data.incompleteAttempts).toEqual({ increment: 1 });
      expect(updateCall.data.status).toBe("COMPLETED");
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
      expect(log).toHaveBeenCalledWith(
        "system",
        "module.incomplete.waived",
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it("uses status='COMPLETED' (DB convention) NOT 'MASTERED' (presentational)", async () => {
      tx.callerModuleProgress.findUnique.mockResolvedValue({
        incompleteAttempts: 1,
        status: "IN_PROGRESS",
      });
      tx.callerModuleProgress.update.mockResolvedValue({
        incompleteAttempts: 2,
      });

      await markModuleIncomplete(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });

      const updateCall = tx.callerModuleProgress.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe("COMPLETED");
      expect(updateCall.data.status).not.toBe("MASTERED");
    });
  });

  describe("courseStyle default-deny (guard #1252)", () => {
    it("short-circuits on courseStyle='continuous' — no DB read, no write", async () => {
      const result = await markModuleIncomplete(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "continuous",
      });

      expect(result).toEqual({ attempts: 0, waived: false });
      expect(tx.callerModuleProgress.findUnique).not.toHaveBeenCalled();
      expect(tx.callerModuleProgress.update).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        "system",
        "module.incomplete.skipped_continuous",
        expect.objectContaining({ courseStyle: "continuous" }),
      );
    });
  });

  describe("missing CallerModuleProgress row", () => {
    it("loud-skips when no progress row exists — no write, no waiver", async () => {
      tx.callerModuleProgress.findUnique.mockResolvedValue(null);

      const result = await markModuleIncomplete(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });

      expect(result).toEqual({ attempts: 0, waived: false });
      expect(tx.callerModuleProgress.update).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        "system",
        "module.incomplete.no_progress_row",
        expect.objectContaining({
          callerId: "caller-1",
          moduleId: "module-1",
        }),
      );
    });
  });

  describe("input validation", () => {
    it("throws on empty callerId", async () => {
      await expect(
        markModuleIncomplete(tx as never, {
          callerId: "",
          moduleId: "module-1",
          courseStyle: "structured",
        }),
      ).rejects.toThrow(/callerId is required/);
    });

    it("throws on empty moduleId", async () => {
      await expect(
        markModuleIncomplete(tx as never, {
          callerId: "caller-1",
          moduleId: "",
          courseStyle: "structured",
        }),
      ).rejects.toThrow(/moduleId is required/);
    });
  });

  describe("atomic increment shape", () => {
    it("uses Prisma's `{ increment: 1 }` so concurrent webhooks don't both miss the waiver", async () => {
      tx.callerModuleProgress.findUnique.mockResolvedValue({
        incompleteAttempts: 0,
        status: "IN_PROGRESS",
      });
      tx.callerModuleProgress.update.mockResolvedValue({
        incompleteAttempts: 1,
      });

      await markModuleIncomplete(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });

      const updateCall = tx.callerModuleProgress.update.mock.calls[0][0];
      // The atomic shape is the load-bearing invariant — two concurrent
      // endSession webhooks must NOT both observe incompleteAttempts=0
      // and both decide "no waiver". `{ increment: 1 }` resolves under
      // Postgres row-level lock.
      expect(updateCall.data.incompleteAttempts).toEqual({ increment: 1 });
      expect(updateCall.where.callerId_moduleId).toEqual({
        callerId: "caller-1",
        moduleId: "module-1",
      });
    });
  });
});

/**
 * Tests for lib/ai/task-guidance.ts — task tracking + guidance
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Prisma mock ──────────────────────────────────────
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    userTask: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
      create: (...args: any[]) => mockCreate(...args),
    },
    $transaction: (...args: any[]) => mockTransaction(...args),
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import {
  startTaskTracking,
  updateTaskProgress,
  completeTask,
} from "@/lib/ai/task-guidance";

describe("task-guidance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── startTaskTracking ────────────────────────────────

  describe("startTaskTracking", () => {
    it("creates a UserTask with correct fields", async () => {
      mockCreate.mockResolvedValue({ id: "task-1" });

      const id = await startTaskTracking("user-1", "content_wizard", {
        subjectId: "sub-1",
      });

      expect(id).toBe("task-1");
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          taskType: "content_wizard",
          status: "in_progress",
          currentStep: 1,
          context: { subjectId: "sub-1" },
        }),
      });
    });

    it("uses TASK_STEP_MAPS to determine totalSteps", async () => {
      mockCreate.mockResolvedValue({ id: "task-2" });

      await startTaskTracking("user-1", "content_wizard");

      // content_wizard has 7 steps
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ totalSteps: 7 }),
      });
    });

    it("defaults to 5 steps for unknown task types", async () => {
      mockCreate.mockResolvedValue({ id: "task-3" });

      await startTaskTracking("user-1", "unknown_type");

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ totalSteps: 5 }),
      });
    });
  });

  // ── updateTaskProgress ───────────────────────────────

  describe("updateTaskProgress", () => {
    it("updates simple fields without transaction", async () => {
      mockUpdate.mockResolvedValue({});

      await updateTaskProgress("task-1", { currentStep: 3 });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: expect.objectContaining({ currentStep: 3 }),
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("uses transaction for context updates to prevent race conditions", async () => {
      // Simulate the transaction executing its callback
      mockTransaction.mockImplementation(async (cb: any) => cb({
        userTask: {
          findUnique: mockFindUnique,
          update: mockUpdate,
        },
      }));
      mockFindUnique.mockResolvedValue({
        context: { existing: "value", subjectId: "sub-1" },
      });
      mockUpdate.mockResolvedValue({});

      await updateTaskProgress("task-1", {
        context: { newField: "new-value" },
      });

      expect(mockTransaction).toHaveBeenCalled();
      // Should deep-merge existing + new context
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: expect.objectContaining({
          context: {
            existing: "value",
            subjectId: "sub-1",
            newField: "new-value",
          },
        }),
      });
    });

    it("handles missing existing context gracefully", async () => {
      mockTransaction.mockImplementation(async (cb: any) => cb({
        userTask: {
          findUnique: mockFindUnique,
          update: mockUpdate,
        },
      }));
      mockFindUnique.mockResolvedValue({ context: null });
      mockUpdate.mockResolvedValue({});

      await updateTaskProgress("task-1", {
        context: { field: "value" },
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: expect.objectContaining({
          context: { field: "value" },
        }),
      });
    });

    it("handles non-existent task gracefully in context merge", async () => {
      mockTransaction.mockImplementation(async (cb: any) => cb({
        userTask: {
          findUnique: mockFindUnique,
          update: mockUpdate,
        },
      }));
      mockFindUnique.mockResolvedValue(null);
      mockUpdate.mockResolvedValue({});

      await updateTaskProgress("task-1", {
        context: { field: "value" },
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: expect.objectContaining({
          context: { field: "value" },
        }),
      });
    });

    it("updates completedSteps and blockers without transaction", async () => {
      mockUpdate.mockResolvedValue({});

      await updateTaskProgress("task-1", {
        completedSteps: ["step-1", "step-2"],
        blockers: ["missing-source"],
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: expect.objectContaining({
          completedSteps: ["step-1", "step-2"],
          blockers: ["missing-source"],
        }),
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  // ── completeTask ─────────────────────────────────────

  describe("completeTask", () => {
    it("sets status to completed with timestamp", async () => {
      mockUpdate.mockResolvedValue({});

      await completeTask("task-1");

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: expect.objectContaining({
          status: "completed",
          completedAt: expect.any(Date),
        }),
      });
    });
  });
});

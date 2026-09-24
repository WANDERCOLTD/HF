/**
 * Behavioural tests for `lib/curriculum/mark-orientation-shown.ts` (#1730
 * Story D — epic #1700 Theme 1 G8 consumer D).
 *
 * Pins:
 *   - Structured course + flag on → upsert fires (`orientationShown: true`
 *     on update branch, `status: NOT_STARTED` sentinel on create branch).
 *   - Idempotent — calling twice on the same (caller, module) keeps the
 *     value at true; no other field changes.
 *   - Continuous course → short-circuit, no DB write, AppLog skipped_continuous.
 *   - Flag off → silent skip (no AppLog, no DB write) — migration-window
 *     posture per epic #1700 decision 5.
 *   - Throws on empty callerId / moduleId (mirrors mark-module-incomplete).
 *   - AppLog `module.orientation.marked` fires on success.
 *   - Helper does NOT touch `status` / `mastery` / `incompleteAttempts` on
 *     the update branch (sibling-writer isolation).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

import { markOrientationShownIfApplicable } from "@/lib/curriculum/mark-orientation-shown";
import { log } from "@/lib/logger";

interface TxMock {
  callerModuleProgress: {
    upsert: ReturnType<typeof vi.fn>;
  };
}

function makeTx(): TxMock {
  return {
    callerModuleProgress: {
      upsert: vi.fn().mockResolvedValue({ id: "progress-1" }),
    },
  };
}

const ORIGINAL_FLAG = process.env.HF_FLAG_IELTS_MODULE_SETTINGS;

describe("markOrientationShownIfApplicable", () => {
  let tx: TxMock;

  beforeEach(() => {
    tx = makeTx();
    vi.clearAllMocks();
    process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "true";
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;
    } else {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = ORIGINAL_FLAG;
    }
  });

  describe("structured course + flag on", () => {
    it("upserts orientationShown=true and returns {marked: true}", async () => {
      const result = await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
        playbookId: "playbook-1",
      });

      expect(result).toEqual({ marked: true });
      expect(tx.callerModuleProgress.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = tx.callerModuleProgress.upsert.mock.calls[0][0];
      expect(upsertCall.where.callerId_moduleId).toEqual({
        callerId: "caller-1",
        moduleId: "module-1",
      });
      expect(upsertCall.update).toEqual({ orientationShown: true });
      expect(upsertCall.create).toEqual({
        callerId: "caller-1",
        moduleId: "module-1",
        orientationShown: true,
        status: "NOT_STARTED",
      });
    });

    it("AppLogs module.orientation.marked on success", async () => {
      await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
        playbookId: "playbook-1",
      });

      expect(log).toHaveBeenCalledWith(
        "system",
        "module.orientation.marked",
        expect.objectContaining({
          callerId: "caller-1",
          moduleId: "module-1",
          playbookId: "playbook-1",
        }),
      );
    });

    it("does NOT touch status / mastery / incompleteAttempts on the update branch (sibling-writer isolation)", async () => {
      await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });

      const upsertCall = tx.callerModuleProgress.upsert.mock.calls[0][0];
      // The update branch must touch ONLY orientationShown — any other
      // field would clobber the sibling writers (track-progress for
      // mastery/status, mark-module-incomplete for incompleteAttempts).
      expect(Object.keys(upsertCall.update)).toEqual(["orientationShown"]);
      expect(upsertCall.update.status).toBeUndefined();
      expect(upsertCall.update.mastery).toBeUndefined();
      expect(upsertCall.update.incompleteAttempts).toBeUndefined();
      expect(upsertCall.update.completedAt).toBeUndefined();
    });

    it("create-branch uses status='NOT_STARTED' sentinel — never NULL or MASTERED", async () => {
      await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });

      const upsertCall = tx.callerModuleProgress.upsert.mock.calls[0][0];
      // Create branch fires when the orientation directive renders before
      // track-progress.ts has materialised the row. NOT_STARTED is the
      // schema default + the DB convention sentinel.
      expect(upsertCall.create.status).toBe("NOT_STARTED");
      expect(upsertCall.create.orientationShown).toBe(true);
    });
  });

  describe("idempotency", () => {
    it("a second call on the same (caller, module) still issues an upsert with orientationShown=true (no-op at DB level)", async () => {
      // First call — latch closes.
      await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });
      // Second call — same args. Helper does not pre-check; it just
      // upserts. Postgres treats `orientationShown: true → true` as a
      // no-op write (no row-change side effects beyond the row-version
      // bump). Outcome from the helper's perspective: same {marked: true}.
      const result2 = await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });

      expect(result2).toEqual({ marked: true });
      expect(tx.callerModuleProgress.upsert).toHaveBeenCalledTimes(2);
      // Both calls write the same body — orientationShown: true is
      // structurally idempotent.
      for (const call of tx.callerModuleProgress.upsert.mock.calls) {
        expect(call[0].update).toEqual({ orientationShown: true });
      }
    });
  });

  describe("courseStyle default-deny (guard #1252)", () => {
    it("short-circuits on courseStyle='continuous' — no DB write, AppLog skipped_continuous", async () => {
      const result = await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "continuous",
        playbookId: "playbook-1",
      });

      expect(result).toEqual({
        marked: false,
        skipReason: "non_structured_course",
      });
      expect(tx.callerModuleProgress.upsert).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        "system",
        "module.orientation.skipped_continuous",
        expect.objectContaining({
          courseStyle: "continuous",
          playbookId: "playbook-1",
        }),
      );
    });
  });

  describe("flag off (migration-window posture)", () => {
    it("silent skip when HF_FLAG_IELTS_MODULE_SETTINGS is not 'true' — no AppLog, no DB write", async () => {
      delete process.env.HF_FLAG_IELTS_MODULE_SETTINGS;

      const result = await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
        playbookId: "playbook-1",
      });

      expect(result).toEqual({ marked: false, skipReason: "flag_off" });
      expect(tx.callerModuleProgress.upsert).not.toHaveBeenCalled();
      // Silent — too noisy during the org-wide migration window.
      expect(log).not.toHaveBeenCalled();
    });

    it("silent skip when flag is literal 'false' — no AppLog, no DB write", async () => {
      process.env.HF_FLAG_IELTS_MODULE_SETTINGS = "false";

      const result = await markOrientationShownIfApplicable(tx as never, {
        callerId: "caller-1",
        moduleId: "module-1",
        courseStyle: "structured",
      });

      expect(result).toEqual({ marked: false, skipReason: "flag_off" });
      expect(tx.callerModuleProgress.upsert).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });
  });

  describe("input validation", () => {
    it("throws on empty callerId", async () => {
      await expect(
        markOrientationShownIfApplicable(tx as never, {
          callerId: "",
          moduleId: "module-1",
          courseStyle: "structured",
        }),
      ).rejects.toThrow(/callerId is required/);
    });

    it("throws on empty moduleId", async () => {
      await expect(
        markOrientationShownIfApplicable(tx as never, {
          callerId: "caller-1",
          moduleId: "",
          courseStyle: "structured",
        }),
      ).rejects.toThrow(/moduleId is required/);
    });
  });
});

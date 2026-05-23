/**
 * #661 — writeCallerBehaviorTarget unit tests.
 *
 * Exercises the new CALLER-scope helper introduced for the Cmd+K Tuning
 * tab's LEARNER scope. Mirrors the existing writeBehaviorTarget contract
 * (whitelist check, value clamp, source labelling) but resolves multiple
 * CallerIdentity rows per caller — matching the HTTP sidebar route's
 * behaviour at `app/api/callers/[callerId]/behavior-targets/route.ts`.
 *
 * See: gh issue view 661
 *      lib/agent-tuner/write-target.ts (writeCallerBehaviorTarget)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  callerFindUnique: vi.fn(),
  parameterFindMany: vi.fn(),
  behaviorTargetFindFirst: vi.fn(),
  behaviorTargetCreate: vi.fn(),
  behaviorTargetUpdate: vi.fn(),
  behaviorTargetDeleteMany: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caller: { findUnique: mocks.callerFindUnique },
    parameter: { findMany: mocks.parameterFindMany },
    behaviorTarget: {
      findFirst: mocks.behaviorTargetFindFirst,
      create: mocks.behaviorTargetCreate,
      update: mocks.behaviorTargetUpdate,
      deleteMany: mocks.behaviorTargetDeleteMany,
    },
    $transaction: mocks.$transaction,
  },
}));

import { writeCallerBehaviorTarget } from "@/lib/agent-tuner/write-target";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parameterFindMany.mockResolvedValue([
    { parameterId: "BEH-WARMTH" },
    { parameterId: "BEH-CHALLENGE" },
  ]);
  // Default: $transaction runs the callback against a tx object that proxies
  // to the same mocks (matching the route's usage at line 75-123).
  mocks.$transaction.mockImplementation(async (fn: any) => {
    return fn({
      behaviorTarget: {
        findFirst: mocks.behaviorTargetFindFirst,
        create: mocks.behaviorTargetCreate,
        update: mocks.behaviorTargetUpdate,
      },
    });
  });
});

describe("#661 — writeCallerBehaviorTarget", () => {
  it("returns caller_not_found when the caller doesn't exist", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce(null);
    const result = await writeCallerBehaviorTarget("nonexistent", "BEH-WARMTH", 0.7);
    expect(result).toEqual({ ok: false, parameterId: "BEH-WARMTH", reason: "caller_not_found" });
  });

  it("returns caller_has_no_identity when the caller has zero CallerIdentity rows", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({ id: "c1", callerIdentities: [] });
    const result = await writeCallerBehaviorTarget("c1", "BEH-WARMTH", 0.7);
    expect(result).toEqual({ ok: false, parameterId: "BEH-WARMTH", reason: "caller_has_no_identity" });
  });

  it("returns parameter_not_adjustable for an off-catalogue parameter", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }],
    });
    const result = await writeCallerBehaviorTarget("c1", "BEH-INVENTED", 0.7);
    expect(result).toEqual({ ok: false, parameterId: "BEH-INVENTED", reason: "parameter_not_adjustable" });
  });

  it("creates a CALLER-scope row per identity when none exists (happy path)", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }, { id: "i2" }],
    });
    mocks.behaviorTargetFindFirst.mockResolvedValue(null);
    mocks.behaviorTargetCreate.mockResolvedValue({});

    const result = await writeCallerBehaviorTarget("c1", "BEH-WARMTH", 0.7);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("created");
      expect(result.value).toBe(0.7);
      expect(result.identitiesAffected).toBe(2);
    }
    expect(mocks.behaviorTargetCreate).toHaveBeenCalledTimes(2);
    expect(mocks.behaviorTargetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parameterId: "BEH-WARMTH",
        scope: "CALLER",
        callerIdentityId: "i1",
        targetValue: 0.7,
        source: "MANUAL",
      }),
    });
  });

  it("updates existing CALLER-scope rows when they're already there", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }],
    });
    mocks.behaviorTargetFindFirst.mockResolvedValueOnce({ id: "bt1" });
    mocks.behaviorTargetUpdate.mockResolvedValue({});

    const result = await writeCallerBehaviorTarget("c1", "BEH-WARMTH", 0.85);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toBe("updated");
    expect(mocks.behaviorTargetUpdate).toHaveBeenCalledWith({
      where: { id: "bt1" },
      data: expect.objectContaining({ targetValue: 0.85, source: "MANUAL" }),
    });
    expect(mocks.behaviorTargetCreate).not.toHaveBeenCalled();
  });

  it("clamps targetValue into [0, 1]", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }],
    });
    mocks.behaviorTargetFindFirst.mockResolvedValue(null);
    mocks.behaviorTargetCreate.mockResolvedValue({});

    const high = await writeCallerBehaviorTarget("c1", "BEH-WARMTH", 1.5);
    expect(high.ok && high.value).toBe(1);

    vi.clearAllMocks();
    mocks.parameterFindMany.mockResolvedValue([{ parameterId: "BEH-WARMTH" }]);
    mocks.$transaction.mockImplementation(async (fn: any) =>
      fn({
        behaviorTarget: {
          findFirst: mocks.behaviorTargetFindFirst,
          create: mocks.behaviorTargetCreate,
          update: mocks.behaviorTargetUpdate,
        },
      }),
    );
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }],
    });
    mocks.behaviorTargetFindFirst.mockResolvedValue(null);

    const low = await writeCallerBehaviorTarget("c1", "BEH-WARMTH", -0.5);
    expect(low.ok && low.value).toBe(0);
  });

  it("removes all CALLER-scope rows when targetValue is null", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }, { id: "i2" }],
    });
    mocks.behaviorTargetDeleteMany.mockResolvedValueOnce({ count: 2 });

    const result = await writeCallerBehaviorTarget("c1", "BEH-WARMTH", null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("removed");
      expect(result.value).toBeNull();
      expect(result.identitiesAffected).toBe(2);
    }
    expect(mocks.behaviorTargetDeleteMany).toHaveBeenCalledWith({
      where: {
        parameterId: "BEH-WARMTH",
        scope: "CALLER",
        callerIdentityId: { in: ["i1", "i2"] },
        effectiveUntil: null,
      },
    });
  });

  it("returns noop when null is passed but no row existed to delete", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }],
    });
    mocks.behaviorTargetDeleteMany.mockResolvedValueOnce({ count: 0 });

    const result = await writeCallerBehaviorTarget("c1", "BEH-WARMTH", null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("noop");
      expect(result.identitiesAffected).toBe(0);
    }
  });

  it("records source='TUNING_CHAT' when passed via options", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }],
    });
    mocks.behaviorTargetFindFirst.mockResolvedValue(null);
    mocks.behaviorTargetCreate.mockResolvedValue({});

    await writeCallerBehaviorTarget("c1", "BEH-WARMTH", 0.7, { source: "TUNING_CHAT" });

    expect(mocks.behaviorTargetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: "TUNING_CHAT" }),
    });
  });

  it("defaults source to MANUAL when not provided", async () => {
    mocks.callerFindUnique.mockResolvedValueOnce({
      id: "c1",
      callerIdentities: [{ id: "i1" }],
    });
    mocks.behaviorTargetFindFirst.mockResolvedValue(null);
    mocks.behaviorTargetCreate.mockResolvedValue({});

    await writeCallerBehaviorTarget("c1", "BEH-WARMTH", 0.7);

    expect(mocks.behaviorTargetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: "MANUAL" }),
    });
  });
});

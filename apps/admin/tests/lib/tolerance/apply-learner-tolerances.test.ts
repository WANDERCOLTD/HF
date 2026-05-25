/**
 * #598 Slice 1 — per-learner tolerance write path.
 *
 * Verifies upsert idempotency, the allowlist gate, and that every write emits
 * an audit log row with action `AuditAction.TOLERANCE_WRITE`.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerAttribute: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  auditLog: vi.fn(),
  AuditAction: { TOLERANCE_WRITE: "tolerance_write" },
}));

import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { applyLearnerTolerance } from "@/lib/tolerance/apply-learner-tolerances";

const upsertMock = prisma.callerAttribute.upsert as unknown as Mock;
const auditMock = auditLog as unknown as Mock;

beforeEach(() => {
  upsertMock.mockReset();
  upsertMock.mockResolvedValue({});
  auditMock.mockReset();
});

describe("applyLearnerTolerance", () => {
  it("upserts a CallerAttribute with scope=TOLERANCE and writes audit log", async () => {
    await applyLearnerTolerance({
      callerId: "c-1",
      key: "firstCall",
      value: { durationMinsOverride: 5 },
      actor: { userId: "u-1", userEmail: "teacher@example.com" },
    });

    expect(prisma.callerAttribute.upsert).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];
    expect(call.where.callerId_key_scope).toEqual({
      callerId: "c-1",
      key: "firstCall",
      scope: "TOLERANCE",
    });
    expect(call.create.jsonValue).toEqual({ durationMinsOverride: 5 });
    expect(call.update.jsonValue).toEqual({ durationMinsOverride: 5 });

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: "tolerance_write",
      entityType: "Caller",
      entityId: "c-1",
      userId: "u-1",
      userEmail: "teacher@example.com",
    });
  });

  it("is idempotent — a second call with the same payload still goes through upsert", async () => {
    await applyLearnerTolerance({
      callerId: "c-1",
      key: "firstCall",
      value: { introducePedagogy: false },
    });
    await applyLearnerTolerance({
      callerId: "c-1",
      key: "firstCall",
      value: { introducePedagogy: false },
    });
    expect(prisma.callerAttribute.upsert).toHaveBeenCalledTimes(2);
    // Both calls target the same compound key — DB will dedupe via @@unique.
    const calls = upsertMock.mock.calls;
    expect(calls[0][0].where.callerId_key_scope.key).toBe("firstCall");
    expect(calls[1][0].where.callerId_key_scope.key).toBe("firstCall");
  });

  it("throws on an unknown tolerance key without touching the DB", async () => {
    await expect(
      applyLearnerTolerance({
        callerId: "c-1",
        // @ts-expect-error — intentionally bypassing the type to hit the runtime guard
        key: "noSuchKey",
        value: { foo: 1 } as never,
      }),
    ).rejects.toThrow(/unknown key/i);
    expect(prisma.callerAttribute.upsert).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock variables referenced inside vi.mock factories
const { mockConfig, mockAuditLog, mockDeleteCallerData } = vi.hoisted(() => ({
  mockConfig: {
    retention: {
      callerDataDays: 0,
      auditLogDays: 365,
    },
  },
  mockAuditLog: vi.fn(),
  mockDeleteCallerData: vi.fn().mockResolvedValue({
    callScores: 0, behaviorMeasurements: 0, callTargets: 0, rewardScores: 0,
    callerMemories: 0, callerMemorySummaries: 0, personalityObservations: 0,
    callerPersonalities: 0, callerPersonalityProfiles: 0, promptSlugSelections: 0,
    composedPrompts: 0, callerTargets: 0, callerAttributes: 0, callerIdentities: 0,
    goals: 0, artifacts: 0, inboundMessages: 0, onboardingSessions: 0, calls: 0,
  }),
}));

vi.mock("@/lib/config", () => ({ config: mockConfig }));

vi.mock("@/lib/audit", () => ({
  auditLog: mockAuditLog,
  AuditAction: {
    RETENTION_CLEANUP: "retention_cleanup",
  },
}));

vi.mock("@/lib/gdpr/delete-caller-data", () => ({
  deleteCallerData: mockDeleteCallerData,
}));

// Import mocked prisma from setup
import { prisma } from "@/lib/prisma";
const mockPrisma = prisma as any;

// Add missing mock methods
mockPrisma.caller.findMany = vi.fn().mockResolvedValue([]);
mockPrisma.auditLog = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
// #1917 — row-level Call expiry purge added to the cleanup route
mockPrisma.call = mockPrisma.call ?? {};
mockPrisma.call.deleteMany = vi.fn().mockResolvedValue({ count: 0 });

import { POST } from "@/app/api/admin/retention/cleanup/route";

describe("POST /api/admin/retention/cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.retention.callerDataDays = 0;
    mockConfig.retention.auditLogDays = 365;
    mockPrisma.caller.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.call.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("returns skipped when both retention periods are 0", async () => {
    mockConfig.retention.callerDataDays = 0;
    mockConfig.retention.auditLogDays = 0;

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.results.skipped).toBe(true);
    expect(body.results.reason).toBe("retention disabled");
  });

  it("deletes expired callers when retention enabled", async () => {
    mockConfig.retention.callerDataDays = 30;

    const expiredCallers = [
      { id: "caller-old-1" },
      { id: "caller-old-2" },
    ];
    mockPrisma.caller.findMany.mockResolvedValue(expiredCallers);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.results.callerRetention.enabled).toBe(true);
    expect(body.results.callerRetention.callersDeleted).toBe(2);
    expect(mockDeleteCallerData).toHaveBeenCalledTimes(2);
    expect(mockDeleteCallerData).toHaveBeenCalledWith("caller-old-1");
    expect(mockDeleteCallerData).toHaveBeenCalledWith("caller-old-2");
  });

  it("deletes old audit logs when retention enabled", async () => {
    mockConfig.retention.callerDataDays = 0;
    mockConfig.retention.auditLogDays = 90;
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 42 });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.auditLogRetention.enabled).toBe(true);
    expect(body.results.auditLogRetention.auditLogsDeleted).toBe(42);
  });

  it("is idempotent — returns 0 when no expired data", async () => {
    mockConfig.retention.callerDataDays = 30;
    mockPrisma.caller.findMany.mockResolvedValue([]);

    const res = await POST();
    const body = await res.json();

    expect(body.results.callerRetention.callersDeleted).toBe(0);
    expect(mockDeleteCallerData).not.toHaveBeenCalled();
  });

  it("audit logs the cleanup action", async () => {
    mockConfig.retention.callerDataDays = 30;
    mockPrisma.caller.findMany.mockResolvedValue([{ id: "caller-1" }]);

    await POST();

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "retention_cleanup",
        entityType: "System",
        metadata: expect.objectContaining({
          callerRetentionDays: 30,
          callersDeleted: 1,
        }),
      })
    );
  });

  it("continues processing if one caller deletion fails", async () => {
    mockConfig.retention.callerDataDays = 30;
    mockPrisma.caller.findMany.mockResolvedValue([
      { id: "caller-ok" },
      { id: "caller-fail" },
      { id: "caller-ok-2" },
    ]);

    mockDeleteCallerData
      .mockResolvedValueOnce({ calls: 1 })
      .mockRejectedValueOnce(new Error("FK constraint"))
      .mockResolvedValueOnce({ calls: 2 });

    const res = await POST();
    const body = await res.json();

    // 2 succeeded, 1 failed
    expect(body.results.callerRetention.callersDeleted).toBe(2);
    expect(mockDeleteCallerData).toHaveBeenCalledTimes(3);
  });
});

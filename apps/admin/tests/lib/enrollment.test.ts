/**
 * Tests for lib/enrollment/index.ts
 *
 * Enrollment helper: enroll, unenroll, pause, resume, complete, domain-wide enrollment.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  callerPlaybook: {
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  playbook: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

import {
  enrollCaller,
  enrollCallerInDomainPlaybooks,
  resolveAndEnrollSingle,
  unenrollCaller,
  getActiveEnrollments,
  getAllEnrollments,
  completeEnrollment,
  pauseEnrollment,
  resumeEnrollment,
  dropAllActiveEnrollments,
  getPlaybookRoster,
} from "@/lib/enrollment";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enrollCaller", () => {
  it("upserts a CallerPlaybook record with ACTIVE status", async () => {
    const enrollment = {
      id: "enr-1",
      callerId: "caller-1",
      playbookId: "pb-1",
      status: "ACTIVE",
      enrolledBy: "quick-launch",
    };
    mockPrisma.callerPlaybook.upsert.mockResolvedValue(enrollment);

    const result = await enrollCaller("caller-1", "pb-1", "quick-launch");

    expect(mockPrisma.callerPlaybook.upsert).toHaveBeenCalledWith({
      where: { callerId_playbookId: { callerId: "caller-1", playbookId: "pb-1" } },
      create: {
        callerId: "caller-1",
        playbookId: "pb-1",
        status: "ACTIVE",
        enrolledBy: "quick-launch",
      },
      update: {
        status: "ACTIVE",
        enrolledBy: "quick-launch",
        pausedAt: null,
        droppedAt: null,
      },
    });
    expect(result).toEqual(enrollment);
  });

  it("accepts a transaction client", async () => {
    const txMock = {
      callerPlaybook: {
        upsert: vi.fn().mockResolvedValue({ id: "enr-1" }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn().mockResolvedValue({ id: "enr-1", isDefault: true }),
      },
    };

    await enrollCaller("caller-1", "pb-1", "manual", txMock as any);

    expect(txMock.callerPlaybook.upsert).toHaveBeenCalled();
    expect(mockPrisma.callerPlaybook.upsert).not.toHaveBeenCalled();
  });

  // ── #1429 — policyMode plumbing ───────────────────────────────────

  it("does NOT set policyMode in the create branch when opts.policyMode is omitted (defaults handled by Prisma)", async () => {
    mockPrisma.callerPlaybook.upsert.mockResolvedValue({
      id: "enr-1",
      callerId: "caller-1",
      playbookId: "pb-1",
    });
    mockPrisma.callerPlaybook.count.mockResolvedValue(0);

    await enrollCaller("caller-1", "pb-1", "auto");

    const call = mockPrisma.callerPlaybook.upsert.mock.calls[0][0];
    // Schema default is "production"; helper should not pass an
    // explicit field so the schema controls the default.
    expect(call.create.policyMode).toBeUndefined();
    // The update branch must NEVER carry policyMode — re-enrolment
    // preserves the existing classification (#1429 TL revision #2).
    expect(call.update.policyMode).toBeUndefined();
  });

  it("threads policyMode='demo' into the create branch ONLY when opts.policyMode='demo'", async () => {
    mockPrisma.callerPlaybook.upsert.mockResolvedValue({
      id: "enr-1",
      callerId: "caller-1",
      playbookId: "pb-1",
    });
    mockPrisma.callerPlaybook.count.mockResolvedValue(0);

    await enrollCaller("caller-1", "pb-1", "admin-test-enrol", undefined, {
      policyMode: "demo",
    });

    const call = mockPrisma.callerPlaybook.upsert.mock.calls[0][0];
    expect(call.create.policyMode).toBe("demo");
    // CRITICAL: the update branch still does NOT include policyMode.
    // Re-enrolment must preserve the existing value, never overwrite it.
    expect(call.update.policyMode).toBeUndefined();
  });

  it("update branch never mentions policyMode (#1429 TL rev #2 — preserves demo classification on re-enrolment)", async () => {
    mockPrisma.callerPlaybook.upsert.mockResolvedValue({
      id: "enr-1",
      callerId: "caller-1",
      playbookId: "pb-1",
    });
    mockPrisma.callerPlaybook.count.mockResolvedValue(1);

    await enrollCaller("caller-1", "pb-1", "auto", undefined, {
      policyMode: "production",
    });

    const call = mockPrisma.callerPlaybook.upsert.mock.calls[0][0];
    // Even when the create branch sets production, the update branch
    // must omit policyMode — a row already marked demo stays demo.
    expect(call.update.policyMode).toBeUndefined();
    expect(call.update).toEqual({
      status: "ACTIVE",
      enrolledBy: "auto",
      pausedAt: null,
      droppedAt: null,
    });
  });
});

describe("enrollCallerInDomainPlaybooks", () => {
  it("enrolls caller in all published playbooks for the domain", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1" },
      { id: "pb-2" },
    ]);
    mockPrisma.callerPlaybook.upsert
      .mockResolvedValueOnce({ id: "enr-1", playbookId: "pb-1" })
      .mockResolvedValueOnce({ id: "enr-2", playbookId: "pb-2" });

    const results = await enrollCallerInDomainPlaybooks("caller-1", "domain-1", "auto");

    expect(mockPrisma.playbook.findMany).toHaveBeenCalledWith({
      where: { domainId: "domain-1", status: "PUBLISHED" },
      select: { id: true },
    });
    expect(results).toHaveLength(2);
    expect(mockPrisma.callerPlaybook.upsert).toHaveBeenCalledTimes(2);
  });

  it("returns empty array when domain has no published playbooks", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([]);

    const results = await enrollCallerInDomainPlaybooks("caller-1", "domain-1", "auto");

    expect(results).toHaveLength(0);
    expect(mockPrisma.callerPlaybook.upsert).not.toHaveBeenCalled();
  });
});

describe("resolveAndEnrollSingle", () => {
  it("enrolls in explicit playbookId when provided", async () => {
    const enrollment = { id: "enr-1", callerId: "caller-1", playbookId: "pb-explicit", status: "ACTIVE" };
    mockPrisma.callerPlaybook.upsert.mockResolvedValue(enrollment);
    mockPrisma.callerPlaybook.count.mockResolvedValue(1);
    mockPrisma.callerPlaybook.update.mockResolvedValue({ ...enrollment, isDefault: true });

    const result = await resolveAndEnrollSingle("caller-1", "domain-1", "auto", "pb-explicit");

    expect(result).toBeTruthy();
    expect(result!.playbookId).toBe("pb-explicit");
    // Should NOT query playbooks — explicit takes priority
    expect(mockPrisma.playbook.findMany).not.toHaveBeenCalled();
  });

  it("auto-selects when domain has exactly 1 published playbook", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([{ id: "pb-only" }]);
    const enrollment = { id: "enr-1", callerId: "caller-1", playbookId: "pb-only", status: "ACTIVE" };
    mockPrisma.callerPlaybook.upsert.mockResolvedValue(enrollment);
    mockPrisma.callerPlaybook.count.mockResolvedValue(1);
    mockPrisma.callerPlaybook.update.mockResolvedValue({ ...enrollment, isDefault: true });

    const result = await resolveAndEnrollSingle("caller-1", "domain-1", "auto");

    expect(result).toBeTruthy();
    expect(result!.playbookId).toBe("pb-only");
  });

  it("returns null when domain has multiple published playbooks", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1" },
      { id: "pb-2" },
      { id: "pb-3" },
    ]);

    const result = await resolveAndEnrollSingle("caller-1", "domain-1", "auto");

    expect(result).toBeNull();
    expect(mockPrisma.callerPlaybook.upsert).not.toHaveBeenCalled();
  });

  it("returns null when domain has no published playbooks", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([]);

    const result = await resolveAndEnrollSingle("caller-1", "domain-1", "auto");

    expect(result).toBeNull();
    expect(mockPrisma.callerPlaybook.upsert).not.toHaveBeenCalled();
  });
});

describe("unenrollCaller", () => {
  it("sets status to DROPPED with timestamp", async () => {
    const now = new Date();
    vi.useFakeTimers({ now });

    mockPrisma.callerPlaybook.update.mockResolvedValue({
      id: "enr-1",
      status: "DROPPED",
      droppedAt: now,
    });

    await unenrollCaller("caller-1", "pb-1");

    expect(mockPrisma.callerPlaybook.update).toHaveBeenCalledWith({
      where: { callerId_playbookId: { callerId: "caller-1", playbookId: "pb-1" } },
      data: { status: "DROPPED", droppedAt: now },
    });

    vi.useRealTimers();
  });
});

describe("getActiveEnrollments", () => {
  it("returns only ACTIVE enrollments", async () => {
    const enrollments = [
      { id: "enr-1", callerId: "caller-1", playbookId: "pb-1", status: "ACTIVE" },
    ];
    mockPrisma.callerPlaybook.findMany.mockResolvedValue(enrollments);

    const result = await getActiveEnrollments("caller-1");

    expect(mockPrisma.callerPlaybook.findMany).toHaveBeenCalledWith({
      where: { callerId: "caller-1", status: "ACTIVE" },
      orderBy: { enrolledAt: "asc" },
    });
    expect(result).toEqual(enrollments);
  });
});

describe("getAllEnrollments", () => {
  it("returns all enrollments with playbook details", async () => {
    const enrollments = [
      { id: "enr-1", status: "ACTIVE", playbook: { id: "pb-1", name: "Class A" } },
      { id: "enr-2", status: "DROPPED", playbook: { id: "pb-2", name: "Class B" } },
    ];
    mockPrisma.callerPlaybook.findMany.mockResolvedValue(enrollments);

    const result = await getAllEnrollments("caller-1");

    expect(mockPrisma.callerPlaybook.findMany).toHaveBeenCalledWith({
      where: { callerId: "caller-1" },
      include: {
        playbook: { select: { id: true, name: true, status: true, domainId: true } },
      },
      orderBy: { enrolledAt: "asc" },
    });
    expect(result).toHaveLength(2);
  });
});

describe("completeEnrollment", () => {
  it("sets status to COMPLETED with timestamp", async () => {
    const now = new Date();
    vi.useFakeTimers({ now });

    mockPrisma.callerPlaybook.update.mockResolvedValue({ status: "COMPLETED" });

    await completeEnrollment("caller-1", "pb-1");

    expect(mockPrisma.callerPlaybook.update).toHaveBeenCalledWith({
      where: { callerId_playbookId: { callerId: "caller-1", playbookId: "pb-1" } },
      data: { status: "COMPLETED", completedAt: now },
    });

    vi.useRealTimers();
  });
});

describe("pauseEnrollment", () => {
  it("sets status to PAUSED with timestamp", async () => {
    const now = new Date();
    vi.useFakeTimers({ now });

    mockPrisma.callerPlaybook.update.mockResolvedValue({ status: "PAUSED" });

    await pauseEnrollment("caller-1", "pb-1");

    expect(mockPrisma.callerPlaybook.update).toHaveBeenCalledWith({
      where: { callerId_playbookId: { callerId: "caller-1", playbookId: "pb-1" } },
      data: { status: "PAUSED", pausedAt: now },
    });

    vi.useRealTimers();
  });
});

describe("resumeEnrollment", () => {
  it("sets status to ACTIVE and clears pausedAt", async () => {
    mockPrisma.callerPlaybook.update.mockResolvedValue({ status: "ACTIVE" });

    await resumeEnrollment("caller-1", "pb-1");

    expect(mockPrisma.callerPlaybook.update).toHaveBeenCalledWith({
      where: { callerId_playbookId: { callerId: "caller-1", playbookId: "pb-1" } },
      data: { status: "ACTIVE", pausedAt: null },
    });
  });
});

describe("dropAllActiveEnrollments", () => {
  it("drops all ACTIVE enrollments for a caller", async () => {
    const now = new Date();
    vi.useFakeTimers({ now });

    mockPrisma.callerPlaybook.updateMany.mockResolvedValue({ count: 3 });

    const result = await dropAllActiveEnrollments("caller-1");

    expect(mockPrisma.callerPlaybook.updateMany).toHaveBeenCalledWith({
      where: { callerId: "caller-1", status: "ACTIVE" },
      data: { status: "DROPPED", droppedAt: now },
    });
    expect(result.count).toBe(3);

    vi.useRealTimers();
  });
});

describe("getPlaybookRoster", () => {
  it("returns enrolled callers for a playbook", async () => {
    const roster = [
      { id: "enr-1", caller: { id: "c-1", name: "Alice" } },
      { id: "enr-2", caller: { id: "c-2", name: "Bob" } },
    ];
    mockPrisma.callerPlaybook.findMany.mockResolvedValue(roster);

    const result = await getPlaybookRoster("pb-1");

    expect(mockPrisma.callerPlaybook.findMany).toHaveBeenCalledWith({
      where: { playbookId: "pb-1" },
      include: {
        caller: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { enrolledAt: "asc" },
    });
    expect(result).toHaveLength(2);
  });

  it("filters by status when provided", async () => {
    mockPrisma.callerPlaybook.findMany.mockResolvedValue([]);

    await getPlaybookRoster("pb-1", "ACTIVE");

    expect(mockPrisma.callerPlaybook.findMany).toHaveBeenCalledWith({
      where: { playbookId: "pb-1", status: "ACTIVE" },
      include: {
        caller: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { enrolledAt: "asc" },
    });
  });
});

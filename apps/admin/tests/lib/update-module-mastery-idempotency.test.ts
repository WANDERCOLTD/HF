/**
 * #547 — `updateModuleMastery` idempotency guard.
 *
 * Locks in the behaviour that the legacy mastery write path does NOT
 * double-count `callCount` when the canonical `incrementModuleEvidence`
 * has already counted this exact call. Two writers, one row, one
 * increment per call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    callerModuleProgress: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/curriculum/resolve-module", () => ({
  resolveModuleByLogicalId: vi.fn(async (_curriculumId: string, slug: string) => ({
    id: `uuid-for-${slug}`,
    slug,
  })),
  resolveCurriculumIdForPlaybook: vi.fn(),
}));

import { updateModuleMastery } from "@/lib/curriculum/track-progress";

describe("#547 updateModuleMastery idempotency", () => {
  beforeEach(() => {
    mockPrisma.callerModuleProgress.findUnique.mockReset();
    mockPrisma.callerModuleProgress.upsert.mockReset();
  });

  it("creates the row with callCount=1 on first ever call", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue(null);
    mockPrisma.callerModuleProgress.upsert.mockResolvedValue({});

    await updateModuleMastery(
      "caller-1",
      "curriculum-1",
      "part1",
      0.6,
      "call-1",
    );

    expect(mockPrisma.callerModuleProgress.upsert).toHaveBeenCalledTimes(1);
    const args = mockPrisma.callerModuleProgress.upsert.mock.calls[0][0];
    expect(args.create.callCount).toBe(1);
    expect(args.update).toHaveProperty("callCount"); // standard increment path
  });

  it("SKIPS the increment when the canonical path already counted this call", async () => {
    // Canonical incrementModuleEvidence ran first and set lastCallId
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      callCount: 1,
      loScoresJson: null,
      lastCallId: "call-1",
    });
    mockPrisma.callerModuleProgress.upsert.mockResolvedValue({});

    await updateModuleMastery(
      "caller-1",
      "curriculum-1",
      "part1",
      0.6,
      "call-1", // same callId as the existing row's lastCallId
    );

    const args = mockPrisma.callerModuleProgress.upsert.mock.calls[0][0];
    // The update branch must NOT contain a callCount field
    expect(args.update).not.toHaveProperty("callCount");
    // Mastery + status still update
    expect(args.update).toHaveProperty("mastery");
    expect(args.update).toHaveProperty("status");
  });

  it("INCREMENTS when the row exists but this is a different call", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      callCount: 1,
      loScoresJson: null,
      lastCallId: "prior-call",
    });
    mockPrisma.callerModuleProgress.upsert.mockResolvedValue({});

    await updateModuleMastery(
      "caller-1",
      "curriculum-1",
      "part1",
      0.6,
      "call-2", // different from existing lastCallId
    );

    const args = mockPrisma.callerModuleProgress.upsert.mock.calls[0][0];
    expect(args.update.callCount).toEqual({ increment: 1 });
  });

  it("INCREMENTS when callId is not provided (legacy call sites without #547 plumbing)", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      callCount: 5,
      loScoresJson: null,
      lastCallId: "some-earlier-call",
    });
    mockPrisma.callerModuleProgress.upsert.mockResolvedValue({});

    // No callId passed
    await updateModuleMastery("caller-1", "curriculum-1", "part1", 0.6);

    const args = mockPrisma.callerModuleProgress.upsert.mock.calls[0][0];
    expect(args.update.callCount).toEqual({ increment: 1 });
  });

  it("INCREMENTS when callId matches but existing callCount is 0 (transitional rows)", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      callCount: 0,
      loScoresJson: null,
      lastCallId: "call-1",
    });
    mockPrisma.callerModuleProgress.upsert.mockResolvedValue({});

    await updateModuleMastery(
      "caller-1",
      "curriculum-1",
      "part1",
      0.6,
      "call-1",
    );

    const args = mockPrisma.callerModuleProgress.upsert.mock.calls[0][0];
    expect(args.update.callCount).toEqual({ increment: 1 });
  });

  it("loScoresJson is written on every call regardless of idempotency skip", async () => {
    mockPrisma.callerModuleProgress.findUnique.mockResolvedValue({
      callCount: 1,
      loScoresJson: { "LO-01": { mastery: 0.5, callCount: 1 } },
      lastCallId: "call-1",
    });
    mockPrisma.callerModuleProgress.upsert.mockResolvedValue({});

    await updateModuleMastery(
      "caller-1",
      "curriculum-1",
      "part1",
      0.6,
      "call-1", // same callId — increment skipped
      { "LO-01": 0.7 },
    );

    const args = mockPrisma.callerModuleProgress.upsert.mock.calls[0][0];
    expect(args.update).not.toHaveProperty("callCount");
    expect(args.update).toHaveProperty("loScoresJson");
  });
});

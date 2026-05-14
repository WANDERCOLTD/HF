/**
 * Tests for GET /api/tasks/counts
 *
 * Verifies:
 *   - Returns processing and completedRecent counts
 *   - Filters by current user
 *   - completedRecent only includes last 24h
 *   - Handles zero counts gracefully
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup ──

const mockPrisma = vi.hoisted(() => ({
  userTask: {
    count: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "user-1", email: "test@example.com", role: "VIEWER" } },
  }),
  isAuthError: vi.fn((result: any) => "error" in result),
}));

import { GET } from "@/app/api/tasks/counts/route";

// ── Tests ──

describe("GET /api/tasks/counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns processing and completedRecent counts", async () => {
    mockPrisma.userTask.count
      .mockResolvedValueOnce(3)   // processing
      .mockResolvedValueOnce(7);  // completedRecent

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.counts).toEqual({
      processing: 3,
      completedRecent: 7,
    });
  });

  it("filters by current user ID", async () => {
    mockPrisma.userTask.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await GET();

    // Both count calls should filter by userId
    expect(mockPrisma.userTask.count).toHaveBeenCalledTimes(2);

    const processingCall = mockPrisma.userTask.count.mock.calls[0][0];
    expect(processingCall.where.userId).toBe("user-1");
    expect(processingCall.where.status).toBe("in_progress");

    const completedCall = mockPrisma.userTask.count.mock.calls[1][0];
    expect(completedCall.where.userId).toBe("user-1");
    expect(completedCall.where.status).toBe("completed");
    expect(completedCall.where.completedAt).toBeDefined();
    expect(completedCall.where.completedAt.gte).toBeInstanceOf(Date);
  });

  it("returns zeros when no tasks exist", async () => {
    mockPrisma.userTask.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.counts).toEqual({ processing: 0, completedRecent: 0 });
  });

  it("completedRecent uses 24h window", async () => {
    mockPrisma.userTask.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const before = Date.now();
    await GET();
    const after = Date.now();

    const completedCall = mockPrisma.userTask.count.mock.calls[1][0];
    const gteDate = completedCall.where.completedAt.gte as Date;
    const gteTime = gteDate.getTime();

    // The gte date should be ~24h ago (within 1 second tolerance)
    const expectedMin = before - 24 * 60 * 60 * 1000 - 1000;
    const expectedMax = after - 24 * 60 * 60 * 1000 + 1000;
    expect(gteTime).toBeGreaterThanOrEqual(expectedMin);
    expect(gteTime).toBeLessThanOrEqual(expectedMax);
  });
});

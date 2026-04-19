/**
 * Tests for getTpProgressSummaryBatch — single-query batch version
 * of getTpProgressSummary for multiple callers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock setup ──

const mockFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callerAttribute: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}));

vi.mock("@/lib/contracts/registry", () => ({
  ContractRegistry: {
    getKeyPattern: vi.fn().mockResolvedValue("curriculum:{specSlug}:{key}"),
  },
}));

// Must import after mocks
import { getTpProgressSummaryBatch } from "@/lib/curriculum/track-progress";

describe("getTpProgressSummaryBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty map for empty callerIds", async () => {
    const result = await getTpProgressSummaryBatch([], "CURR-001");
    expect(result.size).toBe(0);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("issues a single DB query for multiple callers", async () => {
    mockFindMany.mockResolvedValue([
      { callerId: "c1", stringValue: "mastered" },
      { callerId: "c1", stringValue: "mastered" },
      { callerId: "c1", stringValue: "in_progress" },
      { callerId: "c2", stringValue: "not_started" },
      { callerId: "c2", stringValue: "mastered" },
    ]);

    const result = await getTpProgressSummaryBatch(["c1", "c2", "c3"], "CURR-001");

    // Single query issued
    expect(mockFindMany).toHaveBeenCalledTimes(1);

    // Verify query shape
    const queryArg = mockFindMany.mock.calls[0][0];
    expect(queryArg.where.callerId).toEqual({ in: ["c1", "c2", "c3"] });
    expect(queryArg.where.scope).toBe("CURRICULUM");
    expect(queryArg.select.callerId).toBe(true);
    expect(queryArg.select.stringValue).toBe(true);

    // Check per-caller results
    expect(result.get("c1")).toEqual({
      totalTps: 3,
      mastered: 2,
      inProgress: 1,
      notStarted: 0,
    });
    expect(result.get("c2")).toEqual({
      totalTps: 2,
      mastered: 1,
      inProgress: 0,
      notStarted: 1,
    });
    // c3 has no progress — should have zeroes
    expect(result.get("c3")).toEqual({
      totalTps: 0,
      mastered: 0,
      inProgress: 0,
      notStarted: 0,
    });
  });

  it("handles single caller", async () => {
    mockFindMany.mockResolvedValue([
      { callerId: "c1", stringValue: "mastered" },
    ]);

    const result = await getTpProgressSummaryBatch(["c1"], "CURR-001");
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(result.get("c1")).toEqual({
      totalTps: 1,
      mastered: 1,
      inProgress: 0,
      notStarted: 0,
    });
  });

  it("counts unknown stringValues as notStarted", async () => {
    mockFindMany.mockResolvedValue([
      { callerId: "c1", stringValue: "some_unknown_value" },
      { callerId: "c1", stringValue: null },
    ]);

    const result = await getTpProgressSummaryBatch(["c1"], "CURR-001");
    expect(result.get("c1")).toEqual({
      totalTps: 2,
      mastered: 0,
      inProgress: 0,
      notStarted: 2,
    });
  });

  it("uses correct key prefix from contract pattern", async () => {
    mockFindMany.mockResolvedValue([]);

    await getTpProgressSummaryBatch(["c1"], "MY-SPEC");

    const queryArg = mockFindMany.mock.calls[0][0];
    expect(queryArg.where.key.startsWith).toBe("curriculum:MY-SPEC:tp_status:");
  });
});

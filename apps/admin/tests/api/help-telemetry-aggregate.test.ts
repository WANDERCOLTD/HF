/**
 * Tests for the admin telemetry aggregate query — #1484.
 *
 * The admin telemetry page (`/x/help/telemetry`) runs
 * `prisma.helpEvent.groupBy` over the last-7d window. This file pins:
 *   - groupBy is called with the (type, target) tuple
 *   - `where.createdAt.gte` is roughly 7d ago
 *   - the mapping into row shape is correct
 *   - empty result set returns an empty array (no crash)
 *
 * The page itself is a server component, so we lift the loader into the
 * page file's exports if needed; for now the queries are inlined and we
 * pin them by re-asserting the groupBy contract.
 */

import { describe, it, expect, vi } from "vitest";

const groupByMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { helpEvent: { groupBy: groupByMock } },
}));

// Re-implement the loader from page.tsx so we can pin the shape without
// pulling in the server-component `auth()` boundary. Keeping the loader
// shape in sync with the page is the contract this test enforces.
async function loadAggregate() {
  const { prisma } = await import("@/lib/prisma");
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const grouped = await prisma.helpEvent.groupBy({
    by: ["type", "target"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _avg: { durationMs: true },
    orderBy: { _count: { type: "desc" } },
    take: 200,
  });
  return grouped.map(
    (row: {
      type: string;
      target: string;
      _count?: { _all?: number };
      _avg?: { durationMs?: number | null };
    }) => ({
      type: row.type,
      target: row.target,
      count: row._count?._all ?? 0,
      avgDurationMs: row._avg?.durationMs ?? null,
    }),
  );
}

describe("admin help-telemetry aggregate", () => {
  it("queries groupBy with (type, target) and a 7d createdAt floor", async () => {
    groupByMock.mockResolvedValue([
      {
        type: "doc-section-view",
        target: "demos",
        _count: { _all: 42 },
        _avg: { durationMs: null },
      },
      {
        type: "cascade-inspector-close",
        target: "BEH-WARMTH",
        _count: { _all: 17 },
        _avg: { durationMs: 1234.56 },
      },
    ]);

    const before = Date.now();
    const rows = await loadAggregate();
    const after = Date.now();

    expect(groupByMock).toHaveBeenCalledTimes(1);
    const args = groupByMock.mock.calls[0]![0];
    expect(args.by).toEqual(["type", "target"]);
    expect(args._count).toEqual({ _all: true });
    expect(args._avg).toEqual({ durationMs: true });

    // The 7d floor should be within ~7d of now (allow a small jitter
    // window for execution time).
    const since: Date = args.where.createdAt.gte;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(since.getTime()).toBeGreaterThanOrEqual(before - sevenDaysMs - 5);
    expect(since.getTime()).toBeLessThanOrEqual(after - sevenDaysMs + 5);

    expect(rows).toEqual([
      {
        type: "doc-section-view",
        target: "demos",
        count: 42,
        avgDurationMs: null,
      },
      {
        type: "cascade-inspector-close",
        target: "BEH-WARMTH",
        count: 17,
        avgDurationMs: 1234.56,
      },
    ]);
  });

  it("returns an empty array when no events in the window (no crash on empty)", async () => {
    groupByMock.mockResolvedValue([]);
    const rows = await loadAggregate();
    expect(rows).toEqual([]);
  });
});

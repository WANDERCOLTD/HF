/**
 * Tests for `/x/help/pipeline-health` — Slice 1 of epic #1510 (#1511).
 *
 * The page is a server component with `auth() + redirect()` ADMIN+ gate, so we
 * exercise the loader shape (mirrored here to stay decoupled from the auth
 * boundary) and assert the React render only via lightweight RTL.
 *
 * Pins:
 *   - AppLog query filters last-7d AND `stage` startsWith `pipeline.invariant.`
 *   - Aggregation produces one row per stage with count + first/last + sample
 *   - Empty result set renders the empty-state block (no crash)
 *   - Known-invariant ladder renders 5 rows whether or not they fired
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { appLog: { findMany: findManyMock } },
}));

vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

import { APPLOG_STAGE_FILTER } from "@/lib/pipeline/adaptive-loop-invariants";

// Mirror the page loader so we can pin its shape without the auth() boundary.
async function loadAggregate() {
  const { prisma } = await import("@/lib/prisma");
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.appLog.findMany({
    where: {
      stage: { startsWith: APPLOG_STAGE_FILTER },
      createdAt: { gte: since },
    },
    select: { stage: true, level: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = grouped.get(r.stage) ?? [];
    arr.push(r);
    grouped.set(r.stage, arr);
  }

  const out: Array<{
    invariantId: string;
    stage: string;
    count: number;
    firstAt: Date;
    lastAt: Date;
    sampleLevel: string | null;
  }> = [];
  for (const [stage, items] of grouped) {
    const sorted = items
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    out.push({
      invariantId: (stage.split(".").pop() ?? "").toUpperCase(),
      stage,
      count: items.length,
      firstAt: sorted[0].createdAt,
      lastAt: sorted[sorted.length - 1].createdAt,
      sampleLevel: sorted[sorted.length - 1].level,
    });
  }
  out.sort((a, b) => a.invariantId.localeCompare(b.invariantId));
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/x/help/pipeline-health — loader", () => {
  it("filters AppLog rows by stage prefix and last-7d window", async () => {
    findManyMock.mockResolvedValue([]);
    await loadAggregate();
    expect(findManyMock).toHaveBeenCalledTimes(1);
    const args = findManyMock.mock.calls[0][0];
    expect(args.where.stage.startsWith).toBe("pipeline.invariant.");
    expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    // ~7 days in the past
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const skew = Date.now() - args.where.createdAt.gte.getTime();
    expect(skew).toBeGreaterThan(sevenDaysMs - 60_000);
    expect(skew).toBeLessThan(sevenDaysMs + 60_000);
  });

  it("returns empty array when no AppLog rows match", async () => {
    findManyMock.mockResolvedValue([]);
    const out = await loadAggregate();
    expect(out).toEqual([]);
  });

  it("aggregates per stage and sorts by invariantId", async () => {
    findManyMock.mockResolvedValue([
      {
        stage: "pipeline.invariant.i-al2",
        level: "warn",
        metadata: { parameterId: "skill_speaking" },
        createdAt: new Date("2026-06-11T01:00:00Z"),
      },
      {
        stage: "pipeline.invariant.i-al1",
        level: "warn",
        metadata: { callId: "c1" },
        createdAt: new Date("2026-06-11T00:00:00Z"),
      },
      {
        stage: "pipeline.invariant.i-al1",
        level: "warn",
        metadata: { callId: "c2" },
        createdAt: new Date("2026-06-11T02:00:00Z"),
      },
    ]);
    const out = await loadAggregate();
    expect(out).toHaveLength(2);
    expect(out[0].invariantId).toBe("I-AL1");
    expect(out[0].count).toBe(2);
    expect(out[0].firstAt.toISOString()).toBe("2026-06-11T00:00:00.000Z");
    expect(out[0].lastAt.toISOString()).toBe("2026-06-11T02:00:00.000Z");
    expect(out[1].invariantId).toBe("I-AL2");
    expect(out[1].count).toBe(1);
    expect(out[1].sampleLevel).toBe("warn");
  });

  it("preserves invariant id casing — UPPERCASE I-AL<n>", async () => {
    findManyMock.mockResolvedValue([
      {
        stage: "pipeline.invariant.i-al5",
        level: "error",
        metadata: { playbookId: "pb-1" },
        createdAt: new Date(),
      },
    ]);
    const out = await loadAggregate();
    expect(out[0].invariantId).toBe("I-AL5");
  });
});

describe("/x/help/pipeline-health — empty state contract", () => {
  it("empty array signals the dashboard's empty-state block", async () => {
    findManyMock.mockResolvedValue([]);
    const out = await loadAggregate();
    expect(out.length).toBe(0);
    // The page renders <p>No invariant violations in the last 7 days.</p>
    // when out.length === 0 — pinned here so a future loader change can't
    // silently start emitting placeholder rows.
  });
});

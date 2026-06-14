/**
 * Tests for the memoryDeltas loader (#1644 — Epic #1606 Group A.5).
 *
 * Pins the BA-decided diff contract:
 *   - Prior anchor: Call.previousCallId (not MAX(extractedAt))
 *   - `added` = priorCall memories with supersededById=null AND supersedes empty
 *   - `updated` = priorCall memories whose supersedes[] includes a row with
 *     callId = priorPriorCallId (direct compare, no chain walk)
 *   - Empty path on Call 1, no-predecessor, identical memory sets
 */

import { describe, it, expect, vi } from "vitest";
import {
  EMPTY_MEMORY_DELTAS,
  loadMemoryDeltas,
} from "@/lib/prompt/composition/loaders/memoryDeltas";

type MockCall = { id: string; previousCallId: string | null };
type MockMemory = {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  supersededById: string | null;
  supersedes: Array<{ id: string; value: string; callId: string | null }>;
};

function makePrisma(opts: {
  priorCall?: MockCall | null;
  memoryRows?: MockMemory[];
  captureFindFirstArgs?: (args: unknown) => void;
  captureMemoryArgs?: (args: unknown) => void;
}) {
  return {
    call: {
      findFirst: vi.fn(async (args: unknown) => {
        opts.captureFindFirstArgs?.(args);
        return opts.priorCall ?? null;
      }),
    },
    callerMemory: {
      findMany: vi.fn(async (args: unknown) => {
        opts.captureMemoryArgs?.(args);
        return opts.memoryRows ?? [];
      }),
    },
  } as any;
}

describe("loadMemoryDeltas", () => {
  it("returns the empty shape when callerId is missing", async () => {
    const prisma = makePrisma({});
    const result = await loadMemoryDeltas(prisma, { callerId: "" });
    expect(result).toEqual(EMPTY_MEMORY_DELTAS);
    expect(prisma.call.findFirst).not.toHaveBeenCalled();
  });

  it("returns the empty shape when there is no prior call (Call 1)", async () => {
    const prisma = makePrisma({ priorCall: null });
    const result = await loadMemoryDeltas(prisma, { callerId: "caller-1" });
    expect(result).toEqual(EMPTY_MEMORY_DELTAS);
    expect(prisma.callerMemory.findMany).not.toHaveBeenCalled();
  });

  it("returns hasDeltas=false with priorCallId populated when the prior call had no added/updated memories", async () => {
    const priorCall: MockCall = { id: "call-prior", previousCallId: "call-prior-prior" };
    const prisma = makePrisma({ priorCall, memoryRows: [] });
    const result = await loadMemoryDeltas(prisma, { callerId: "caller-1" });
    expect(result.hasDeltas).toBe(false);
    expect(result.priorCallId).toBe("call-prior");
    expect(result.priorPriorCallId).toBe("call-prior-prior");
  });

  it("classifies a brand-new memory (no supersedes) as 'added'", async () => {
    const priorCall: MockCall = { id: "call-prior", previousCallId: "call-prior-prior" };
    const memoryRows: MockMemory[] = [
      {
        id: "mem-1",
        category: "PREFERENCE",
        key: "tutor_style",
        value: "patient",
        confidence: 0.9,
        supersededById: null,
        supersedes: [],
      },
    ];
    const prisma = makePrisma({ priorCall, memoryRows });
    const result = await loadMemoryDeltas(prisma, { callerId: "caller-1" });

    expect(result.hasDeltas).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      id: "mem-1",
      category: "PREFERENCE",
      key: "tutor_style",
      value: "patient",
    });
    expect(result.updated).toHaveLength(0);
  });

  it("classifies a memory that supersedes a priorPriorCallId row as 'updated' with priorValue", async () => {
    const priorCall: MockCall = { id: "call-prior", previousCallId: "call-prior-prior" };
    const memoryRows: MockMemory[] = [
      {
        id: "mem-new",
        category: "FACT",
        key: "location",
        value: "Manchester",
        confidence: 0.85,
        supersededById: null,
        supersedes: [
          { id: "mem-old", value: "London", callId: "call-prior-prior" },
        ],
      },
    ];
    const prisma = makePrisma({ priorCall, memoryRows });
    const result = await loadMemoryDeltas(prisma, { callerId: "caller-1" });

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({
      id: "mem-new",
      value: "Manchester",
      supersededId: "mem-old",
      priorValue: "London",
    });
    expect(result.added).toHaveLength(0);
  });

  it("excludes memories that themselves have been superseded (supersededById != null)", async () => {
    const priorCall: MockCall = { id: "call-prior", previousCallId: "call-prior-prior" };
    const memoryRows: MockMemory[] = [
      {
        id: "mem-replaced",
        category: "FACT",
        key: "job",
        value: "Old",
        confidence: 0.5,
        supersededById: "mem-newer",
        supersedes: [],
      },
    ];
    const prisma = makePrisma({ priorCall, memoryRows });
    const result = await loadMemoryDeltas(prisma, { callerId: "caller-1" });
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.hasDeltas).toBe(false);
  });

  it("uses Call.previousCallId as the prior anchor (not extractedAt-derived)", async () => {
    const priorCall: MockCall = { id: "call-prior", previousCallId: "call-X" };
    const captureMemory = vi.fn();
    const prisma = makePrisma({
      priorCall,
      memoryRows: [],
      captureMemoryArgs: captureMemory,
    });
    await loadMemoryDeltas(prisma, { callerId: "caller-1" });

    const args = captureMemory.mock.calls[0][0] as {
      select: { supersedes: { where: { callId?: string } } };
    };
    // The supersedes-walk where-clause is scoped to priorPriorCallId
    expect(args.select.supersedes.where.callId).toBe("call-X");
  });

  it("handles a prior call with no predecessor (priorPriorCallId null) — no updated classification possible", async () => {
    const priorCall: MockCall = { id: "call-prior", previousCallId: null };
    const memoryRows: MockMemory[] = [
      {
        id: "mem-1",
        category: "FACT",
        key: "name",
        value: "Alex",
        confidence: 0.9,
        supersededById: null,
        supersedes: [],
      },
    ];
    const prisma = makePrisma({ priorCall, memoryRows });
    const result = await loadMemoryDeltas(prisma, { callerId: "caller-1" });

    expect(result.priorPriorCallId).toBeNull();
    expect(result.added).toHaveLength(1);
    expect(result.updated).toHaveLength(0);
  });

  it("excludes currentCallId from the prior-call lookup", async () => {
    const capture = vi.fn();
    const prisma = makePrisma({ priorCall: null, captureFindFirstArgs: capture });
    await loadMemoryDeltas(prisma, {
      callerId: "caller-1",
      currentCallId: "call-current",
    });
    const args = capture.mock.calls[0][0] as { where: { id?: { not: string } } };
    expect(args.where.id).toEqual({ not: "call-current" });
  });
});

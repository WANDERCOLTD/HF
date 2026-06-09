/**
 * #1346 Slice 5 — I-CT1 + I-CT2 invariant unit tests.
 *
 * Locks the query shape + the WARN/ERROR severity model. Live-DB checks
 * happen in `tests/integration/sessions/1346-reconciler.integration.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  session: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("I-CT1 — carry-through eventual consistency", () => {
  it("passes when no orphan Sessions exist", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([]);
    const { checkI_CT1_CarryThrough } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const result = await checkI_CT1_CarryThrough();
    expect(result.id).toBe("I-CT1");
    expect(result.passed).toBe(true);
    expect(result.violatingCount).toBe(0);
    expect(result.severity).toBe("warn"); // WARN initially per #1346 spec
  });

  it("fails when orphan Sessions exist; reports sample ids", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([
      { id: "s-1" }, { id: "s-2" }, { id: "s-3" },
    ]);
    const { checkI_CT1_CarryThrough } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const result = await checkI_CT1_CarryThrough();
    expect(result.passed).toBe(false);
    expect(result.violatingCount).toBe(3);
    expect(result.sampleIds).toEqual(["s-1", "s-2", "s-3"]);
  });

  it("query uses canonical 60s budget", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([]);
    const now = new Date("2026-06-08T12:00:00Z");
    const { checkI_CT1_CarryThrough } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    await checkI_CT1_CarryThrough({ now: () => now });
    type WhereShape = {
      where: {
        producedComposedPromptId: null;
        countsTowardPipelineNumber: boolean;
        endedAt: { lt: Date };
      };
    };
    const where = (mockPrisma.session.findMany.mock.calls[0][0] as WhereShape).where;
    expect(where.producedComposedPromptId).toBeNull();
    expect(where.countsTowardPipelineNumber).toBe(true);
    expect(where.endedAt.lt).toEqual(new Date(now.getTime() - 60_000));
  });
});

describe("I-CT2 — terminal fallback / always-valid usedPromptId", () => {
  it("passes when no recent Sessions have null usedPromptId", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([]);
    const { checkI_CT2_TerminalFallback } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const result = await checkI_CT2_TerminalFallback();
    expect(result.id).toBe("I-CT2");
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("error"); // structural — should never fail
  });

  it("brand-new caller (no prior Session) — null usedPromptId is OK", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([
      { id: "s-fresh", callerId: "c-new", startedAt: new Date() },
    ]);
    // No prior Session found for c-new
    mockPrisma.session.findFirst.mockResolvedValueOnce(null);

    const { checkI_CT2_TerminalFallback } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const result = await checkI_CT2_TerminalFallback();
    expect(result.passed).toBe(true);
    expect(result.violatingCount).toBe(0);
  });

  it("returning caller with prior history but null usedPromptId — VIOLATION", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([
      { id: "s-bad", callerId: "c-existing", startedAt: new Date() },
    ]);
    // Prior Session exists — cascade should have found a usedPromptId
    mockPrisma.session.findFirst.mockResolvedValueOnce({ id: "s-prior" });

    const { checkI_CT2_TerminalFallback } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const result = await checkI_CT2_TerminalFallback();
    expect(result.passed).toBe(false);
    expect(result.violatingCount).toBe(1);
    expect(result.sampleIds).toEqual(["s-bad"]);
  });

  it("mixed batch — only callers with prior history count as violations", async () => {
    mockPrisma.session.findMany.mockResolvedValueOnce([
      { id: "s-fresh", callerId: "c-new", startedAt: new Date("2026-06-08T11:30:00Z") },
      { id: "s-bad", callerId: "c-existing", startedAt: new Date("2026-06-08T11:30:00Z") },
    ]);
    // First findFirst (for c-new) → null; second (for c-existing) → prior found
    mockPrisma.session.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "s-prior" });

    const { checkI_CT2_TerminalFallback } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const result = await checkI_CT2_TerminalFallback();
    expect(result.violatingCount).toBe(1);
    expect(result.sampleIds).toEqual(["s-bad"]);
  });
});

describe("runCarryThroughInvariants — runs both", () => {
  it("returns both I-CT1 and I-CT2 results", async () => {
    mockPrisma.session.findMany.mockResolvedValue([]);
    const { runCarryThroughInvariants } = await import(
      "@/lib/prompt/composition/compose-invariants"
    );
    const results = await runCarryThroughInvariants();
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual(["I-CT1", "I-CT2"]);
  });
});

/**
 * G4 / #1145 — CIO/CTO BEH-* seed: produces 21 rows across 3 playbooks, idempotent.
 *
 * Mocks: Prisma (playbook lookup + parameter FK pre-flight), writeBehaviorTargets.
 * Does NOT hit the DB — verifies the seed logic drives the right calls.
 *
 * 21 rows = 3 playbooks × 7 parameters each (BEH-QUESTION-RATE excluded as
 * non-adjustable per seed comment; 8 params - 1 = 7 per playbook).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock writeBehaviorTargets so we can count calls without hitting Prisma ──

const mockWriteBehaviorTargets = vi.fn();

vi.mock("@/lib/agent-tuner/write-target", () => ({
  writeBehaviorTargets: (...args: unknown[]) => mockWriteBehaviorTargets(...args),
}));

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockPlaybookFindFirst = vi.fn();
const mockParameterFindUnique = vi.fn();

const mockPrisma = {
  playbook: { findFirst: mockPlaybookFindFirst },
  parameter: { findUnique: mockParameterFindUnique },
};

// ── helpers ──────────────────────────────────────────────────────────────────

const VARIANT_NAMES = [
  "The CIO/CTO Standard — Pop Quiz",
  "The CIO/CTO Standard — Revision Aid",
  "The CIO/CTO Standard — Exam Assessment",
];

const ADJUSTABLE_BEH_IDS = [
  "BEH-WARMTH",
  "BEH-FORMALITY",
  "BEH-CHALLENGE-LEVEL",
  "BEH-PROBING-QUESTIONS",
  "BEH-RESPONSE-LEN",
  "BEH-CONVERSATIONAL-TONE",
  "BEH-DIRECTNESS",
  // BEH-QUESTION-RATE is NOT adjustable — excluded by seed
];

/** Simulate a created or updated result from writeBehaviorTargets */
function makeWriteResults(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ok: true,
    action: "created" as const,
    parameterId: ADJUSTABLE_BEH_IDS[i % ADJUSTABLE_BEH_IDS.length],
    value: 0.5,
  }));
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("seed-cio-cto-beh-targets (G4 / #1145)", () => {
  let seedCioCtoBehTargets: typeof import("@/prisma/seed-cio-cto-beh-targets").seedCioCtoBehTargets;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: all 3 playbooks exist
    mockPlaybookFindFirst.mockImplementation(({ where }: { where: { name: string } }) => {
      const idx = VARIANT_NAMES.indexOf(where.name);
      if (idx === -1) return Promise.resolve(null);
      return Promise.resolve({ id: `pb-${idx}`, name: where.name, status: "ACTIVE" });
    });

    // All BEH-* parameters exist
    mockParameterFindUnique.mockResolvedValue({ parameterId: "BEH-WARMTH" });

    // writeBehaviorTargets returns 7 created results per call
    mockWriteBehaviorTargets.mockImplementation((_pbId: string, targets: unknown[]) =>
      Promise.resolve(makeWriteResults(targets.length)),
    );

    const mod = await import("@/prisma/seed-cio-cto-beh-targets");
    seedCioCtoBehTargets = mod.seedCioCtoBehTargets;
  });

  it("calls writeBehaviorTargets once per playbook (3 times total)", async () => {
    await seedCioCtoBehTargets(mockPrisma as never);
    expect(mockWriteBehaviorTargets).toHaveBeenCalledTimes(3);
  });

  it("produces 18 target rows across 3 playbooks (6 per playbook)", async () => {
    // #1949 — BEH-CONVERSATIONAL-TONE folded onto BEH-WARMTH (dedup
    // cluster 1). Pre-#1949: 7 per playbook × 3 = 21. Post: 6 × 3 = 18.
    const result = await seedCioCtoBehTargets(mockPrisma as never);
    expect(result.playbooksProcessed).toBe(3);
    expect(result.targetsWritten).toBe(18);
    expect(result.playbooksSkipped).toBe(0);
  });

  it("passes source: SEED to writeBehaviorTargets", async () => {
    await seedCioCtoBehTargets(mockPrisma as never);
    for (const call of mockWriteBehaviorTargets.mock.calls) {
      expect(call[2]).toMatchObject({ source: "SEED" });
    }
  });

  it("idempotent re-run: noop results do not increment targetsWritten", async () => {
    // Simulate second run: all returns are noop
    mockWriteBehaviorTargets.mockResolvedValue([
      { ok: true, action: "noop", parameterId: "BEH-WARMTH", value: null },
    ]);

    const result = await seedCioCtoBehTargets(mockPrisma as never);
    expect(result.targetsWritten).toBe(0); // noop counts as 0 written
    expect(result.playbooksProcessed).toBe(3); // still processed
  });

  it("skips gracefully when playbooks are not present (fresh DB)", async () => {
    mockPlaybookFindFirst.mockResolvedValue(null);

    const result = await seedCioCtoBehTargets(mockPrisma as never);
    expect(result.playbooksSkipped).toBe(3);
    expect(result.playbooksProcessed).toBe(0);
    expect(result.targetsWritten).toBe(0);
    expect(mockWriteBehaviorTargets).not.toHaveBeenCalled();
  });

  it("throws when a BEH-* Parameter row is missing", async () => {
    mockParameterFindUnique.mockResolvedValue(null); // simulate missing row

    await expect(seedCioCtoBehTargets(mockPrisma as never)).rejects.toThrow(
      /Parameter row.*missing/,
    );
  });
});

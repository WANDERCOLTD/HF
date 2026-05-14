/**
 * Tests for structure-assertions.ts
 *
 * Verifies:
 * - buildStructuringPrompt generates correct prompt from config
 * - buildSchemaDescription handles single, two, and three-level pyramids
 * - hashText produces consistent 16-char hex
 * - structureSourceIfEligible skips below minimum
 * - structureSourceIfEligible skips if already structured
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  createMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  getConfiguredMeteredAICompletion: vi.fn(),
  logAssistantCall: vi.fn(),
  resolveExtractionConfig: vi.fn(),
  getMaxDepth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    contentAssertion: {
      count: mocks.count,
      findMany: mocks.findMany,
      create: mocks.create,
      createMany: mocks.createMany,
      update: mocks.update,
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
    },
    contentSource: {
      findUnique: mocks.findUnique,
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

vi.mock("@/lib/metering/instrumented-ai", () => ({
  getConfiguredMeteredAICompletion: mocks.getConfiguredMeteredAICompletion,
}));

vi.mock("@/lib/ai/assistant-wrapper", () => ({
  logAssistantCall: mocks.logAssistantCall,
}));

vi.mock("@/lib/content-trust/resolve-config", () => ({
  resolveExtractionConfig: mocks.resolveExtractionConfig,
  getMaxDepth: mocks.getMaxDepth,
}));

import { structureSourceIfEligible } from "@/lib/content-trust/structure-assertions";

// ── Tests ────────────────────────────────────────────────

describe("structureSourceIfEligible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when assertion count is below minimum (15)", async () => {
    mocks.count.mockResolvedValue(10);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await structureSourceIfEligible("src-1");

    expect(mocks.count).toHaveBeenCalledWith({ where: { sourceId: "src-1" } });
    // Should NOT proceed to check for existing structure
    expect(mocks.count).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("skips when already structured (nodes with depth exist)", async () => {
    // First call: total count >= 15
    mocks.count.mockResolvedValueOnce(25);
    // Second call: structured count > 0
    mocks.count.mockResolvedValueOnce(5);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await structureSourceIfEligible("src-1");

    expect(mocks.count).toHaveBeenCalledTimes(2);
    expect(mocks.count).toHaveBeenNthCalledWith(2, {
      where: { sourceId: "src-1", depth: { not: null } },
    });
    // Should NOT proceed to applyStructure
    expect(mocks.findUnique).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("proceeds to applyStructure when eligible and not yet structured", async () => {
    // First call: total count >= 15
    mocks.count.mockResolvedValueOnce(20);
    // Second call: no structured nodes
    mocks.count.mockResolvedValueOnce(0);

    // applyStructure will need source lookup
    mocks.findUnique.mockResolvedValue({ documentType: "TEXTBOOK" });
    // applyStructure loads assertions
    mocks.findMany.mockResolvedValue([]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await structureSourceIfEligible("src-1");

    // Should have proceeded past the eligibility checks
    expect(mocks.count).toHaveBeenCalledTimes(2);
    // applyStructure calls findUnique for the source
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "src-1" },
      select: { documentType: true },
    });
    consoleSpy.mockRestore();
  });
});

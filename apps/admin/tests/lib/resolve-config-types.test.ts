/**
 * Tests for document-type-specific config resolution (lib/content-trust/resolve-config.ts)
 *
 * Key behavior:
 *   - resolveExtractionConfig merges system spec -> domain override -> type override
 *   - Type overrides are the LAST merge step
 *   - TEXTBOOK = base config (no override applied)
 *   - CURRICULUM gets LO/AC categories and module->LO->AC->range pyramid
 *   - WORKSHEET caps maxAssertionsPerDocument at 100
 *   - REFERENCE gets 2-level flat structure (topic -> term)
 *   - deepMerge recurses objects but replaces arrays
 *   - getMaxDepth returns highest depth value from pyramid levels
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =====================================================
// MOCK SETUP (vi.hoisted so vi.mock factory can reference it)
// =====================================================

const mocks = vi.hoisted(() => ({
  analysisSpecFindFirst: vi.fn(),
  subjectSourceFindMany: vi.fn(),
  playbookFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    analysisSpec: { findFirst: mocks.analysisSpecFindFirst },
    subjectSource: { findMany: mocks.subjectSourceFindMany },
    playbook: { findFirst: mocks.playbookFindFirst },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

vi.mock("@/lib/config", () => ({
  config: {
    specs: { contentExtract: "CONTENT-EXTRACT-001" },
  },
}));

// =====================================================
// IMPORT AFTER MOCKING
// =====================================================

import {
  resolveExtractionConfig,
  deepMerge,
  getMaxDepth,
  type ExtractionConfig,
} from "@/lib/content-trust/resolve-config";

// =====================================================
// HELPERS
// =====================================================

/** Set all prisma mocks to return "nothing found" (defaults only) */
function useDefaults() {
  mocks.analysisSpecFindFirst.mockResolvedValue(null);
  mocks.subjectSourceFindMany.mockResolvedValue([]);
  mocks.playbookFindFirst.mockResolvedValue(null);
}

// =====================================================
// TESTS
// =====================================================

describe("deepMerge", () => {
  it("merges nested objects", () => {
    const result = deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 99 } } as any);
    expect(result).toEqual({ a: { b: 99, c: 2 } });
  });

  it("replaces arrays (does not concatenate)", () => {
    const result = deepMerge({ a: [1, 2] }, { a: [3] } as any);
    expect(result).toEqual({ a: [3] });
  });
});

describe("resolveExtractionConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDefaults();
  });

  it("returns defaults when no spec found", async () => {
    const cfg = await resolveExtractionConfig();

    // All top-level sections must be present
    expect(cfg).toHaveProperty("extraction");
    expect(cfg).toHaveProperty("structuring");
    expect(cfg).toHaveProperty("rendering");
    expect(cfg).toHaveProperty("classification");
    expect(cfg).toHaveProperty("typeOverrides");

    // Extraction defaults
    expect(cfg.extraction.categories.length).toBeGreaterThan(0);
    expect(cfg.extraction.maxAssertionsPerDocument).toBe(500);

    // Structuring defaults: 4-level pyramid
    expect(cfg.structuring.levels).toHaveLength(4);
    expect(cfg.structuring.levels[0].label).toBe("overview");
  });

  it("TEXTBOOK type does NOT alter config", async () => {
    const withoutType = await resolveExtractionConfig();
    const withTextbook = await resolveExtractionConfig(undefined, "TEXTBOOK");

    expect(withTextbook).toEqual(withoutType);
  });

  it("CURRICULUM type applies extraction overrides", async () => {
    const cfg = await resolveExtractionConfig(undefined, "CURRICULUM");

    const categoryIds = cfg.extraction.categories.map((c) => c.id);
    expect(categoryIds).toContain("learning_outcome");
    expect(categoryIds).toContain("assessment_criterion");
    expect(categoryIds).toContain("range");
  });

  it("CURRICULUM type applies structuring overrides", async () => {
    const cfg = await resolveExtractionConfig(undefined, "CURRICULUM");

    expect(cfg.structuring.levels[0].label).toBe("module");
    expect(cfg.structuring.levels[1].label).toBe("learning_outcome");
    expect(cfg.structuring.levels[2].label).toBe("assessment_criterion");
    expect(cfg.structuring.levels[3].label).toBe("range_detail");
  });

  it("WORKSHEET type applies maxAssertions override", async () => {
    const cfg = await resolveExtractionConfig(undefined, "WORKSHEET");

    expect(cfg.extraction.maxAssertionsPerDocument).toBe(200);
  });

  it("REFERENCE type applies flat 2-level structure", async () => {
    const cfg = await resolveExtractionConfig(undefined, "REFERENCE");

    expect(cfg.structuring.levels).toHaveLength(2);
    expect(cfg.structuring.levels[0].label).toBe("topic");
    expect(cfg.structuring.levels[1].label).toBe("term");
  });
});

describe("getMaxDepth", () => {
  it("returns highest depth from pyramid levels", () => {
    const cfg = {
      structuring: {
        levels: [
          { depth: 0, label: "a", maxChildren: 1, renderAs: "paragraph" as const },
          { depth: 1, label: "b", maxChildren: 3, renderAs: "heading" as const },
          { depth: 2, label: "c", maxChildren: 4, renderAs: "bullet" as const },
        ],
      },
    } as ExtractionConfig;

    expect(getMaxDepth(cfg)).toBe(2);
  });
});

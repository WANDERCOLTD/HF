/**
 * Tests for lib/pipeline/guardrails.ts — Pipeline Guardrails
 *
 * Covers:
 * - No SUPERVISE spec found → DEFAULT_GUARDRAILS returned
 * - Spec found, all parameters present → values merged from spec config
 * - Spec found, partial parameters → defaults fill missing values
 * - System settings contribute to aiSettings.maxRetries and decayHalfLifeDays
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma ──────────────────────────────────────
const mockAnalysisSpecFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    analysisSpec: {
      findFirst: (...args: any[]) => mockAnalysisSpecFindFirst(...args),
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

// ── Mock system-settings ─────────────────────────────
const mockGetPipelineSettings = vi.fn();

vi.mock("@/lib/system-settings", () => ({
  getPipelineSettings: (...args: any[]) => mockGetPipelineSettings(...args),
}));

// ── Import after mocks ───────────────────────────────
import { loadGuardrails, DEFAULT_GUARDRAILS } from "@/lib/pipeline/guardrails";

// ── Fixtures ─────────────────────────────────────────

const DEFAULT_PIPELINE_SETTINGS = {
  maxRetries: 3,
  personalityDecayHalfLifeDays: 45,
};

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeSpec(paramOverrides: Record<string, Record<string, any>> = {}) {
  const paramMap: Record<string, Record<string, any>> = {
    target_clamp: { minValue: 0.1, maxValue: 0.9 },
    confidence_bounds: { minConfidence: 0.25, maxConfidence: 0.98, defaultConfidence: 0.75 },
    mock_behavior: { scoreRangeMin: 0.3, scoreRangeMax: 0.85, nudgeFactor: 0.15 },
    ai_settings: { temperature: 0.5, maxRetries: 4 },
    aggregation: { decayHalfLifeDays: 60, confidenceGrowthBase: 0.6, confidenceGrowthPerCall: 0.12, maxAggregatedConfidence: 0.97 },
    ...paramOverrides,
  };
  return {
    slug: "GUARD-001",
    config: {
      parameters: Object.entries(paramMap).map(([id, cfg]) => ({ id, config: cfg })),
    },
  };
}

// ── Tests ─────────────────────────────────────────────

describe("loadGuardrails", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetPipelineSettings.mockResolvedValue(DEFAULT_PIPELINE_SETTINGS);
    mockAnalysisSpecFindFirst.mockResolvedValue(null);
  });

  it("returns DEFAULT_GUARDRAILS when no SUPERVISE spec exists", async () => {
    mockAnalysisSpecFindFirst.mockResolvedValue(null);
    const log = makeLogger();
    const result = await loadGuardrails(log as any);
    expect(result).toEqual(DEFAULT_GUARDRAILS);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("No SUPERVISE spec found"));
  });

  it("loads all guardrail values from spec config", async () => {
    mockAnalysisSpecFindFirst.mockResolvedValue(makeSpec());
    const log = makeLogger();
    const result = await loadGuardrails(log as any);

    expect(result.targetClamp).toEqual({ minValue: 0.1, maxValue: 0.9 });
    expect(result.confidenceBounds).toEqual({ minConfidence: 0.25, maxConfidence: 0.98, defaultConfidence: 0.75 });
    expect(result.mockBehavior).toEqual({ scoreRangeMin: 0.3, scoreRangeMax: 0.85, nudgeFactor: 0.15 });
    expect(result.aiSettings).toEqual({ temperature: 0.5, maxRetries: 4 });
    expect(result.aggregation).toEqual({
      decayHalfLifeDays: 60,
      confidenceGrowthBase: 0.6,
      confidenceGrowthPerCall: 0.12,
      maxAggregatedConfidence: 0.97,
    });
  });

  it("falls back to defaults for missing param configs", async () => {
    // Spec exists but has no parameters
    mockAnalysisSpecFindFirst.mockResolvedValue({ slug: "GUARD-001", config: { parameters: [] } });
    const log = makeLogger();
    const result = await loadGuardrails(log as any);

    // All values fall back to defaults
    expect(result.targetClamp).toEqual(DEFAULT_GUARDRAILS.targetClamp);
    expect(result.confidenceBounds).toEqual(DEFAULT_GUARDRAILS.confidenceBounds);
    expect(result.mockBehavior).toEqual(DEFAULT_GUARDRAILS.mockBehavior);
  });

  it("uses system settings for maxRetries when not in spec", async () => {
    // ai_settings has no maxRetries
    mockAnalysisSpecFindFirst.mockResolvedValue(makeSpec({ ai_settings: { temperature: 0.4 } }));
    mockGetPipelineSettings.mockResolvedValue({ ...DEFAULT_PIPELINE_SETTINGS, maxRetries: 7 });
    const log = makeLogger();
    const result = await loadGuardrails(log as any);

    expect(result.aiSettings.temperature).toBe(0.4);
    expect(result.aiSettings.maxRetries).toBe(7); // from system settings
  });

  it("uses system settings for decayHalfLifeDays when not in spec", async () => {
    mockAnalysisSpecFindFirst.mockResolvedValue(makeSpec({ aggregation: {} }));
    mockGetPipelineSettings.mockResolvedValue({ ...DEFAULT_PIPELINE_SETTINGS, personalityDecayHalfLifeDays: 90 });
    const log = makeLogger();
    const result = await loadGuardrails(log as any);

    expect(result.aggregation.decayHalfLifeDays).toBe(90); // from system settings
  });

  it("logs the loaded slug and targetClamp on success", async () => {
    mockAnalysisSpecFindFirst.mockResolvedValue(makeSpec());
    const log = makeLogger();
    await loadGuardrails(log as any);

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("GUARD-001"),
      expect.objectContaining({ targetClamp: expect.any(Object) }),
    );
  });

  it("queries for SUPERVISE outputType, active, and not dirty", async () => {
    mockAnalysisSpecFindFirst.mockResolvedValue(null);
    const log = makeLogger();
    await loadGuardrails(log as any);

    expect(mockAnalysisSpecFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outputType: "SUPERVISE",
          isActive: true,
          isDirty: false,
        }),
      }),
    );
  });
});

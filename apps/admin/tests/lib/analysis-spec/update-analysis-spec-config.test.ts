/**
 * Tests for `lib/analysis-spec/update-analysis-spec-config.ts` — #829 Story 5.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  analysisSpec: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  domain: {
    update: vi.fn(),
  },
  systemSetting: {
    upsert: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("updateAnalysisSpecConfig — #829", () => {
  let updateAnalysisSpecConfig: typeof import("@/lib/analysis-spec/update-analysis-spec-config").updateAnalysisSpecConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/lib/analysis-spec/update-analysis-spec-config");
    updateAnalysisSpecConfig = mod.updateAnalysisSpecConfig;
    mockPrisma.analysisSpec.update.mockImplementation(async ({ data, where }) => ({
      id: where.id,
      ...data,
    }));
    mockPrisma.domain.update.mockImplementation(async ({ data, where }) => ({
      id: where.id,
      ...data,
    }));
    mockPrisma.systemSetting.upsert.mockResolvedValue({});
  });

  it("SYSTEM-scope config change → upserts SystemSetting timestamp", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "SYSTEM",
      config: { thresholds: { high: 0.7 } },
      promptTemplate: "old",
      isActive: true,
      specRole: "ORCHESTRATE",
      extendsAgent: null,
      isLocked: false,
      name: "INIT-001",
    });
    const r = await updateAnalysisSpecConfig("init-001", (d) => ({
      ...d,
      config: { thresholds: { high: 0.8 } } as any,
    }));
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(true);
    expect(r.bumpTarget).toBe("system");
    expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: "compose_inputs_updated_at" },
      update: { value: expect.any(String) },
      create: { key: "compose_inputs_updated_at", value: expect.any(String) },
    });
    expect(mockPrisma.domain.update).not.toHaveBeenCalled();
  });

  it("DOMAIN-scope config change with domainId → bumps Domain", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "DOMAIN",
      config: { foo: "a" },
      promptTemplate: "old",
      isActive: true,
      specRole: "IDENTITY",
      extendsAgent: "TUT-001",
      isLocked: false,
      name: "course-identity",
    });
    const r = await updateAnalysisSpecConfig(
      "spec-x",
      (d) => ({ ...d, config: { foo: "b" } as any }),
      { domainId: "dom-1" },
    );
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(true);
    expect(r.bumpTarget).toBe("domain");
    expect(mockPrisma.domain.update).toHaveBeenCalledWith({
      where: { id: "dom-1" },
      data: { composeInputsUpdatedAt: expect.any(Date) },
    });
    expect(mockPrisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("DOMAIN-scope config change WITHOUT domainId → warns, no bump", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "DOMAIN",
      config: { foo: "a" },
      promptTemplate: "old",
      isActive: true,
      specRole: "IDENTITY",
      extendsAgent: null,
      isLocked: false,
      name: "x",
    });
    const r = await updateAnalysisSpecConfig("spec-x", (d) => ({
      ...d,
      config: { foo: "b" } as any,
    }));
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(false);
    expect(r.bumpTarget).toBe("none");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("DOMAIN-scope spec spec-x updated without options.domainId"),
    );
    expect(mockPrisma.domain.update).not.toHaveBeenCalled();
    expect(mockPrisma.systemSetting.upsert).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("CALLER-scope config change → no bump", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "CALLER",
      config: { foo: "a" },
      promptTemplate: "old",
      isActive: true,
      specRole: "MEASURE",
      extendsAgent: null,
      isLocked: false,
      name: "auto-personality",
    });
    const r = await updateAnalysisSpecConfig("spec-c", (d) => ({
      ...d,
      config: { foo: "b" } as any,
    }));
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(false);
    expect(r.bumpTarget).toBe("none");
    expect(mockPrisma.domain.update).not.toHaveBeenCalled();
    expect(mockPrisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("promptTemplate change is compose-affecting", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "SYSTEM",
      config: null,
      promptTemplate: "old prompt",
      isActive: true,
      specRole: "GUARDRAIL",
      extendsAgent: null,
      isLocked: false,
      name: "GUARD-001",
    });
    const r = await updateAnalysisSpecConfig("g-001", (d) => ({
      ...d,
      promptTemplate: "new prompt",
    }));
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(true);
    expect(r.bumpTarget).toBe("system");
  });

  it("isActive flip is compose-affecting", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "DOMAIN",
      config: { x: 1 },
      promptTemplate: null,
      isActive: true,
      specRole: "MEASURE",
      extendsAgent: null,
      isLocked: false,
      name: "x",
    });
    const r = await updateAnalysisSpecConfig(
      "s",
      (d) => ({ ...d, isActive: false }),
      { domainId: "dom-1" },
    );
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(true);
    expect(r.bumpTarget).toBe("domain");
  });

  it("idempotent re-save (no diff) → no bump", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "SYSTEM",
      config: { same: true },
      promptTemplate: "same",
      isActive: true,
      specRole: "ORCHESTRATE",
      extendsAgent: null,
      isLocked: false,
      name: "x",
    });
    const r = await updateAnalysisSpecConfig("x", (d) => d);
    expect(r.composeAffectingChanged).toBe(false);
    expect(r.timestampBumped).toBe(false);
    expect(r.bumpTarget).toBe("none");
    expect(mockPrisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("skipTimestamp suppresses bump even when compose-affecting changed", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "SYSTEM",
      config: { a: 1 },
      promptTemplate: null,
      isActive: true,
      specRole: "ORCHESTRATE",
      extendsAgent: null,
      isLocked: false,
      name: "x",
    });
    const r = await updateAnalysisSpecConfig(
      "x",
      (d) => ({ ...d, config: { a: 2 } as any }),
      { skipTimestamp: true },
    );
    expect(r.composeAffectingChanged).toBe(true);
    expect(r.timestampBumped).toBe(false);
    expect(r.bumpTarget).toBe("none");
  });

  it("locked spec throws", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      scope: "SYSTEM",
      config: null,
      promptTemplate: null,
      isActive: true,
      specRole: "MEASURE",
      extendsAgent: null,
      isLocked: true,
      name: "locked-spec",
    });
    await expect(
      updateAnalysisSpecConfig("x", (d) => ({ ...d, config: { a: 1 } as any })),
    ).rejects.toThrow(/locked/);
  });

  it("missing specId throws", async () => {
    await expect(updateAnalysisSpecConfig("", (d) => d)).rejects.toThrow(
      /specId is required/,
    );
  });

  it("missing spec throws", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(null);
    await expect(
      updateAnalysisSpecConfig("missing", (d) => d),
    ).rejects.toThrow(/spec missing not found/);
  });
});

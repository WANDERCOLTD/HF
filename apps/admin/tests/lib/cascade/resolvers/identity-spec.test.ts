/**
 * Tests for identity-spec resolver.
 * (Epic #1442 Layer 2 / story #1454.)
 *
 * Covers:
 *   - does NOT call transforms/identity.ts::resolveSpecs
 *   - reconstructs LayerHit chain from raw DB rows (PLAYBOOK / DOMAIN / SYSTEM)
 *   - setAt populated from AnalysisSpec.updatedAt when spec resolves
 *   - PLAYBOOK hit has value:null until PlaybookItem walk lands (Sprint 2)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const prismaMock = {
  playbook: { findUnique: vi.fn() },
  domain: { findUnique: vi.fn() },
  analysisSpec: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("identity-spec resolver — does not call resolveSpecs", () => {
  it("does NOT import transforms/identity.ts::resolveSpecs", () => {
    const filePath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "lib",
      "cascade",
      "resolvers",
      "identity-spec.ts",
    );
    const src = readFileSync(filePath, "utf-8");
    // Strip line + block comments so the assertions only see code.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:\/])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bresolveSpecs\b/);
    expect(code).not.toMatch(/transforms\/identity/);
  });
});

describe("resolveIdentitySpec", () => {
  it("returns three LayerHits (PLAYBOOK + DOMAIN + SYSTEM) and picks Domain as winner when Playbook is null", async () => {
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      onboardingIdentitySpecId: "spec-edu-001",
    });
    prismaMock.analysisSpec.findUnique.mockResolvedValueOnce({
      id: "spec-edu-001",
      updatedAt: new Date("2026-05-01T00:00:00Z"),
    });
    prismaMock.analysisSpec.findFirst.mockResolvedValueOnce({
      id: "spec-tut-001",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const { resolveIdentitySpec } = await import(
      "@/lib/cascade/resolvers/identity-spec"
    );
    const r = await resolveIdentitySpec({ playbookId: "pb1" });

    expect(r.layers.map((h) => h.layer)).toEqual([
      "PLAYBOOK",
      "DOMAIN",
      "SYSTEM",
    ]);
    // PLAYBOOK hit value is null until the PlaybookItem walk lands.
    expect(r.layers[0].value).toBeNull();
    // DOMAIN wins because PLAYBOOK is null and DOMAIN has the override.
    expect(r.value).toBe("spec-edu-001");
    expect(r.source).toBe("DOMAIN");
    expect(r.isInherited).toBe(true);
  });

  it("setAt populated from AnalysisSpec.updatedAt for DOMAIN + SYSTEM hits", async () => {
    const domainSpecAt = new Date("2026-04-04T00:00:00Z");
    const sysSpecAt = new Date("2025-12-01T00:00:00Z");
    prismaMock.playbook.findUnique.mockResolvedValueOnce({
      id: "pb1",
      name: "OCEAN",
      domainId: "dom1",
    });
    prismaMock.domain.findUnique.mockResolvedValueOnce({
      id: "dom1",
      name: "Education",
      onboardingIdentitySpecId: "spec-edu-001",
    });
    prismaMock.analysisSpec.findUnique.mockResolvedValueOnce({
      id: "spec-edu-001",
      updatedAt: domainSpecAt,
    });
    prismaMock.analysisSpec.findFirst.mockResolvedValueOnce({
      id: "spec-tut-001",
      updatedAt: sysSpecAt,
    });

    const { resolveIdentitySpec } = await import(
      "@/lib/cascade/resolvers/identity-spec"
    );
    const r = await resolveIdentitySpec({ playbookId: "pb1" });

    const playbookHit = r.layers.find((h) => h.layer === "PLAYBOOK")!;
    const domainHit = r.layers.find((h) => h.layer === "DOMAIN")!;
    const systemHit = r.layers.find((h) => h.layer === "SYSTEM")!;
    expect(playbookHit.setAt).toBeNull();
    expect(domainHit.setAt).toEqual(domainSpecAt);
    expect(systemHit.setAt).toEqual(sysSpecAt);
    expect(playbookHit.setBy).toBeNull();
    expect(domainHit.setBy).toBeNull();
    expect(systemHit.setBy).toBeNull();
  });

  it("throws when playbookId missing", async () => {
    const { resolveIdentitySpec } = await import(
      "@/lib/cascade/resolvers/identity-spec"
    );
    await expect(resolveIdentitySpec({})).rejects.toThrow(/playbookId/);
  });
});

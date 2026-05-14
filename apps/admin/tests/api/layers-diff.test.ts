/**
 * Tests for Layer Diff API routes:
 *   GET /api/layers/diff   — compute base/overlay parameter diff
 *   GET /api/layers/specs  — list overlay specs grouped by base
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// =====================================================
// MOCK SETUP
// =====================================================

const mockPrisma = {
  analysisSpec: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user", email: "test@example.com", role: "ADMIN" } },
  }),
  isAuthError: vi.fn((result: any) => "error" in result),
}));

// =====================================================
// FIXTURES
// =====================================================

const BASE_SPEC = {
  slug: "spec-tut-001",
  name: "Generic Tutor Identity",
  description: "Base tutor archetype",
  config: {
    parameters: [
      { id: "core_identity", name: "Core Identity", section: "identity", config: { roleStatement: "Generic tutor" } },
      { id: "interaction_style", name: "Interaction Style", section: "personality", config: { warmth: "high" } },
    ],
    constraints: [
      { id: "c1", rule: "Never give answers directly" },
    ],
  },
};

const OVERLAY_SPEC = {
  slug: "spec-tut-qm-001",
  name: "Quantum Mechanics Tutor",
  description: "QM domain overlay",
  extendsAgent: "TUT-001",
  config: {
    parameters: [
      { id: "core_identity", name: "QM Core Identity", section: "identity", config: { roleStatement: "QM expert" } },
      { id: "domain_vocab", name: "QM Vocabulary", section: "identity", config: { terms: ["qubit"] } },
    ],
    constraints: [
      { id: "c2", rule: "Verify math expressions" },
    ],
  },
};

// =====================================================
// GET /api/layers/diff
// =====================================================

describe("GET /api/layers/diff", () => {
  let GET: typeof import("@/app/api/layers/diff/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/layers/diff/route");
    GET = mod.GET;
  });

  it("returns 400 when overlayId is missing", async () => {
    const req = new Request("http://localhost:3000/api/layers/diff");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("overlayId");
  });

  it("returns 404 when overlay spec not found", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(null);

    const req = new Request("http://localhost:3000/api/layers/diff?overlayId=missing-id");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("returns 404 when overlay has no extendsAgent", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue({
      slug: "standalone-spec",
      name: "Standalone",
      description: null,
      config: {},
      extendsAgent: null,
    });

    const req = new Request("http://localhost:3000/api/layers/diff?overlayId=some-id");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("not an overlay");
  });

  it("returns 404 when base spec not found", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(OVERLAY_SPEC);
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    const req = new Request("http://localhost:3000/api/layers/diff?overlayId=overlay-id");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("returns 200 with correct diff for valid overlay", async () => {
    mockPrisma.analysisSpec.findUnique.mockResolvedValue(OVERLAY_SPEC);
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(BASE_SPEC);

    const req = new Request("http://localhost:3000/api/layers/diff?overlayId=valid-id");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.diff).toBeDefined();

    const { diff } = body;

    // Base and overlay metadata
    expect(diff.base.slug).toBe("spec-tut-001");
    expect(diff.overlay.slug).toBe("spec-tut-qm-001");
    expect(diff.overlay.extendsAgent).toBe("TUT-001");

    // Parameters
    expect(diff.parameters).toHaveLength(3);
    const coreId = diff.parameters.find((p: any) => p.id === "core_identity");
    const style = diff.parameters.find((p: any) => p.id === "interaction_style");
    const vocab = diff.parameters.find((p: any) => p.id === "domain_vocab");

    expect(coreId.status).toBe("OVERRIDDEN");
    expect(coreId.baseConfig).toEqual({ roleStatement: "Generic tutor" });
    expect(coreId.config).toEqual({ roleStatement: "QM expert" });

    expect(style.status).toBe("INHERITED");
    expect(vocab.status).toBe("NEW");

    // Constraints
    expect(diff.constraints).toHaveLength(2);
    expect(diff.constraints[0].source).toBe("BASE");
    expect(diff.constraints[1].source).toBe("OVERLAY");

    // Stats
    expect(diff.stats.inherited).toBe(1);
    expect(diff.stats.overridden).toBe(1);
    expect(diff.stats.new).toBe(1);
    expect(diff.stats.totalMerged).toBe(3);
  });
});

// =====================================================
// GET /api/layers/specs
// =====================================================

describe("GET /api/layers/specs", () => {
  let GET: typeof import("@/app/api/layers/specs/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/layers/specs/route");
    GET = mod.GET;
  });

  it("returns empty bases when no overlays exist", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.bases).toEqual([]);
  });

  it("groups overlays by extendsAgent", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      { id: "o1", slug: "spec-tut-qm-001", name: "QM Tutor", description: null, extendsAgent: "TUT-001" },
      { id: "o2", slug: "spec-tut-wnf-001", name: "WNF Tutor", description: null, extendsAgent: "TUT-001" },
      { id: "o3", slug: "coach-domain-001", name: "Coach Domain", description: null, extendsAgent: "COACH-001" },
    ]);

    // Mock base spec lookups
    mockPrisma.analysisSpec.findFirst
      .mockResolvedValueOnce({ id: "b1", slug: "spec-tut-001", name: "Generic Tutor" })
      .mockResolvedValueOnce({ id: "b2", slug: "spec-coach-001", name: "Generic Coach" });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.bases).toHaveLength(2);

    const tutBase = body.bases.find((b: any) => b.extendsAgent === "TUT-001");
    expect(tutBase.overlays).toHaveLength(2);
    expect(tutBase.name).toBe("Generic Tutor");

    const coachBase = body.bases.find((b: any) => b.extendsAgent === "COACH-001");
    expect(coachBase.overlays).toHaveLength(1);
    expect(coachBase.name).toBe("Generic Coach");
  });

  it("handles base spec not found gracefully", async () => {
    mockPrisma.analysisSpec.findMany.mockResolvedValue([
      { id: "o1", slug: "orphan-overlay", name: "Orphan", description: null, extendsAgent: "MISSING-001" },
    ]);
    mockPrisma.analysisSpec.findFirst.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.bases).toHaveLength(1);
    expect(body.bases[0].name).toContain("MISSING-001");
    expect(body.bases[0].baseId).toBeNull();
  });
});

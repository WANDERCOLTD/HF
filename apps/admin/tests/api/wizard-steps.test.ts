import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/wizard-steps/route";

const mockPrisma = vi.hoisted(() => ({
  analysisSpec: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  db: (tx?: unknown) => tx ?? mockPrisma,
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "user-1", role: "VIEWER" } },
  }),
  isAuthError: vi.fn((result) => "error" in result),
}));

describe("GET /api/wizard-steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns steps from database when spec exists (slug param)", async () => {
    const mockSteps = [
      { id: "source", label: "Add Source", activeLabel: "Adding Source", order: 1 },
      { id: "extract", label: "Extract", activeLabel: "Extracting Content", order: 2 },
    ];

    mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce({
      slug: "CONTENT-SOURCE-SETUP-001",
      config: {
        parameters: [{ id: "wizard_steps", config: { steps: mockSteps } }],
      },
    });

    const req = new NextRequest("http://localhost/api/wizard-steps?slug=CONTENT-SOURCE-SETUP-001");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.source).toBe("database");
    expect(data.steps).toHaveLength(2);
    expect(data.steps[0].id).toBe("source");
  });

  it("resolves slug from config when wizard param used", async () => {
    const mockSteps = [
      { id: "name", label: "Name", activeLabel: "Naming", order: 1 },
    ];

    mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce({
      slug: "COURSE-SETUP-001",
      config: {
        parameters: [{ id: "wizard_steps", config: { steps: mockSteps } }],
      },
    });

    const req = new NextRequest("http://localhost/api/wizard-steps?wizard=course");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.steps).toHaveLength(1);
    // Verify it resolved through config (findFirst was called with the config slug)
    expect(mockPrisma.analysisSpec.findFirst).toHaveBeenCalled();
  });

  it("returns error for unknown wizard name", async () => {
    const req = new NextRequest("http://localhost/api/wizard-steps?wizard=nonexistent");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("Unknown wizard");
    expect(data.error).toContain("nonexistent");
  });

  it("returns 404 when spec not found", async () => {
    mockPrisma.analysisSpec.findFirst.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost/api/wizard-steps?slug=NONEXISTENT");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("not found");
  });

  it("returns error when neither wizard nor slug provided", async () => {
    const req = new NextRequest("http://localhost/api/wizard-steps");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("wizard");
  });

  it("returns 404 on database failure (loadWizardSteps catches internally and returns null)", async () => {
    mockPrisma.analysisSpec.findFirst.mockRejectedValueOnce(
      new Error("Database error")
    );

    const req = new NextRequest("http://localhost/api/wizard-steps?slug=TEST");
    const res = await GET(req);
    const data = await res.json();

    // loadWizardSteps catches DB errors and returns null → 404
    expect(res.status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("not found");
  });
});

/**
 * Tests for Educator Playbooks API:
 *   GET /api/educator/playbooks?domainId=X — Published playbooks for course picker
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  playbook: { findMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma, db: (tx?: unknown) => tx ?? mockPrisma }));

vi.mock("@/lib/educator-access", () => ({
  requireEducator: vi.fn().mockResolvedValue({
    session: {
      user: { id: "edu-user-1", email: "teacher@test.com", role: "EDUCATOR" },
    },
    callerId: "edu-caller-1",
    institutionId: null,
  }),
  isEducatorAuthError: vi.fn(
    (result: Record<string, unknown>) => "error" in result
  ),
}));

describe("GET /api/educator/playbooks", () => {
  let GET: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/educator/playbooks/route");
    GET = mod.GET;
  });

  it("returns published playbooks for a domain", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([
      { id: "pb-1", name: "English Basics", description: "Foundation course", publishedAt: new Date() },
      { id: "pb-2", name: "Advanced English", description: null, publishedAt: new Date() },
    ]);

    const req = new NextRequest(
      new URL("http://localhost:3000/api/educator/playbooks?domainId=d1")
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.playbooks).toHaveLength(2);
    expect(body.playbooks[0].name).toBe("English Basics");

    expect(mockPrisma.playbook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domainId: "d1", status: "PUBLISHED" },
      })
    );
  });

  it("returns 400 when domainId is missing", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/api/educator/playbooks")
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/domainId/i);
  });

  it("returns empty array when no playbooks exist", async () => {
    mockPrisma.playbook.findMany.mockResolvedValue([]);

    const req = new NextRequest(
      new URL("http://localhost:3000/api/educator/playbooks?domainId=d1")
    );
    const res = await GET(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.playbooks).toHaveLength(0);
  });

  it("returns auth error when requireEducator fails", async () => {
    const { requireEducator } = await import("@/lib/educator-access");
    const { NextResponse } = await import("next/server");
    (requireEducator as any).mockResolvedValueOnce({
      error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    });

    const req = new NextRequest(
      new URL("http://localhost:3000/api/educator/playbooks?domainId=d1")
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

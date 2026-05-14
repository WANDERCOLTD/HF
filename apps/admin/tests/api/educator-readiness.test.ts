/**
 * Tests for Educator Readiness API:
 *   GET /api/educator/readiness — Simplified readiness view for educators
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  cohortGroup: { findMany: vi.fn() },
  domain: { findMany: vi.fn() },
  analysisSpec: { findFirst: vi.fn(), findMany: vi.fn() },
  playbook: { findFirst: vi.fn() },
  subjectSource: { count: vi.fn(), findMany: vi.fn() },
  contentAssertion: { count: vi.fn() },
  caller: { count: vi.fn() },
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

vi.mock("@/lib/domain/readiness", () => ({
  checkDomainReadiness: vi.fn(),
}));

describe("GET /api/educator/readiness", () => {
  let GET: any;
  let mockCheckDomainReadiness: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const readiness = await import("@/lib/domain/readiness");
    mockCheckDomainReadiness = readiness.checkDomainReadiness;

    const mod = await import("@/app/api/educator/readiness/route");
    GET = mod.GET;
  });

  it("returns readiness for educator's domains", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([
      { domainId: "d1" },
      { domainId: "d1" },
      { domainId: "d2" },
    ]);

    mockPrisma.domain.findMany.mockResolvedValue([
      { id: "d1", name: "English" },
      { id: "d2", name: "Maths" },
    ]);

    (mockCheckDomainReadiness as any).mockImplementation((domainId: string) => ({
      domainId,
      domainName: domainId === "d1" ? "English" : "Maths",
      ready: domainId === "d1",
      score: domainId === "d1" ? 100 : 60,
      level: domainId === "d1" ? "ready" : "almost",
      checks: domainId === "d1"
        ? [
            { id: "playbook_published", name: "Published Playbook", passed: true, severity: "critical", detail: "OK" },
          ]
        : [
            { id: "playbook_published", name: "Published Playbook", passed: true, severity: "critical", detail: "OK" },
            { id: "ai_keys", name: "AI Keys", passed: false, severity: "critical", detail: "No keys", fixAction: { label: "Fix", href: "/x/settings" } },
          ],
    }));

    const req = new NextRequest(new URL("http://localhost:3000/api/educator/readiness"));
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.domains).toHaveLength(2);
    expect(body.overallReady).toBe(false);
    expect(body.overallLevel).toBe("almost");

    // ai_keys should be an admin action (not educator fixable)
    const mathsDomain = body.domains.find((d: any) => d.domainName === "Maths");
    expect(mathsDomain.adminActions).toHaveLength(1);
    expect(mathsDomain.adminActions[0].id).toBe("ai_keys");
  });

  it("returns empty when educator has no classrooms", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([]);
    mockPrisma.domain.findMany.mockResolvedValue([]);

    const req = new NextRequest(new URL("http://localhost:3000/api/educator/readiness"));
    const res = await GET(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.domains).toHaveLength(0);
    expect(body.overallReady).toBe(false);
  });

  it("classifies educator-fixable checks correctly", async () => {
    mockPrisma.cohortGroup.findMany.mockResolvedValue([{ domainId: "d1" }]);
    mockPrisma.domain.findMany.mockResolvedValue([{ id: "d1", name: "English" }]);

    (mockCheckDomainReadiness as any).mockResolvedValue({
      domainId: "d1",
      domainName: "English",
      ready: false,
      score: 40,
      level: "incomplete",
      checks: [
        { id: "playbook_published", name: "Playbook", passed: false, severity: "critical", detail: "None" },
        { id: "content_sources", name: "Content", passed: false, severity: "recommended", detail: "None" },
        { id: "ai_keys", name: "AI Keys", passed: false, severity: "critical", detail: "None" },
        { id: "identity_spec", name: "Identity", passed: false, severity: "critical", detail: "None" },
      ],
    });

    const req = new NextRequest(new URL("http://localhost:3000/api/educator/readiness"));
    const res = await GET(req);
    const body = await res.json();

    const domain = body.domains[0];
    // playbook_published and content_sources are educator-fixable
    expect(domain.educatorActions).toHaveLength(2);
    // ai_keys and identity_spec are admin-fixable
    expect(domain.adminActions).toHaveLength(2);
  });

  it("returns auth error when requireEducator fails", async () => {
    const { requireEducator } = await import("@/lib/educator-access");
    const { NextResponse } = await import("next/server");
    (requireEducator as any).mockResolvedValueOnce({
      error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    });

    const req = new NextRequest(new URL("http://localhost:3000/api/educator/readiness"));
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

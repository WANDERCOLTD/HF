/**
 * Tests for GET /api/subjects and POST /api/subjects
 *
 * Verifies:
 * - Auth enforcement (VIEWER for GET, ADMIN for POST)
 * - GET returns subjects with lessonPlanSessions count
 * - GET respects activeOnly and domainId filters
 * - POST creates subject with required fields
 * - POST rejects missing slug/name
 * - POST returns 409 on duplicate slug
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  subjectFindMany: vi.fn(),
  subjectCreate: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: any[]) => mocks.requireAuth(...args),
  isAuthError: (result: any) => "error" in result,
}));

vi.mock("@/lib/prisma", () => {
  const _p = {
  prisma: {
    subject: {
      findMany: mocks.subjectFindMany,
      create: mocks.subjectCreate,
    },
  },
};
  return { ..._p, db: (tx?: unknown) => tx ?? _p.prisma };
});

import { GET, POST } from "@/app/api/subjects/route";
import { NextRequest } from "next/server";

function makeGetRequest(query = "") {
  return new NextRequest(`http://localhost/api/subjects${query ? `?${query}` : ""}`);
}

function makePostRequest(body: any) {
  return new NextRequest("http://localhost/api/subjects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const MOCK_SUBJECTS = [
  {
    id: "sub-1",
    slug: "food-safety",
    name: "Food Safety",
    description: "Level 2 food safety",
    defaultTrustLevel: "UNVERIFIED",
    isActive: true,
    _count: { sources: 3, domains: 1, curricula: 1 },
    domains: [{ domain: { id: "d1", name: "Test Domain", slug: "test" } }],
    curricula: [
      {
        id: "cur-1",
        deliveryConfig: {
          lessonPlan: {
            entries: [
              { session: 1, type: "onboarding", label: "Welcome" },
              { session: 2, type: "introduce", label: "Module 1" },
              { session: 3, type: "assess", label: "Assessment" },
            ],
          },
        },
      },
    ],
  },
  {
    id: "sub-2",
    slug: "first-aid",
    name: "First Aid",
    description: null,
    defaultTrustLevel: "EXPERT_CURATED",
    isActive: true,
    _count: { sources: 0, domains: 0, curricula: 0 },
    domains: [],
    curricula: [],
  },
];

describe("GET /api/subjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "VIEWER" } },
    });
    mocks.subjectFindMany.mockResolvedValue(MOCK_SUBJECTS);
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns subjects with lessonPlanSessions count", async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.subjects).toHaveLength(2);

    // First subject: 3 lesson plan entries
    expect(data.subjects[0].name).toBe("Food Safety");
    expect(data.subjects[0].lessonPlanSessions).toBe(3);
    expect(data.subjects[0]._count.curricula).toBe(1);

    // Second subject: no curricula, 0 sessions
    expect(data.subjects[1].name).toBe("First Aid");
    expect(data.subjects[1].lessonPlanSessions).toBe(0);

    // Raw curricula array should be stripped
    expect(data.subjects[0].curricula).toBeUndefined();
    expect(data.subjects[1].curricula).toBeUndefined();
  });

  it("handles curricula with no deliveryConfig", async () => {
    mocks.subjectFindMany.mockResolvedValue([
      {
        ...MOCK_SUBJECTS[0],
        curricula: [{ id: "cur-1", deliveryConfig: null }],
      },
    ]);

    const res = await GET(makeGetRequest());
    const data = await res.json();
    expect(data.subjects[0].lessonPlanSessions).toBe(0);
  });

  it("passes activeOnly=true by default", async () => {
    await GET(makeGetRequest());
    expect(mocks.subjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
      })
    );
  });

  it("passes activeOnly=false when specified", async () => {
    await GET(makeGetRequest("activeOnly=false"));
    expect(mocks.subjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      })
    );
  });

  it("filters by domainId when specified", async () => {
    await GET(makeGetRequest("domainId=d1"));
    expect(mocks.subjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, domains: { some: { domainId: "d1" } } },
      })
    );
  });
});

describe("POST /api/subjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      session: { user: { id: "u1", role: "ADMIN" } },
    });
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mocks.requireAuth.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await POST(makePostRequest({ slug: "test", name: "Test" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when slug or name missing", async () => {
    const res = await POST(makePostRequest({ slug: "", name: "" }));
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("slug and name are required");
  });

  it("creates subject and returns 201", async () => {
    const created = {
      id: "sub-new",
      slug: "new-subject",
      name: "New Subject",
      description: "A new subject",
      defaultTrustLevel: "UNVERIFIED",
    };
    mocks.subjectCreate.mockResolvedValue(created);

    const res = await POST(makePostRequest({
      slug: "new-subject",
      name: "New Subject",
      description: "A new subject",
    }));
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.subject.id).toBe("sub-new");
    expect(data.subject.name).toBe("New Subject");
  });

  it("returns 409 on duplicate slug", async () => {
    mocks.subjectCreate.mockRejectedValue({ code: "P2002" });

    const res = await POST(makePostRequest({ slug: "existing", name: "Existing" }));
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error).toContain("already exists");
  });
});

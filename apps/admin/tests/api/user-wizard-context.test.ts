/**
 * Tests for GET /api/user/wizard-context (#929 Slice A)
 *
 * Returns the logged-in user's home institution + domain so the wizard can
 * re-anchor after Start Over. Mirrors `app/x/get-started-v5/page.tsx`
 * resolution.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockPrisma, mockRequireAuth } = vi.hoisted(() => ({
  mockPrisma: {
    institution: { findUnique: vi.fn() },
  },
  mockRequireAuth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => !!(r && typeof r === "object" && "error" in (r as object)),
}));

import { GET } from "@/app/api/user/wizard-context/route";

const baseSession = {
  user: {
    id: "user-1",
    role: "EDUCATOR",
    institutionId: "inst-1",
    assignedDomainId: null as string | null,
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
};

describe("/api/user/wizard-context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ session: baseSession });
  });

  it("returns the institution's primary domain when assignedDomainId is null", async () => {
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: "inst-1",
      name: "Acme U",
      type: { slug: "university" },
      domains: [
        { id: "dom-a", kind: "INSTITUTION" },
        { id: "dom-b", kind: "INSTITUTION" },
      ],
    });

    const res = await GET();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.context).toEqual({
      institutionId: "inst-1",
      institutionName: "Acme U",
      domainId: "dom-a",
      domainKind: "INSTITUTION",
      typeSlug: "university",
    });
  });

  it("prefers assignedDomainId when it matches one of the institution's domains", async () => {
    mockRequireAuth.mockResolvedValue({
      session: {
        ...baseSession,
        user: { ...baseSession.user, assignedDomainId: "dom-b" },
      },
    });
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: "inst-1",
      name: "Acme U",
      type: { slug: "university" },
      domains: [
        { id: "dom-a", kind: "INSTITUTION" },
        { id: "dom-b", kind: "COMMUNITY" },
      ],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.context.domainId).toBe("dom-b");
    expect(body.context.domainKind).toBe("COMMUNITY");
  });

  it("returns null context when user has no institutionId (SUPERADMIN-like)", async () => {
    mockRequireAuth.mockResolvedValue({
      session: { ...baseSession, user: { ...baseSession.user, institutionId: null } },
    });

    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.context).toBeNull();
    expect(mockPrisma.institution.findUnique).not.toHaveBeenCalled();
  });

  it("returns null context when institution has no active domains", async () => {
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: "inst-1",
      name: "Acme U",
      type: { slug: "university" },
      domains: [],
    });

    const res = await GET();
    const body = await res.json();
    expect(body.context).toBeNull();
  });

  it("returns null context when institution is missing / inactive", async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();
    expect(body.context).toBeNull();
  });
});

/**
 * Tests for POST /api/wizard/discard-draft (#929 Slice B2)
 *
 * Marks a partially-built wizard attempt as abandoned so the next attempt
 * cannot resume it. Soft only: Institution/Domain rows are preserved.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockPrisma, mockRequireAuth, mockUpdatePlaybookConfig } = vi.hoisted(() => ({
  mockPrisma: {
    playbook: { findUnique: vi.fn(), update: vi.fn() },
    caller: { findUnique: vi.fn(), update: vi.fn() },
    domain: { findUnique: vi.fn() },
  },
  mockRequireAuth: vi.fn(),
  mockUpdatePlaybookConfig: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/permissions", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => !!(r && typeof r === "object" && "error" in (r as object)),
}));
vi.mock("@/lib/playbook/update-playbook-config", () => ({
  updatePlaybookConfig: (...args: unknown[]) => mockUpdatePlaybookConfig(...args),
}));

import { POST } from "@/app/api/wizard/discard-draft/route";

const eduSession = {
  user: { id: "u-1", role: "EDUCATOR", institutionId: "inst-1", assignedDomainId: null },
  expires: new Date(Date.now() + 86400000).toISOString(),
};

const superSession = {
  user: { id: "u-super", role: "SUPERADMIN", institutionId: null, assignedDomainId: null },
  expires: new Date(Date.now() + 86400000).toISOString(),
};

// Valid v4-style UUIDs (variant byte starts with 8/9/a/b — zod .uuid() enforces this)
const PLAYBOOK_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const DEMO_CALLER_ID = "33333333-3333-4333-8333-333333333333";

function req(body: unknown): Request {
  return new Request("http://localhost/api/wizard/discard-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/wizard/discard-draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ session: eduSession });
    mockUpdatePlaybookConfig.mockResolvedValue({
      playbook: { id: PLAYBOOK_ID } as unknown,
      composeAffectingChanged: false,
      timestampBumped: false,
      fanoutScope: "none",
    });
  });

  it("marks a DRAFT playbook abandoned with config flag + name suffix", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: PLAYBOOK_ID,
      name: "Physics 101",
      status: "DRAFT",
      config: { interactionPattern: "tutoring" },
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValue({ institutionId: "inst-1" });
    mockPrisma.playbook.update.mockResolvedValue({ id: PLAYBOOK_ID });

    const res = await POST(req({ draftPlaybookId: PLAYBOOK_ID }) as never);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.discarded.playbookId).toBe(PLAYBOOK_ID);

    // Config write goes via the helper (the lint rule blocks direct config writes).
    expect(mockUpdatePlaybookConfig).toHaveBeenCalledTimes(1);
    const [pbId, transformer] = mockUpdatePlaybookConfig.mock.calls[0];
    expect(pbId).toBe(PLAYBOOK_ID);
    const nextCfg = transformer({ interactionPattern: "tutoring" });
    expect(nextCfg.interactionPattern).toBe("tutoring"); // preserved
    expect(typeof nextCfg.wizardAbandonedAt).toBe("string");

    // Name update goes through prisma.playbook.update directly (allowed —
    // the lint rule only blocks writes that include `config`).
    expect(mockPrisma.playbook.update).toHaveBeenCalledTimes(1);
    const nameCall = mockPrisma.playbook.update.mock.calls[0][0];
    expect(nameCall.where).toEqual({ id: PLAYBOOK_ID });
    expect(nameCall.data.name).toMatch(/^Physics 101 \[abandoned /);
  });

  it("skips a PUBLISHED playbook", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: PLAYBOOK_ID,
      name: "Live Course",
      status: "PUBLISHED",
      config: {},
      domainId: "dom-1",
    });

    const res = await POST(req({ draftPlaybookId: PLAYBOOK_ID }) as never);
    const body = await res.json();
    expect(body.discarded).toBeNull();
    expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
  });

  it("blocks non-SUPERADMIN from discarding a draft outside their institution", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: PLAYBOOK_ID,
      name: "Foreign Course",
      status: "DRAFT",
      config: {},
      domainId: "dom-other",
    });
    mockPrisma.domain.findUnique.mockResolvedValue({ institutionId: "inst-other" });

    const res = await POST(req({ draftPlaybookId: PLAYBOOK_ID }) as never);
    const body = await res.json();

    expect(body.discarded).toBeNull();
    expect(mockUpdatePlaybookConfig).not.toHaveBeenCalled();
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
  });

  it("allows SUPERADMIN to discard a draft in any domain", async () => {
    mockRequireAuth.mockResolvedValue({ session: superSession });
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: PLAYBOOK_ID,
      name: "Cross-tenant Draft",
      status: "DRAFT",
      config: null,
      domainId: "dom-other",
    });
    mockPrisma.playbook.update.mockResolvedValue({ id: PLAYBOOK_ID });

    const res = await POST(req({ draftPlaybookId: PLAYBOOK_ID }) as never);
    const body = await res.json();

    expect(body.discarded.playbookId).toBe(PLAYBOOK_ID);
    expect(mockPrisma.domain.findUnique).not.toHaveBeenCalled(); // skipped for SUPERADMIN
    expect(mockUpdatePlaybookConfig).toHaveBeenCalledTimes(1);
  });

  it("soft-deletes draftCallerId and draftDemoCallerId", async () => {
    mockPrisma.caller.findUnique
      .mockResolvedValueOnce({ id: CALLER_ID, archivedAt: null, domainId: "dom-1" })
      .mockResolvedValueOnce({ id: DEMO_CALLER_ID, archivedAt: null, domainId: "dom-1" });
    mockPrisma.domain.findUnique.mockResolvedValue({ institutionId: "inst-1" });
    mockPrisma.caller.update.mockResolvedValue({});

    const res = await POST(
      req({ draftCallerId: CALLER_ID, draftDemoCallerId: DEMO_CALLER_ID }) as never,
    );
    const body = await res.json();

    expect(body.discarded.callerIds).toEqual([CALLER_ID, DEMO_CALLER_ID]);
    expect(mockPrisma.caller.update).toHaveBeenCalledTimes(2);
    const firstUpdate = mockPrisma.caller.update.mock.calls[0][0];
    expect(firstUpdate.data.archivedAt).toBeInstanceOf(Date);
  });

  it("skips already-archived callers", async () => {
    mockPrisma.caller.findUnique.mockResolvedValue({
      id: CALLER_ID,
      archivedAt: new Date("2020-01-01"),
      domainId: "dom-1",
    });

    const res = await POST(req({ draftCallerId: CALLER_ID }) as never);
    const body = await res.json();

    expect(body.discarded).toBeNull();
    expect(mockPrisma.caller.update).not.toHaveBeenCalled();
  });

  it("returns 200 with discarded:null when no IDs are provided", async () => {
    const res = await POST(req({}) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.discarded).toBeNull();
    expect(mockPrisma.playbook.update).not.toHaveBeenCalled();
    expect(mockPrisma.caller.update).not.toHaveBeenCalled();
  });

  it("rejects unknown fields with 400", async () => {
    const res = await POST(req({ draftPlaybookId: PLAYBOOK_ID, unexpectedKey: "boom" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects non-UUID IDs with 400", async () => {
    const res = await POST(req({ draftPlaybookId: "not-a-uuid" }) as never);
    expect(res.status).toBe(400);
  });

  it("does NOT touch institution or domain rows", async () => {
    mockPrisma.playbook.findUnique.mockResolvedValue({
      id: PLAYBOOK_ID,
      name: "X",
      status: "DRAFT",
      config: {},
      domainId: "dom-1",
    });
    mockPrisma.domain.findUnique.mockResolvedValue({ institutionId: "inst-1" });
    mockPrisma.playbook.update.mockResolvedValue({ id: PLAYBOOK_ID });

    await POST(
      req({
        draftPlaybookId: PLAYBOOK_ID,
        draftInstitutionId: "44444444-4444-4444-8444-444444444444",
        draftDomainId: "55555555-5555-4555-8555-555555555555",
      }) as never,
    );

    // No deletes/updates on institution/domain anywhere in the mock surface.
    // (mockPrisma omits .institution + .domain.update on purpose.)
    expect(mockUpdatePlaybookConfig).toHaveBeenCalledTimes(1);
    expect(mockPrisma.playbook.update).toHaveBeenCalledTimes(1); // name suffix only
  });
});

/**
 * #727 v1 — loadTicketContext()
 *
 * Validates:
 *   - Institution-scope guard refuses cross-institution requests for non-SUPERADMIN
 *   - SUPERADMIN bypasses the guard
 *   - Internal comments filtered out for non-OPERATOR roles
 *   - Field truncation (description, pageContext) caps at 500 chars
 *   - Comment thread caps at 15 (newest kept)
 *   - Missing ticket returns ok=false / reason=not_found
 *   - Ticket whose creator has no institutionId returns reason=no_creator_institution for non-SUPERADMIN
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadTicketContext, loadRecentTicketsDigest } from "@/lib/chat/ticket-context";

vi.mock("@/lib/prisma", () => {
  const mock = {
    ticket: { findUnique: vi.fn(), findMany: vi.fn() },
  };
  return { prisma: mock };
});

import { prisma } from "@/lib/prisma";

const SESSION_INSTITUTION = "inst-self";

function buildTicket(overrides: Partial<{
  description: string;
  pageContext: string | null;
  creatorInstitutionId: string | null;
  comments: Array<{ isInternal: boolean; content: string; createdAt: Date; author: { name: string; email: string; role: string } }>;
}> = {}) {
  return {
    ticketNumber: 7,
    title: "Test ticket",
    description: overrides.description ?? "A description",
    status: "OPEN",
    priority: "MEDIUM",
    category: "BUG",
    tags: [] as string[],
    pageContext: overrides.pageContext ?? "/x/feedback",
    screenshotUrl: null,
    githubIssueUrl: null,
    githubIssueNumber: null,
    createdAt: new Date("2026-05-23T20:14:33.456Z"),
    resolvedAt: null,
    closedAt: null,
    creator: {
      id: "creator-1",
      name: "Reporter",
      email: "r@test.com",
      role: "TESTER",
      institutionId: overrides.creatorInstitutionId === undefined ? SESSION_INSTITUTION : overrides.creatorInstitutionId,
    },
    assignee: null,
    comments: overrides.comments ?? [],
  };
}

describe("loadTicketContext — institution scope guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses cross-institution access for non-SUPERADMIN", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(buildTicket({ creatorInstitutionId: "inst-other" }) as never);
    const result = await loadTicketContext({
      ticketId: "t1",
      sessionUserId: "u1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: false,
      canSeeInternalComments: false,
    });
    expect(result).toEqual({ ok: false, reason: "cross_institution" });
  });

  it("allows same-institution access for non-SUPERADMIN", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(buildTicket() as never);
    const result = await loadTicketContext({
      ticketId: "t1",
      sessionUserId: "u1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: false,
      canSeeInternalComments: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.block).toContain("#7");
  });

  it("SUPERADMIN bypasses the scope guard", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(buildTicket({ creatorInstitutionId: "inst-other" }) as never);
    const result = await loadTicketContext({
      ticketId: "t1",
      sessionUserId: "super-1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: true,
      canSeeInternalComments: true,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses when creator has no institutionId for non-SUPERADMIN", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(buildTicket({ creatorInstitutionId: null }) as never);
    const result = await loadTicketContext({
      ticketId: "t1",
      sessionUserId: "u1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: false,
      canSeeInternalComments: false,
    });
    expect(result).toEqual({ ok: false, reason: "no_creator_institution" });
  });

  it("returns not_found when ticket is missing", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(null);
    const result = await loadTicketContext({
      ticketId: "missing",
      sessionUserId: "u1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: false,
      canSeeInternalComments: false,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("loadTicketContext — comment filter + truncation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides internal comments when canSeeInternalComments=false", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(buildTicket({
      comments: [
        { isInternal: false, content: "public note", createdAt: new Date(), author: { name: "Op", email: "o@x", role: "OPERATOR" } },
        { isInternal: true, content: "INTERNAL secret", createdAt: new Date(), author: { name: "Op", email: "o@x", role: "OPERATOR" } },
      ],
    }) as never);
    const result = await loadTicketContext({
      ticketId: "t1",
      sessionUserId: "u1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: false,
      canSeeInternalComments: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block).toContain("public note");
      expect(result.block).not.toContain("INTERNAL secret");
    }
  });

  it("shows internal comments when canSeeInternalComments=true", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(buildTicket({
      comments: [
        { isInternal: true, content: "INTERNAL diagnosis", createdAt: new Date(), author: { name: "Op", email: "o@x", role: "OPERATOR" } },
      ],
    }) as never);
    const result = await loadTicketContext({
      ticketId: "t1",
      sessionUserId: "u1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: false,
      canSeeInternalComments: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block).toContain("INTERNAL diagnosis");
      expect(result.block).toContain("[internal]");
    }
  });

  it("caps comments to last 15 (newest kept, older trimmed)", async () => {
    const comments = Array.from({ length: 20 }, (_, i) => ({
      isInternal: false,
      content: `comment-${i}`,
      createdAt: new Date(`2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      author: { name: "Tester", email: "t@x", role: "TESTER" },
    }));
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(buildTicket({ comments }) as never);
    const result = await loadTicketContext({
      ticketId: "t1",
      sessionUserId: "u1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: false,
      canSeeInternalComments: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // First five (comment-0..4) should be trimmed; last 15 (comment-5..19) kept
      expect(result.block).not.toContain("comment-0");
      expect(result.block).not.toContain("comment-4");
      expect(result.block).toContain("comment-5");
      expect(result.block).toContain("comment-19");
      expect(result.block).toContain("older trimmed");
    }
  });

  it("truncates long description and pageContext to 500 chars + ellipsis", async () => {
    const long = "x".repeat(700);
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(buildTicket({
      description: long,
      pageContext: long,
    }) as never);
    const result = await loadTicketContext({
      ticketId: "t1",
      sessionUserId: "u1",
      sessionInstitutionId: SESSION_INSTITUTION,
      isSuperadmin: false,
      canSeeInternalComments: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The block should not contain a 700-x run
      expect(result.block).not.toContain("x".repeat(700));
      // It should contain the truncation marker
      expect(result.block).toContain("…");
    }
  });
});

describe("loadRecentTicketsDigest — #733 list-mode hint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a digest with the 5 most-recent OPEN/IN_PROGRESS tickets", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([
      { ticketNumber: 12, title: "Login broken", status: "OPEN", category: "BUG", updatedAt: new Date("2026-05-24T08:00:00Z"), creator: { name: "Pat", email: "p@x" } },
      { ticketNumber: 11, title: "Suggestion: dark mode", status: "IN_PROGRESS", category: "FEATURE", updatedAt: new Date("2026-05-23T20:00:00Z"), creator: { name: "Sam", email: "s@x" } },
    ] as never);
    const block = await loadRecentTicketsDigest("inst-A", false, 5);
    expect(block).toContain("Feedback list mode");
    expect(block).toContain("#12");
    expect(block).toContain("Login broken");
    expect(block).toContain("#11");
    expect(block).toContain("ask which one");
  });

  it("returns an explicit 'no tickets' block when none match", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as never);
    const block = await loadRecentTicketsDigest("inst-A", false, 5);
    expect(block).toContain("NO open or in-progress tickets");
  });

  it("scopes by creator.institutionId for non-SUPERADMIN", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as never);
    await loadRecentTicketsDigest("inst-A", false, 5);
    const callArgs = vi.mocked(prisma.ticket.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).toMatchObject({ creator: { institutionId: "inst-A" } });
  });

  it("SUPERADMIN sees all institutions (no creator scope)", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as never);
    await loadRecentTicketsDigest("inst-A", true, 5);
    const callArgs = vi.mocked(prisma.ticket.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).not.toHaveProperty("creator");
  });

  it("returns the 'no creator institution' fallback (id=__never__) when session has no institution", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as never);
    await loadRecentTicketsDigest(null, false, 5);
    const callArgs = vi.mocked(prisma.ticket.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).toMatchObject({ id: "__never__" });
  });
});

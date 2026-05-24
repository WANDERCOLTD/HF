/**
 * #733 — when the user opens the chat on `/x/feedback` without a specific
 * ticket selected (list view), inject a small digest of recent OPEN /
 * IN_PROGRESS tickets so the assistant can ask "which one?" instead of
 * pretending to know. Scope-guarded: non-SUPERADMIN sees only tickets from
 * users in their own institution.
 */
export async function loadRecentTicketsDigest(
  sessionInstitutionId: string | null,
  isSuperadmin: boolean,
  limit: number = 5,
): Promise<string> {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS"] },
      ...(isSuperadmin ? {} : sessionInstitutionId
        ? { creator: { institutionId: sessionInstitutionId } }
        : { id: "__never__" }), // No institution → see nothing
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      ticketNumber: true,
      title: true,
      status: true,
      category: true,
      updatedAt: true,
      creator: { select: { name: true, email: true } },
    },
  });

  if (tickets.length === 0) {
    return [
      "## Feedback list mode",
      "",
      "The user is on the Feedback list page. There are NO open or in-progress tickets visible to them.",
      "If they ask about tickets, say so politely.",
    ].join("\n");
  }

  const lines: string[] = [
    "## Feedback list mode",
    "",
    "The user is on the Feedback list page and has NOT selected a specific ticket.",
    `Here are the ${tickets.length} most recently updated OPEN / IN_PROGRESS tickets:`,
    "",
  ];
  for (const t of tickets) {
    const who = t.creator.name ?? t.creator.email;
    lines.push(`- **#${t.ticketNumber}** [${t.status}] ${t.category} — "${t.title.slice(0, 80)}" (by ${who}, updated ${t.updatedAt.toISOString()})`);
  }
  lines.push("");
  lines.push("**When the user asks about a ticket**: ask which one (by number), or list these for them to pick. Do not invent a ticket they didn't reference. Once they pick one, suggest they expand it on the page so the assistant gets full context (description + comments + screenshot).");
  return lines.join("\n");
}

/**
 * Loads a Ticket + comment thread for injection into the Assistant's system
 * prompt when the user clicks "Discuss with AI" on a feedback ticket.
 *
 * Institution-scope guard: the Ticket model has no `institutionId` field; the
 * scope is enforced indirectly via the creator. Non-SUPERADMIN callers can
 * only see tickets created by a user in their own institution. Without this,
 * an ADMIN/OPERATOR could request a `discussionTicketId` from another tenant
 * and have its description / comments / screenshot URL leaked into their
 * assistant's system prompt.
 *
 * Read-only — v1 of #727. Write paths (save AI diagnosis as comment) live in
 * #729 and go through the AI-to-DB guard pattern.
 */

import { prisma } from "@/lib/prisma";

/** Max comments rendered into the prompt — older comments are dropped. */
const MAX_COMMENTS = 15;
/** Per-field truncation (matches defensive slicing in getCallerContext). */
const FIELD_MAX = 500;

export interface TicketContextOptions {
  ticketId: string;
  sessionUserId: string;
  sessionInstitutionId: string | null;
  /** SUPERADMIN bypasses the institution-scope guard (platform-wide visibility). */
  isSuperadmin: boolean;
  /**
   * Operators see internal comments; everyone else does not. Mirrors the
   * filter applied in GET /api/tickets/[ticketId].
   */
  canSeeInternalComments: boolean;
}

export interface TicketContextResult {
  ok: true;
  block: string;
}

export interface TicketContextSkip {
  ok: false;
  reason: "not_found" | "cross_institution" | "no_creator_institution";
}

function truncate(value: string | null | undefined, max = FIELD_MAX): string {
  if (!value) return "—";
  const s = value.trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

export async function loadTicketContext(
  opts: TicketContextOptions,
): Promise<TicketContextResult | TicketContextSkip> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    select: {
      ticketNumber: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      category: true,
      tags: true,
      pageContext: true,
      screenshotUrl: true,
      githubIssueUrl: true,
      githubIssueNumber: true,
      createdAt: true,
      resolvedAt: true,
      closedAt: true,
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          institutionId: true,
        },
      },
      assignee: {
        select: { name: true, email: true },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          isInternal: true,
          content: true,
          createdAt: true,
          author: { select: { name: true, email: true, role: true } },
        },
      },
    },
  });

  if (!ticket) {
    return { ok: false, reason: "not_found" };
  }

  // Scope guard — non-SUPERADMIN can only discuss tickets created by users
  // in their own institution. If the creator has no institutionId at all
  // (rare — only seeded admin / legacy rows), refuse rather than leak.
  if (!opts.isSuperadmin) {
    if (!ticket.creator.institutionId) {
      return { ok: false, reason: "no_creator_institution" };
    }
    if (ticket.creator.institutionId !== opts.sessionInstitutionId) {
      return { ok: false, reason: "cross_institution" };
    }
  }

  const visibleComments = ticket.comments
    .filter((c) => opts.canSeeInternalComments || !c.isInternal)
    .slice(-MAX_COMMENTS);

  const lines: string[] = [];
  lines.push("## Active Ticket — the user wants to discuss this with you");
  lines.push("");
  lines.push(`**#${ticket.ticketNumber}** · ${ticket.category} · ${ticket.status} · priority ${ticket.priority}`);
  lines.push(`**Title**: ${truncate(ticket.title, 200)}`);
  lines.push(`**Filed by**: ${ticket.creator.name ?? ticket.creator.email} (${ticket.creator.role})`);
  if (ticket.assignee) {
    lines.push(`**Assigned to**: ${ticket.assignee.name ?? ticket.assignee.email}`);
  }
  lines.push(`**Filed**: ${ticket.createdAt.toISOString()}`);
  if (ticket.resolvedAt) lines.push(`**Resolved**: ${ticket.resolvedAt.toISOString()}`);
  if (ticket.closedAt) lines.push(`**Closed**: ${ticket.closedAt.toISOString()}`);
  if (ticket.tags?.length) lines.push(`**Tags**: ${ticket.tags.join(", ")}`);
  if (ticket.pageContext) lines.push(`**Page context**: ${truncate(ticket.pageContext)}`);
  if (ticket.screenshotUrl) lines.push(`**Screenshot URL**: ${ticket.screenshotUrl}`);
  if (ticket.githubIssueUrl) lines.push(`**Linked GitHub issue**: ${ticket.githubIssueUrl}`);
  lines.push("");
  lines.push("**Description**:");
  lines.push(truncate(ticket.description));
  lines.push("");

  if (visibleComments.length === 0) {
    lines.push("_No comments yet._");
  } else {
    const droppedCount = ticket.comments.filter((c) => opts.canSeeInternalComments || !c.isInternal).length - visibleComments.length;
    lines.push(`**Comments** (${visibleComments.length}${droppedCount > 0 ? ` of ${visibleComments.length + droppedCount}, older trimmed` : ""}):`);
    for (const c of visibleComments) {
      const who = c.author.name ?? c.author.email;
      const internal = c.isInternal ? " [internal]" : "";
      lines.push(`- *${who}* (${c.createdAt.toISOString()})${internal}: ${truncate(c.content)}`);
    }
  }

  lines.push("");
  lines.push("**You may**:");
  lines.push("- Propose likely root causes from the page context, errors, and codebase knowledge you have.");
  lines.push("- Suggest a fix plan or repro steps.");
  lines.push("- Ask clarifying questions about anything missing.");
  lines.push("");
  lines.push("**You may NOT**:");
  lines.push("- Change this ticket's status, assignee, or comments — read-only until #729 ships a guarded write surface.");

  return { ok: true, block: lines.join("\n") };
}

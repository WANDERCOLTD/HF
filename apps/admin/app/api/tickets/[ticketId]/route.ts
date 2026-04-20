import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { ROLE_LEVEL } from "@/lib/roles";
import type { UserRole } from "@prisma/client";

/**
 * @api GET /api/tickets/:ticketId
 * @visibility internal
 * @scope tickets:read
 * @auth session
 * @tags tickets
 * @description Retrieves a single ticket by ID including all comments, creator, and assignee details. Internal comments are hidden from partners (below OPERATOR).
 * @pathParam ticketId string - The ticket ID
 * @response 200 { ok: true, ticket: {...} }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "Ticket not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const { ticketId } = await params;

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        creator: {
          select: { id: true, name: true, email: true, image: true },
        },
        assignee: {
          select: { id: true, name: true, email: true, image: true },
        },
        comments: {
          include: {
            author: {
              select: { id: true, name: true, email: true, image: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    // Hide internal comments from partners
    const roleLevel = ROLE_LEVEL[session.user.role as UserRole] ?? 0;
    if (roleLevel < 3 && ticket.comments) {
      ticket.comments = ticket.comments.filter((c: any) => !c.isInternal);
    }

    return NextResponse.json({ ok: true, ticket });
  } catch (error) {
    console.error("GET /api/tickets/[ticketId] error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch ticket" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/tickets/:ticketId
 * @visibility internal
 * @scope tickets:update
 * @auth session
 * @tags tickets
 * @description Updates ticket fields. TESTER/SUPER_TESTER can only edit own OPEN tickets (title + description only). OPERATOR+ has full access. Manages resolved/closed timestamps automatically.
 * @pathParam ticketId string - The ticket ID
 * @body status string - New status (OPEN, IN_PROGRESS, WAITING, RESOLVED, CLOSED)
 * @body priority string - New priority
 * @body category string - New category
 * @body assigneeId string - New assignee user ID
 * @body title string - Updated title
 * @body description string - Updated description
 * @body tags string[] - Updated tags
 * @response 200 { ok: true, ticket: {...} }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 403 { ok: false, error: "You can only edit your own feedback" | "Feedback can only be edited while status is New" | "Partners cannot change: ..." }
 * @response 404 { ok: false, error: "Ticket not found" | "Assignee not found or inactive" }
 * @response 500 { ok: false, error: "..." }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const authResult = await requireAuth("TESTER");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const { ticketId } = await params;
    const body = await req.json();
    const { status, priority, category, assigneeId, title, description, tags } = body;

    const existing = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true, creatorId: true },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    // TESTER/SUPER_TESTER can only edit own tickets while OPEN
    const roleLevel = ROLE_LEVEL[session.user.role as UserRole] ?? 0;
    if (roleLevel < 3) {
      if (existing.creatorId !== session.user.id) {
        return NextResponse.json({ ok: false, error: "You can only edit your own feedback" }, { status: 403 });
      }
      if (existing.status !== "OPEN") {
        return NextResponse.json({ ok: false, error: "Feedback can only be edited while status is New" }, { status: 403 });
      }
      // Partners can only update title and description — not status, priority, assignee, etc.
      const allowedFields = ["title", "description"];
      const attemptedFields = Object.keys(body).filter(k => body[k] !== undefined);
      const disallowed = attemptedFields.filter(f => !allowedFields.includes(f));
      if (disallowed.length > 0) {
        return NextResponse.json({ ok: false, error: `Partners cannot change: ${disallowed.join(", ")}` }, { status: 403 });
      }
    }

    // Verify assignee if changing
    if (assigneeId !== undefined && assigneeId !== null) {
      const assignee = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { id: true, isActive: true },
      });
      if (!assignee || !assignee.isActive) {
        return NextResponse.json(
          { ok: false, error: "Assignee not found or inactive" },
          { status: 404 }
        );
      }
    }

    // Build update data
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (category !== undefined) updateData.category = category;
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId;
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (tags !== undefined) updateData.tags = tags;

    // Set resolved/closed timestamps
    if (status === "RESOLVED" && existing.status !== "RESOLVED") {
      updateData.resolvedAt = new Date();
    }
    if (status === "CLOSED" && existing.status !== "CLOSED") {
      updateData.closedAt = new Date();
    }
    // Clear timestamps if reopening
    if (status === "OPEN" || status === "IN_PROGRESS") {
      updateData.resolvedAt = null;
      updateData.closedAt = null;
    }

    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: updateData,
      include: {
        creator: {
          select: { id: true, name: true, email: true, image: true },
        },
        assignee: {
          select: { id: true, name: true, email: true, image: true },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    return NextResponse.json({ ok: true, ticket });
  } catch (error) {
    console.error("PATCH /api/tickets/[ticketId] error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update ticket" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/tickets/:ticketId
 * @visibility internal
 * @scope tickets:delete
 * @auth session
 * @tags tickets
 * @description Deletes a ticket. Only the ticket creator or an admin can delete.
 * @pathParam ticketId string - The ticket ID
 * @response 200 { ok: true }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 403 { ok: false, error: "Forbidden" }
 * @response 404 { ok: false, error: "Ticket not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const authResult = await requireAuth("TESTER");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const { ticketId } = await params;

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, creatorId: true },
    });

    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    // Creator can delete own ticket; OPERATOR+ can delete any
    const deleteRoleLevel = ROLE_LEVEL[session.user.role as UserRole] ?? 0;
    if (ticket.creatorId !== session.user.id && deleteRoleLevel < 3) {
      return NextResponse.json({ ok: false, error: "You can only delete your own feedback" }, { status: 403 });
    }

    await prisma.ticket.delete({
      where: { id: ticketId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/tickets/[ticketId] error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to delete ticket" },
      { status: 500 }
    );
  }
}

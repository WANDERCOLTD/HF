import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { parsePagination } from "@/lib/api-utils";
import { ROLE_LEVEL } from "@/lib/roles";
import type { UserRole } from "@prisma/client";

/**
 * @api GET /api/tickets
 * @visibility internal
 * @scope tickets:list
 * @auth session
 * @tags tickets
 * @description Lists tickets with optional filters, pagination, and sorting. Includes creator/assignee details and comment counts. TESTER role sees only own tickets.
 * @query status string - Filter by ticket status
 * @query priority string - Filter by priority level
 * @query category string - Filter by category
 * @query assigneeId string - Filter by assignee (use "unassigned" for null)
 * @query creatorId string - Filter by creator
 * @query limit number - Max tickets to return (default 50, max 100)
 * @query offset number - Pagination offset (default 0)
 * @response 200 { ok: true, tickets: [...], total: number, limit: number, offset: number }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const category = url.searchParams.get("category");
    const assigneeId = url.searchParams.get("assigneeId");
    const creatorId = url.searchParams.get("creatorId");
    const { limit, offset } = parsePagination(url.searchParams, { defaultLimit: 50, maxLimit: 100 });

    // Build where clause
    const where: any = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (assigneeId) where.assigneeId = assigneeId === "unassigned" ? null : assigneeId;
    if (creatorId) where.creatorId = creatorId;

    // TESTER (level 1) can only see own tickets; SUPER_TESTER+ sees all
    const roleLevel = ROLE_LEVEL[session.user.role as UserRole] ?? 0;
    if (roleLevel < 2) {
      where.creatorId = session.user.id;
    }

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        take: limit,
        skip: offset,
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
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      }),
      prisma.ticket.count({ where }),
    ]);

    return NextResponse.json({
      ok: true,
      tickets,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("GET /api/tickets error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch tickets" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/tickets
 * @visibility internal
 * @scope tickets:create
 * @auth session
 * @tags tickets
 * @description Creates a new ticket. TESTER+ can create. Validates assignee existence if provided.
 * @body title string - Ticket title (required)
 * @body description string - Ticket description (required)
 * @body priority string - Priority level (default: "MEDIUM")
 * @body category string - Ticket category (default: "OTHER")
 * @body assigneeId string - User ID to assign (optional)
 * @body tags string[] - Tags array (optional)
 * @body pageContext string - Auto-captured page context (optional)
 * @response 201 { ok: true, ticket: {...} }
 * @response 400 { ok: false, error: "Title is required" | "Description is required" }
 * @response 401 { ok: false, error: "Unauthorized" }
 * @response 404 { ok: false, error: "Assignee not found or inactive" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAuth("TESTER");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;

    const body = await req.json();
    const { title, description, priority, category, assigneeId, tags, pageContext, screenshot } = body;

    if (!title?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Title is required" },
        { status: 400 }
      );
    }

    if (!description?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Description is required" },
        { status: 400 }
      );
    }

    // Verify assignee exists if provided
    if (assigneeId) {
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

    const ticket = await prisma.ticket.create({
      data: {
        creatorId: session.user.id,
        title: title.trim(),
        description: description.trim(),
        priority: priority || "MEDIUM",
        category: category || "OTHER",
        assigneeId: assigneeId || null,
        tags: tags || [],
        ...(pageContext ? { pageContext } : {}),
        ...(screenshot ? { screenshotUrl: screenshot } : {}),
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true, image: true },
        },
        assignee: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    return NextResponse.json({ ok: true, ticket }, { status: 201 });
  } catch (error) {
    console.error("POST /api/tickets error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to create ticket" },
      { status: 500 }
    );
  }
}

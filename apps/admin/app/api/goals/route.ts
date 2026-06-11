import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveCallerScopeForReading, isScopeError } from "@/lib/learner-scope";
import { GoalType } from "@prisma/client";

/**
 * @operator-surface yes
 *
 * @api GET /api/goals
 * @visibility public
 * @scope goals:read
 * @auth session
 * @tags goals
 * @description Fetch all goals across all callers with filtering options. Includes related caller, playbook, and content spec data. Returns aggregate counts grouped by status and type.
 * @query status string - Filter by goal status (optional, "all" for no filter)
 * @query type string - Filter by goal type (optional, "all" for no filter)
 * @query callerId string - Filter by caller ID (optional)
 * @query playbookId string - Filter by playbook/course ID (optional)
 * @response 200 { ok: true, goals: [...], counts: { total, byStatus: {...}, byType: {...} } }
 * @response 500 { ok: false, error: "Failed to fetch goals" }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const requestedCallerId = searchParams.get("callerId");
    const playbookId = searchParams.get("playbookId");

    const scope = await resolveCallerScopeForReading(authResult.session, requestedCallerId);
    if (isScopeError(scope)) return scope.error;
    const callerId = scope.scopedCallerId;

    // Build where clause
    const where: any = {};

    if (status && status !== "all") {
      where.status = status;
    }

    if (type && type !== "all") {
      where.type = type;
    }

    if (callerId) {
      where.callerId = callerId;
    }

    if (playbookId) {
      where.playbookId = playbookId;
    }

    // Fetch goals with related data
    const goals = await prisma.goal.findMany({
      where,
      include: {
        caller: {
          select: {
            id: true,
            name: true,
            domain: {
              select: {
                id: true,
                slug: true,
                name: true,
              },
            },
          },
        },
        playbook: {
          select: {
            id: true,
            name: true,
            version: true,
          },
        },
        contentSpec: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
      orderBy: [
        { status: "asc" },
        { priority: "desc" },
        { createdAt: "desc" },
      ],
    });

    // Get counts by status (scoped to same where clause)
    const statusCounts = await prisma.goal.groupBy({
      by: ["status"],
      where,
      _count: true,
    });

    // Get counts by type (scoped to same where clause)
    const typeCounts = await prisma.goal.groupBy({
      by: ["type"],
      where,
      _count: true,
    });

    return NextResponse.json({
      ok: true,
      goals,
      counts: {
        total: goals.length,
        byStatus: Object.fromEntries(
          statusCounts.map((s) => [s.status, s._count])
        ),
        byType: Object.fromEntries(
          typeCounts.map((t) => [t.type, t._count])
        ),
      },
    });
  } catch (error: any) {
    console.error("Error fetching goals:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch goals" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/goals
 * @visibility public
 * @scope goals:write
 * @auth session
 * @tags goals
 * @description Create a new goal for a caller.
 * @body { callerId: string, name: string, description?: string, type?: GoalType }
 * @response 201 { ok: true, goal: Goal }
 * @response 400 { ok: false, error: string }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { callerId, name, description, type } = body;

  if (!callerId) {
    return NextResponse.json(
      { ok: false, error: "callerId is required" },
      { status: 400 }
    );
  }

  if (!name?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Goal name is required" },
      { status: 400 }
    );
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });

  if (!caller) {
    return NextResponse.json(
      { ok: false, error: "Caller not found" },
      { status: 404 }
    );
  }

  const goalType = type && Object.values(GoalType).includes(type) ? type : "LEARN";

  const goal = await prisma.goal.create({
    data: {
      callerId,
      name: name.trim(),
      description: description?.trim() || null,
      type: goalType,
      status: "ACTIVE",
      progress: 0,
      priority: 5,
    },
    include: {
      caller: {
        select: {
          id: true,
          name: true,
          domain: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({ ok: true, goal }, { status: 201 });
}

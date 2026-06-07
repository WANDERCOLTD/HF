/**
 * /api/metering/events
 *
 * GET: Query usage events with filters
 * POST: Log a new usage event (internal use)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveCallerScopeForReading, isScopeError } from "@/lib/learner-scope";
import { UsageCategory, Prisma } from "@prisma/client";
import { logUsageEvent } from "@/lib/metering/usage-logger";

export const runtime = "nodejs";

/**
 * @api GET /api/metering/events
 * @visibility internal
 * @scope metering:read
 * @auth session
 * @tags metering
 * @description Query usage events with optional filters for category, operation, user, caller, and date range
 * @query category string - Filter by UsageCategory (AI, DATABASE, COMPUTE, STORAGE, EXTERNAL)
 * @query operation string - Filter by operation name (contains match)
 * @query userId string - Filter by user ID
 * @query callerId string - Filter by caller ID
 * @query limit number - Max results (default: 100, max: 1000)
 * @query offset number - Pagination offset (default: 0)
 * @query since string - ISO date string for start of date range
 * @query until string - ISO date string for end of date range
 * @response 200 { ok: true, events: UsageEvent[], pagination: { total, limit, offset, hasMore } }
 * @response 500 { ok: false, error: "..." }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { searchParams } = new URL(request.url);

    // Parse filters
    const category = searchParams.get("category") as UsageCategory | null;
    const operation = searchParams.get("operation");
    const requestedUserId = searchParams.get("userId");
    const requestedCallerId = searchParams.get("callerId");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 1000);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // B7 — STUDENT-scope both filters. Caller-id flows through the standard
    // helper. userId is force-narrowed to the session user (a STUDENT's
    // metering visibility is limited to their own row regardless of query).
    const scope = await resolveCallerScopeForReading(authResult.session, requestedCallerId);
    if (isScopeError(scope)) return scope.error;
    const callerId = scope.scopedCallerId;
    const userId = authResult.session.user.role === "STUDENT"
      ? authResult.session.user.id
      : requestedUserId;

    // Date range
    const sinceParam = searchParams.get("since");
    const untilParam = searchParams.get("until");

    // Build where clause
    const where: Prisma.UsageEventWhereInput = {};

    if (category) where.category = category;
    if (operation) where.operation = { contains: operation };
    if (userId) where.userId = userId;
    if (callerId) where.callerId = callerId;

    if (sinceParam || untilParam) {
      where.createdAt = {};
      if (sinceParam) where.createdAt.gte = new Date(sinceParam);
      if (untilParam) where.createdAt.lt = new Date(untilParam);
    }

    // Query events
    const [events, total] = await Promise.all([
      prisma.usageEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          category: true,
          operation: true,
          quantity: true,
          unitType: true,
          costCents: true,
          engine: true,
          model: true,
          sourceOp: true,
          userId: true,
          callerId: true,
          callId: true,
          createdAt: true,
        },
      }),
      prisma.usageEvent.count({ where }),
    ]);

    return NextResponse.json({
      ok: true,
      events,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + events.length < total,
      },
    });
  } catch (error: unknown) {
    console.error("[metering/events] GET Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch events",
      },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/metering/events
 * @visibility internal
 * @scope metering:read
 * @auth session
 * @tags metering
 * @description Log a new usage event (primarily for internal use or testing)
 * @body category string - Usage category (AI, DATABASE, COMPUTE, STORAGE, EXTERNAL)
 * @body operation string - Operation name
 * @body quantity number - Usage quantity
 * @body unitType string - Unit type (e.g. "tokens", "bytes")
 * @body userId string - Optional user ID
 * @body callerId string - Optional caller ID
 * @body callId string - Optional call ID
 * @body engine string - Optional engine name
 * @body model string - Optional model name
 * @body sourceOp string - Optional source operation identifier
 * @body metadata object - Optional metadata
 * @response 200 { ok: true, eventId: string, costCents: number }
 * @response 400 { ok: false, error: "category and operation are required" }
 * @response 400 { ok: false, error: "Invalid category..." }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();

    const {
      category,
      operation,
      quantity,
      unitType,
      userId,
      callerId,
      callId,
      engine,
      model,
      sourceOp,
      metadata,
    } = body;

    // Validate required fields
    if (!category || !operation) {
      return NextResponse.json(
        { ok: false, error: "category and operation are required" },
        { status: 400 }
      );
    }

    // Validate category is a valid enum value
    const validCategories: UsageCategory[] = [
      "AI",
      "DATABASE",
      "COMPUTE",
      "STORAGE",
      "EXTERNAL",
    ];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { ok: false, error: `Invalid category. Must be one of: ${validCategories.join(", ")}` },
        { status: 400 }
      );
    }

    const result = await logUsageEvent({
      category,
      operation,
      quantity,
      unitType,
      userId,
      callerId,
      callId,
      engine,
      model,
      sourceOp,
      metadata,
    });

    if (result) {
      return NextResponse.json({
        ok: true,
        eventId: result.id,
        costCents: result.costCents,
      });
    } else {
      return NextResponse.json(
        { ok: false, error: "Failed to log event" },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    console.error("[metering/events] POST Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to log event",
      },
      { status: 500 }
    );
  }
}

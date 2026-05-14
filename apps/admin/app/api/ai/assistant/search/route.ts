import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/ai/assistant/search
 * @visibility internal
 * @auth session
 * @tags ai
 * @description Search through previous AI assistant conversations by keyword
 * @query q string - Search query (required)
 * @query callPoint string - Filter by call point (e.g., "assistant.chat", "assistant.tasks")
 * @query limit number - Max results (default: 20, max: 100)
 * @query offset number - Pagination offset (default: 0)
 * @response 200 { ok: true, results: Array<{ id, callPoint, userMessage, aiResponse, outcome, metadata, timestamp }>, total: number, limit: number, offset: number, query: string }
 * @response 400 { ok: false, error: "Search query is required" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");
    const callPoint = searchParams.get("callPoint");
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
    const offset = parseInt(searchParams.get("offset") || "0");

    if (!query || !query.trim()) {
      return NextResponse.json(
        { ok: false, error: "Search query is required" },
        { status: 400 }
      );
    }

    const searchTerm = query.trim();

    // Build where clause
    const where: any = {
      OR: [
        {
          userMessage: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
        {
          aiResponse: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
      ],
    };

    // Filter by call point if provided
    if (callPoint) {
      where.callPoint = {
        startsWith: callPoint,
      };
    }

    // Guard: AIInteractionLog model is not in the current Prisma schema (it
    // was the planned learning-accumulation log but never landed). Without
    // this guard the route 500s on any query. Mirror the pattern used by
    // lib/ai/knowledge-accumulation.ts which already detects the missing
    // model and skips silently. Return empty results so the assistant UI's
    // search input still works.
    const prismaAny = prisma as any;
    if (!prismaAny.aIInteractionLog) {
      return NextResponse.json({
        ok: true,
        results: [],
        total: 0,
        limit,
        offset,
        query: searchTerm,
        note: "AI interaction history is not enabled — schema model missing.",
      });
    }

    // Get matching interactions
    const [interactions, total] = await Promise.all([
      prismaAny.aIInteractionLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          callPoint: true,
          userMessage: true,
          aiResponse: true,
          outcome: true,
          metadata: true,
          createdAt: true,
        },
      }),
      prismaAny.aIInteractionLog.count({ where }),
    ]);

    // Format results for display
    const results = interactions.map((interaction: any) => ({
      id: interaction.id,
      callPoint: interaction.callPoint,
      userMessage: interaction.userMessage,
      aiResponse: interaction.aiResponse,
      outcome: interaction.outcome,
      metadata: interaction.metadata,
      timestamp: interaction.createdAt,
      // Extract message highlights
      userMatchIndex: interaction.userMessage
        .toLowerCase()
        .indexOf(searchTerm.toLowerCase()),
      aiMatchIndex: interaction.aiResponse
        .toLowerCase()
        .indexOf(searchTerm.toLowerCase()),
    }));

    return NextResponse.json({
      ok: true,
      results,
      total,
      limit,
      offset,
      query: searchTerm,
    });
  } catch (error) {
    console.error("Search assistant error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to search",
      },
      { status: 500 }
    );
  }
}

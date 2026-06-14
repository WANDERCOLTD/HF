import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireAuth, isAuthError } from "@/lib/permissions";

const prisma = new PrismaClient();

/**
 * @api GET /api/calls/scores
 * @visibility public
 * @scope calls:read
 * @auth session
 * @tags calls, scores
 * @description List call scores across all calls, ordered by most recent. Includes parameter details and call source/transcript.
 * @query limit number - Max number of scores to return (default: 100)
 * @response 200 { ok: true, scores: CallScore[], count: number }
 * @response 500 { ok: false, error: "Failed to fetch call scores" }
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "100");

    const scores = await prisma.callScore.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        call: {
          select: { source: true, transcript: true },
        },
        parameter: {
          select: { name: true, parameterId: true },
        },
      },
    });

    return NextResponse.json({ ok: true, scores, count: scores.length });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch call scores" },
      { status: 500 }
    );
  }
}

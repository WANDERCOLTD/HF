import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/callers/:callerId/calls
 * @visibility internal
 * @scope callers:read
 * @auth session
 * @tags callers, calls
 * @description Get the most recent active sim call for a caller (endedAt is null, source is sim, within last 2 hours).
 * @pathParam callerId string - The caller ID
 * @query active boolean - If "true", only return active (non-ended) calls
 * @response 200 { ok: true, call: { id, callSequence, source, createdAt } | null }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const url = new URL(_request.url);
    const activeOnly = url.searchParams.get("active") === "true";

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const where = {
      callerId,
      ...(activeOnly
        ? {
            endedAt: null,
            source: { contains: "sim" },
            createdAt: { gte: twoHoursAgo },
          }
        : {}),
    };

    const call = await prisma.call.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        callSequence: true,
        source: true,
        createdAt: true,
        endedAt: true,
      },
    });

    return NextResponse.json({ ok: true, call: call || null });
  } catch (error: any) {
    console.error("GET /api/callers/[callerId]/calls error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to fetch calls" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/callers/:callerId/calls
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, calls
 * @description Create a new call record for a caller. Auto-determines call sequence number if not provided. Links to previous call for chain tracking.
 * @pathParam callerId string - The caller ID to create a call for
 * @body source string - Call source identifier (default: "ai-simulation")
 * @body callSequence number - Explicit sequence number (optional, auto-incremented if omitted)
 * @body transcript string - Call transcript text (default: "")
 * @body playbookId string - Optional playbook (course) ID to scope this call
 * @response 200 { ok: true, call: { id, callSequence, source, createdAt } }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: "Failed to create call" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const body = await request.json();
    const { source = "ai-simulation", callSequence, transcript = "", usedPromptId, playbookId } = body;

    // Verify caller exists
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
    });

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // Determine call sequence
    let sequence = callSequence;
    if (!sequence) {
      const lastCall = await prisma.call.findFirst({
        where: { callerId },
        orderBy: { callSequence: "desc" },
        select: { callSequence: true },
      });
      sequence = (lastCall?.callSequence || 0) + 1;
    }

    // Get previous call ID for linking
    const previousCall = await prisma.call.findFirst({
      where: { callerId },
      orderBy: { callSequence: "desc" },
      select: { id: true },
    });

    // Create the call
    const call = await prisma.call.create({
      data: {
        callerId,
        source,
        callSequence: sequence,
        previousCallId: previousCall?.id || null,
        transcript: transcript || "",
        externalId: source === "playground-upload" ? `upload-${Date.now()}` : `ai-sim-${Date.now()}`,
        ...(usedPromptId ? { usedPromptId } : {}),
        ...(playbookId ? { playbookId } : {}),
      },
    });

    return NextResponse.json({
      ok: true,
      call: {
        id: call.id,
        callSequence: call.callSequence,
        source: call.source,
        createdAt: call.createdAt,
      },
    });
  } catch (error: any) {
    console.error("POST /api/callers/[callerId]/calls error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to create call" },
      { status: 500 }
    );
  }
}

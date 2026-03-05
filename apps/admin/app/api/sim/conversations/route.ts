import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api GET /api/sim/conversations
 * @visibility internal
 * @auth session
 * @tags sim
 * @description Returns callers with their last call message preview for the chat list UI. Session-authenticated OPERATORs see only their own callers; ADMINs and sim-token users see all.
 * @response 200 { ok: true, conversations: Array<{ callerId, name, domain, lastMessage, lastMessageAt, createdAt }>, needsSetup?: boolean }
 * @response 500 { ok: false, error: "Failed to load conversations" }
 */
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;
    const { session } = authResult;
    const isOperator = session?.user?.role === "OPERATOR";

    const { searchParams } = new URL(request.url);
    const domainId = searchParams.get("domainId");

    // Build where clause: OPERATORs see only their own callers, optional domain filter
    const where: Record<string, unknown> = {
      ...(isOperator ? { userId: session.user.id } : {}),
      ...(domainId ? { domainId } : {}),
    };

    const callers = await prisma.caller.findMany({
      where,
      include: {
        domain: {
          select: {
            name: true,
            slug: true,
          },
        },
        calls: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            transcript: true,
            createdAt: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    // If an OPERATOR has no callers, they need setup
    if (isOperator && callers.length === 0) {
      return NextResponse.json({
        ok: true,
        conversations: [],
        needsSetup: true,
      });
    }

    const conversations = callers.map((caller) => {
      const lastCall = caller.calls[0] || null;
      let lastMessage: string | null = null;

      // Extract last message line from transcript
      if (lastCall?.transcript) {
        const lines = lastCall.transcript.trim().split("\n");
        const lastLine = lines[lines.length - 1] || "";
        lastMessage =
          lastLine.length > 80 ? lastLine.slice(0, 80) + "..." : lastLine;
      }

      return {
        callerId: caller.id,
        name: caller.name,
        domain: caller.domain
          ? { name: caller.domain.name, slug: caller.domain.slug }
          : null,
        lastMessage,
        lastMessageAt: lastCall?.createdAt?.toISOString() || null,
        createdAt: caller.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ ok: true, conversations });
  } catch (error) {
    console.error("Error fetching sim conversations:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to load conversations" },
      { status: 500 }
    );
  }
}

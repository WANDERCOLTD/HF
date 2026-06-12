/**
 * @api GET /api/callers/:callerId/artifacts
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, artifacts
 * @description List conversation artifacts for a caller. Optionally filter by callId or status.
 * @pathParam callerId string - The caller ID
 * @queryParam callId string - Filter by specific call (optional)
 * @queryParam status string - Filter by status: PENDING, SENT, DELIVERED, READ, FAILED (optional)
 * @queryParam limit number - Max results (default 50)
 * @response 200 { ok: true, artifacts: ConversationArtifact[] }
 * @response 404 { ok: false, error: "Caller not found" }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";
import { ArtifactStatus } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> }
) {
  const authResult = await requireAuth("VIEWER");
  if (isAuthError(authResult)) return authResult.error;

  const { callerId } = await params;

  // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
  // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
  // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
  if (!studentAllowedToReadCaller(authResult.session, callerId)) {
    return callerScopeMismatchResponse();
  }
  const { searchParams } = new URL(request.url);
  const callId = searchParams.get("callId");
  const status = searchParams.get("status") as ArtifactStatus | null;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  // Verify caller exists
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

  const where: any = { callerId };
  if (callId) where.callId = callId;
  if (status && Object.values(ArtifactStatus).includes(status)) {
    where.status = status;
  }

  const artifacts = await prisma.conversationArtifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      media: {
        select: { id: true, fileName: true, mimeType: true, title: true },
      },
    },
  });

  return NextResponse.json({ ok: true, artifacts });
}

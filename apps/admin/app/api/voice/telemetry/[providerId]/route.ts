import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

export const runtime = "nodejs";

/**
 * @api GET /api/voice/telemetry/[providerId]
 * @visibility internal
 * @scope voice:telemetry:read
 * @auth session ADMIN
 * @tags voice, telemetry, admin
 * @description Recent telemetry rows for a voice provider (AnyVoice
 *   #1080). Returns the latest N UsageEvent rows scoped to
 *   `engine = provider.slug AND category = VOICE`, plus a per-call
 *   drill-down when `?callId=` is supplied.
 *
 * @query callId — when set, returns only the events for that callId
 *   ordered by createdAt asc (chronological per-call timeline)
 * @query limit — default 50, max 500
 *
 * @response 200 { ok: true, providerId, events: [...] }
 * @response 404 { error: "Provider not found" }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const auth = await requireAuth("ADMIN");
  if (isAuthError(auth)) return auth.error;

  const { providerId } = await params;
  const url = new URL(request.url);
  const drillCallId = url.searchParams.get("callId");
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    500,
  );

  const provider = await prisma.voiceProvider.findUnique({
    where: { id: providerId },
    select: { id: true, slug: true, displayName: true },
  });
  if (!provider) {
    return NextResponse.json(
      { error: "Provider not found" },
      { status: 404 },
    );
  }

  const where = {
    category: "VOICE" as const,
    engine: provider.slug,
    ...(drillCallId ? { callId: drillCallId } : {}),
  };

  const events = await prisma.usageEvent.findMany({
    where,
    select: {
      id: true,
      operation: true,
      callId: true,
      callerId: true,
      quantity: true,
      unitType: true,
      costCents: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: drillCallId ? "asc" : "desc" },
    take: limit,
  });

  return NextResponse.json({
    ok: true,
    providerId: provider.id,
    slug: provider.slug,
    drillCallId,
    events,
  });
}

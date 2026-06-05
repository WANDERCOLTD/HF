import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { config } from "@/lib/config";

export const runtime = "nodejs";

interface OperationStat {
  operation: string;
  count: number;
  errorCount: number;
}

/**
 * @api GET /api/voice/health/[providerId]
 * @visibility internal
 * @scope voice:health:read
 * @auth session OPERATOR OR x-internal-secret
 * @tags voice, telemetry, ops
 * @description Health snapshot for a voice provider (AnyVoice #1080).
 *   Returns last-hour stats: total UsageEvent count, error count,
 *   signature-failure count. Dual-path auth: session OPERATOR works for
 *   admin browsers, the `x-internal-secret` header path is for ops
 *   dashboards (e.g. Cloudflare Workers polling without a session
 *   cookie). Same pattern as `/api/calls/[callId]/pipeline`.
 * @response 200 { ok: true, providerId, slug, since, stats }
 * @response 401 { error: "Unauthorized" } (neither session nor secret)
 * @response 404 { error: "Provider not found" }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;

  // Dual-path auth: x-internal-secret OR session OPERATOR.
  const internalSecret = request.headers.get("x-internal-secret");
  const expectedSecret = config.security.internalApiSecret;
  let authed = false;
  if (internalSecret && expectedSecret && internalSecret === expectedSecret) {
    authed = true;
  } else {
    const auth = await requireAuth("OPERATOR");
    if (isAuthError(auth)) return auth.error;
    authed = true;
  }
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = await prisma.voiceProvider.findUnique({
    where: { id: providerId },
    select: { id: true, slug: true, displayName: true, enabled: true },
  });
  if (!provider) {
    return NextResponse.json(
      { error: "Provider not found" },
      { status: 404 },
    );
  }

  const since = new Date(Date.now() - 60 * 60 * 1000); // last hour
  const events = await prisma.usageEvent.findMany({
    where: {
      category: "VOICE",
      engine: provider.slug,
      createdAt: { gte: since },
    },
    select: { operation: true, metadata: true, costCents: true },
  });

  const byOperation = new Map<string, OperationStat>();
  let totalCost = 0;
  let signatureFailures = 0;
  let totalErrors = 0;
  for (const e of events) {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    const hasError = m.success === false;
    if (hasError) totalErrors++;
    if (e.operation === `voice:${provider.slug}:auth:invalid-signature`) {
      signatureFailures++;
    }
    totalCost += e.costCents;
    const entry = byOperation.get(e.operation) ?? {
      operation: e.operation,
      count: 0,
      errorCount: 0,
    };
    entry.count++;
    if (hasError) entry.errorCount++;
    byOperation.set(e.operation, entry);
  }

  const errorRate =
    events.length === 0 ? 0 : totalErrors / events.length;

  return NextResponse.json({
    ok: true,
    providerId: provider.id,
    slug: provider.slug,
    displayName: provider.displayName,
    enabled: provider.enabled,
    since: since.toISOString(),
    stats: {
      totalEvents: events.length,
      totalErrors,
      errorRate,
      signatureFailures,
      totalCostCents: totalCost,
      operations: Array.from(byOperation.values()).sort(
        (a, b) => b.count - a.count,
      ),
    },
  });
}

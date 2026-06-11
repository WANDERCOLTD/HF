import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

/**
 * @api POST /api/help/events
 * @visibility internal
 * @scope help:telemetry
 * @auth OPERATOR
 * @tags help, telemetry
 * @description Records a lightweight operator help-surface telemetry event
 *   (doc view, cascade-inspector open/close, Cmd+K /demo fire). Fire-and-forget
 *   contract: route ALWAYS returns 202; DB errors are swallowed so a telemetry
 *   write can never block the surfaces it instruments. Rate-limited via
 *   `checkRateLimit(getClientIP(req), "help-event")` to throttle accidental
 *   floods. See `prisma/schema.prisma::HelpEvent` for the model docstring.
 * @body { type: string, target: string, role?: string, callerId?: string, success?: boolean, durationMs?: number }
 * @response 202 { ok: true }
 * @response 401 { error: "Unauthorized" }
 * @response 403 { error: "Forbidden" }
 * @response 422 { error: "Invalid body", details: ... }
 * @response 429 { error: "Too many attempts..." }
 *
 * Epic #1442 Layer 3 Slice 3 — #1484.
 */

const HelpEventBodySchema = z.object({
  type: z.string().min(1).max(64),
  target: z.string().min(1).max(256),
  role: z.string().max(32).optional(),
  callerId: z.string().max(64).optional(),
  success: z.boolean().optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(), // cap at 24h
});

export async function POST(request: NextRequest) {
  // OPERATOR+ — telemetry is not a learner surface.
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;

  // Rate-limit per IP. Telemetry should be infrequent; this catches
  // accidental floods (e.g. component re-render storm) without breaking
  // legitimate operator flows.
  const rl = checkRateLimit(getClientIP(request), "help-event");
  if (!rl.ok) return rl.error;

  const raw = await request.json().catch(() => ({}));
  const parsed = HelpEventBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { session } = authResult;
  const userId = session.user?.id ?? null;
  // Body-supplied role wins; server falls back to session role so the
  // caller can never lie about being someone else.
  const role = parsed.data.role ?? session.user?.role ?? null;

  // Fire-and-forget DB write — never throw, never block.
  // Mirror of `logUsageEventFireAndForget` from `lib/metering/usage-logger.ts`:
  // log the failure server-side, return 202 regardless. The telemetry
  // contract is "best-effort, never blocks UI"; bubbling a DB error to the
  // client would put a 5xx in front of a useEffect-mount call, which is the
  // structural failure mode AC (b) pins.
  prisma.helpEvent
    .create({
      data: {
        type: parsed.data.type,
        target: parsed.data.target,
        role,
        userId,
        callerId: parsed.data.callerId ?? null,
        success: parsed.data.success ?? null,
        durationMs: parsed.data.durationMs ?? null,
      },
    })
    .catch((err: unknown) => {
      console.error(
        "[help-event] DB write failed (swallowed):",
        (err as Error)?.message ?? err,
      );
    });

  // 202 Accepted — the write is in-flight, the caller is free to move on.
  return NextResponse.json({ ok: true }, { status: 202 });
}
